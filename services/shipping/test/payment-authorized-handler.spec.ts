import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';
import type { EventEnvelope } from '@reatiler/shared';

import { createShipmentStore } from '../src/shipments.js';
import { createPaymentAuthorizedHandler } from '../src/events/handlers.js';

const paymentAuthorizedEvent = (): EventEnvelope =>
  createEvent(
    'PaymentAuthorized',
    {
      paymentId: 'pay-1',
      orderId: 'order-1',
      reservationId: 'rsv-1',
      amount: 199.99,
      address: {
        line1: 'Main St 123',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      }
    },
    { traceId: 'trace-1', correlationId: 'order-1' }
  );

describe('shipping payment authorized handler', () => {
  it('prepares a shipment and publishes ShipmentPrepared with propagated metadata', async () => {
    const store = createShipmentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({
      store,
      bus,
      logger,
      allowPrepare: true,
      opTimeoutMs: 1000
    });

    const incoming = paymentAuthorizedEvent();
    await handler(incoming);

    const shipment = store.findByOrderId('order-1');
    expect(shipment).not.toBeNull();
    expect(shipment?.status).toBe('PREPARED');

    const published = await bus.pop('payments');
    expect(published?.eventName).toBe('ShipmentPrepared');
    expect(published?.traceId).toBe(incoming.traceId);
    expect(published?.correlationId).toBe('order-1');
    expect(published?.causationId).toBe(incoming.eventId);
    expect(published?.data).toMatchObject({ shipmentId: expect.any(String) });
  });

  it('publishes ShipmentFailed and RefundPayment when preparation is disabled', async () => {
    const store = createShipmentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({
      store,
      bus,
      logger,
      allowPrepare: false,
      opTimeoutMs: 1000
    });

    await handler(paymentAuthorizedEvent());

    const failure = await bus.pop('payments');
    const refund = await bus.pop('payments');

    expect(failure?.eventName).toBe('ShipmentFailed');
    expect(refund?.eventName).toBe('RefundPayment');

    const shipment = store.findByOrderId('order-1');
    expect(shipment?.status).toBe('FAILED');
  });

  it('is idempotent for duplicate events when preparation already done', async () => {
    const store = createShipmentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({
      store,
      bus,
      logger,
      allowPrepare: true,
      opTimeoutMs: 1000
    });

    const event = paymentAuthorizedEvent();
    await handler(event);
    await handler(event);

    const first = await bus.pop('payments');
    const second = await bus.pop('payments');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
