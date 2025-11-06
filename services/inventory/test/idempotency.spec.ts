import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createOrderPlacedHandler } from '../src/events/handlers.js';
import { createReservationStore } from '../src/reservations.js';

describe('inventory idempotency', () => {
  it('skips duplicated OrderPlaced events', async () => {
    const bus = new FakeEventBus();
    const pushSpy = vi.spyOn(bus, 'push');
    const store = createReservationStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 100
    });

    const incoming = createEvent(
      'OrderPlaced',
      {
        orderId: 'order-123',
        lines: [{ sku: 'SKU-1', qty: 1 }],
        amount: 50,
        address: {
          line1: 'Main St',
          city: 'Metropolis',
          zip: '12345',
          country: 'AR'
        }
      },
      { traceId: 'trace-abc', correlationId: 'order-123' }
    );

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    const firstReservation = store.findByOrderId('order-123');
    expect(firstReservation).not.toBeNull();

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(store.findByOrderId('order-123')).toEqual(firstReservation);
  });
});
