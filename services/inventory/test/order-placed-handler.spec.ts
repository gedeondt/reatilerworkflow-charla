import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
import type { EventEnvelope } from '@reatiler/shared';

import { createReservationStore } from '../src/reservations.js';
import { createOrderPlacedHandler } from '../src/events/handlers.js';

const baseEvent = (): EventEnvelope => ({
  eventName: 'OrderPlaced',
  version: 1,
  eventId: 'evt-1',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
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
    }
  }
});

describe('inventory order placed handler', () => {
  it('creates a reservation and publishes InventoryReserved', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({ store, bus, logger });

    await handler(baseEvent());

    const reservation = store.findByOrderId('order-1');
    expect(reservation).not.toBeNull();
    expect(reservation?.status).toBe('RESERVED');
    expect(reservation?.amount).toBe(199.99);
    expect(reservation?.address.city).toBe('Metropolis');

    const published = await bus.pop('payments');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('InventoryReserved');
    expect(published?.traceId).toBe('trace-1');
    expect(published?.correlationId).toBe('order-1');
    expect(published?.data).toMatchObject({
      reservationId: expect.any(String),
      amount: 199.99,
      address: { city: 'Metropolis' }
    });
  });

  it('is idempotent for the same event', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({ store, bus, logger });

    const event = baseEvent();
    await handler(event);
    await handler(event);

    const first = await bus.pop('payments');
    const second = await bus.pop('payments');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
