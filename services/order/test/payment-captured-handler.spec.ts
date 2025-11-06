import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
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
  it('confirms the order on PaymentCaptured', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder });

    const handler = createPaymentCapturedHandler({ store, bus, logger });

    await handler({
      eventName: 'PaymentCaptured',
      version: 1,
      eventId: 'evt-6',
      traceId: 'trace-1',
      correlationId: 'order-1',
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-1',
        orderId: 'order-1',
        amount: 199.99
      }
    });

    const order = store.get('order-1');
    expect(order?.status).toBe('CONFIRMED');

    const published = await bus.pop('orders-log');
    expect(published?.eventName).toBe('OrderConfirmed');
  });

  it('marks order as failed on InventoryReservationFailed', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder });

    const handler = createInventoryReservationFailedHandler({ store, bus, logger });

    await handler({
      eventName: 'InventoryReservationFailed',
      version: 1,
      eventId: 'evt-7',
      traceId: 'trace-1',
      correlationId: 'order-1',
      occurredAt: new Date().toISOString(),
      data: {
        reservationId: 'rsv-1',
        orderId: 'order-1',
        reason: 'out_of_stock'
      }
    });

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

    await handler({
      eventName: 'PaymentFailed',
      version: 1,
      eventId: 'evt-8',
      traceId: 'trace-1',
      correlationId: 'order-1',
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-2',
        orderId: 'order-1',
        reservationId: 'rsv-2',
        reason: 'card_declined'
      }
    });

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

    await handler({
      eventName: 'InventoryReleased',
      version: 1,
      eventId: 'evt-9',
      traceId: 'trace-1',
      correlationId: 'order-1',
      occurredAt: new Date().toISOString(),
      data: {
        reservationId: 'rsv-3',
        orderId: 'order-1'
      }
    });

    const cancelled = await bus.pop('orders-log');
    expect(cancelled?.eventName).toBe('OrderCancelled');
  });

  it('cancels order after PaymentRefunded', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({ ...baseOrder, status: 'CONFIRMED', paymentId: 'pay-3' });

    const handler = createPaymentRefundedHandler({ store, bus, logger });

    await handler({
      eventName: 'PaymentRefunded',
      version: 1,
      eventId: 'evt-10',
      traceId: 'trace-1',
      correlationId: 'order-1',
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-3',
        orderId: 'order-1',
        amount: 199.99,
        reason: 'shipment_failed'
      }
    });

    const order = store.get('order-1');
    expect(order?.status).toBe('CANCELLED');

    const cancelled = await bus.pop('orders-log');
    expect(cancelled?.eventName).toBe('OrderCancelled');
  });
});
