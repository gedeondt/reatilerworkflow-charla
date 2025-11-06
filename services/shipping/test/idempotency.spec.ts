import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createPaymentAuthorizedHandler } from '../src/events/handlers.js';
import { createShipmentStore } from '../src/shipments.js';

describe('shipping idempotency', () => {
  it('skips duplicated PaymentAuthorized events', async () => {
    const bus = new FakeEventBus();
    const pushSpy = vi.spyOn(bus, 'push');
    const store = createShipmentStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({
      store,
      bus,
      logger,
      allowPrepare: true,
      opTimeoutMs: 100
    });

    const incoming = createEvent(
      'PaymentAuthorized',
      {
        paymentId: 'pay-1',
        reservationId: 'res-1',
        orderId: 'order-123',
        amount: 75,
        address: {
          line1: 'Main St',
          city: 'Metropolis',
          zip: '12345',
          country: 'AR'
        }
      },
      { traceId: 'trace-xyz', correlationId: 'order-123' }
    );

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    const shipment = store.findByOrderId('order-123');
    expect(shipment).not.toBeNull();

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(store.findByOrderId('order-123')).toEqual(shipment);
  });
});
