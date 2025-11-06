import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createPaymentCapturedHandler } from '../src/events/handlers.js';
import { createOrderStore } from '../src/orders.js';

describe('order idempotency', () => {
  it('skips duplicated PaymentCaptured events', async () => {
    const bus = new FakeEventBus();
    const pushSpy = vi.spyOn(bus, 'push');
    const store = createOrderStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      orderId: 'order-123',
      lines: [{ sku: 'SKU-1', qty: 1 }],
      amount: 75,
      address: {
        line1: 'Main St',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      },
      status: 'PLACED',
      traceId: 'trace-xyz',
      requestId: 'trace-xyz',
      reservationId: 'res-1',
      paymentId: null,
      shipmentId: null,
      lastFailureReason: null,
      cancellationLogged: false
    });

    const handler = createPaymentCapturedHandler({ store, bus, logger });

    const incoming = createEvent(
      'PaymentCaptured',
      {
        paymentId: 'pay-1',
        orderId: 'order-123',
        amount: 75
      },
      { traceId: 'trace-xyz', correlationId: 'order-123' }
    );

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    const order = store.get('order-123');
    expect(order?.status).toBe('CONFIRMED');

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(store.get('order-123')).toEqual(order);
  });
});
