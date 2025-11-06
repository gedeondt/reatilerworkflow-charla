import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
import type { EventEnvelope } from '@reatiler/shared';

import { createShipmentStore } from '../src/shipments.js';
import { createPaymentAuthorizedHandler } from '../src/events/handlers.js';

const paymentAuthorizedEvent = (): EventEnvelope => ({
  eventName: 'PaymentAuthorized',
  version: 1,
  eventId: 'evt-5',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
    paymentId: 'pay-1',
    orderId: 'order-1',
    amount: 199.99,
    address: {
      line1: 'Main St 123',
      city: 'Metropolis',
      zip: '12345',
      country: 'AR'
    }
  }
});

describe('shipping payment authorized handler', () => {
  it('prepares a shipment and publishes ShipmentPrepared', async () => {
    const store = createShipmentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({ store, bus, logger });

    await handler(paymentAuthorizedEvent());

    const shipment = store.findByOrderId('order-1');
    expect(shipment).not.toBeNull();
    expect(shipment?.status).toBe('PREPARED');

    const published = await bus.pop('payments');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('ShipmentPrepared');
    expect(published?.data).toMatchObject({
      shipmentId: expect.any(String),
      orderId: 'order-1',
      address: { city: 'Metropolis' }
    });
  });

  it('is idempotent when the same event arrives twice', async () => {
    const store = createShipmentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({ store, bus, logger });
    const event = paymentAuthorizedEvent();

    await handler(event);
    await handler(event);

    const first = await bus.pop('payments');
    const second = await bus.pop('payments');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
