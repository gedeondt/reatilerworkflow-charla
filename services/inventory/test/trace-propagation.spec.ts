import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createOrderPlacedHandler } from '../src/events/handlers.js';
import { createReservationStore } from '../src/reservations.js';

describe('inventory trace propagation', () => {
  it('preserves trace metadata when reserving inventory', async () => {
    const bus = new FakeEventBus();
    const store = createReservationStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 100,
      nextQueue: 'payments'
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

    await handler({ ...incoming, eventId: 'evt-incoming' });

    const published = await bus.pop('payments');

    expect(published?.traceId).toBe('trace-abc');
    expect(published?.correlationId).toBe('order-123');
    expect(published?.causationId).toBe('evt-incoming');
  });
});
