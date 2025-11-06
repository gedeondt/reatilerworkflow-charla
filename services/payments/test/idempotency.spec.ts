import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createInventoryReservedHandler } from '../src/events/handlers.js';
import { createPaymentStore } from '../src/payments.js';

describe('payments idempotency', () => {
  it('skips duplicated InventoryReserved events', async () => {
    const bus = new FakeEventBus();
    const pushSpy = vi.spyOn(bus, 'push');
    const store = createPaymentStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createInventoryReservedHandler({
      store,
      bus,
      logger,
      allowAuth: true,
      opTimeoutMs: 100
    });

    const incoming = createEvent(
      'InventoryReserved',
      {
        reservationId: 'res-1',
        orderId: 'order-123',
        items: [{ sku: 'SKU-1', qty: 1 }],
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

    const payment = store.findByOrderId('order-123');
    expect(payment).not.toBeNull();

    await handler({ ...incoming, eventId: 'evt-duplicate' });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(store.findByOrderId('order-123')).toEqual(payment);
  });
});
