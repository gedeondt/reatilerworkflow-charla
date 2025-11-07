import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';
import type { EventEnvelope } from '@reatiler/shared';

import { createOrderStore } from '../src/orders.js';
import {
  createInventoryReservationFailedHandler,
  createPaymentFailedHandler,
  createPaymentCapturedHandler,
  createInventoryReleasedHandler,
  createPaymentRefundedHandler
} from '../src/events/handlers.js';

const baseOrder = {
  orderId: 'order-1',
  lines: [
    {
      sku: 'SKU-1',
      qty: 2
    }
  ],
  amount: 199.99,
  address: {
    line1: 'Main St 123',
    city: 'Metropolis',
    zip: '12345',
    country: 'AR'
  },
  status: 'PLACED' as const,
  traceId: 'trace-1',
  requestId: 'trace-1',
  reservationId: null,
  paymentId: null,
  shipmentId: null,
  lastFailureReason: null,
  cancellationLogged: false
};

describe('order event handlers', () => {
  it('confirms the order on PaymentCaptured with propagated metadata', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder });

    const handler = createPaymentCapturedHandler({ store, bus, logger });

    const incoming = createEvent(
      'PaymentCaptured',
      {
        paymentId: 'pay-1',
        orderId: 'order-1',
        amount: 199.99
      },
      { traceId: 'trace-1', correlationId: 'order-1' }
    );

    await handler(incoming);

    const order = store.get('order-1');
    expect(order?.status).toBe('CONFIRMED');

    const published = await bus.pop('orders');
    expect(published?.eventName).toBe('OrderConfirmed');
    expect(published?.traceId).toBe(incoming.traceId);
    expect(published?.correlationId).toBe('order-1');
    expect(published?.causationId).toBe(incoming.eventId);
  });

  it('marks order as failed on InventoryReservationFailed', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder });

    const handler = createInventoryReservationFailedHandler({ store, bus, logger });

    await handler(
      createEvent(
        'InventoryReservationFailed',
        {
          reservationId: 'rsv-1',
          orderId: 'order-1',
          reason: 'out_of_stock'
        },
        { traceId: 'trace-1', correlationId: 'order-1' }
      )
    );

    const order = store.get('order-1');
    expect(order?.status).toBe('FAILED');

    const failure = await bus.pop('orders-log');
    expect(failure?.eventName).toBe('OrderFailed');
  });

  it('cancels order on PaymentFailed and emits ReleaseStock', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder, reservationId: 'rsv-2' });

    const handler = createPaymentFailedHandler({ store, bus, logger });

    await handler(
      createEvent(
        'PaymentFailed',
        {
          paymentId: 'pay-2',
          orderId: 'order-1',
          reservationId: 'rsv-2',
          reason: 'card_declined'
        },
        { traceId: 'trace-1', correlationId: 'order-1' }
      )
    );

    const order = store.get('order-1');
    expect(order?.status).toBe('CANCELLED');

    const release = await bus.pop('inventory');
    expect(release?.eventName).toBe('ReleaseStock');
  });

  it('logs cancellation after InventoryReleased', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      ...baseOrder,
      status: 'CANCELLED',
      reservationId: 'rsv-3',
      lastFailureReason: 'card_declined'
    });

    const handler = createInventoryReleasedHandler({ store, bus, logger });

    await handler(
      createEvent(
        'InventoryReleased',
        {
          reservationId: 'rsv-3',
          orderId: 'order-1'
        },
        { traceId: 'trace-1', correlationId: 'order-1' }
      )
    );

    const cancelled = await bus.pop('orders-log');
    expect(cancelled?.eventName).toBe('OrderCancelled');
  });

  it('cancels order after PaymentRefunded', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder, status: 'CONFIRMED', paymentId: 'pay-3' });

    const handler = createPaymentRefundedHandler({ store, bus, logger });

    await handler(
      createEvent(
        'PaymentRefunded',
        {
          paymentId: 'pay-3',
          orderId: 'order-1',
          amount: 199.99,
          reason: 'shipment_failed'
        },
        { traceId: 'trace-1', correlationId: 'order-1' }
      )
    );

    const order = store.get('order-1');
    expect(order?.status).toBe('CANCELLED');

    const cancelled = await bus.pop('orders-log');
    expect(cancelled?.eventName).toBe('OrderCancelled');
  });
});
