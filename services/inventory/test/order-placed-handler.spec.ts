import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';
import type { EventEnvelope } from '@reatiler/shared';

import { createReservationStore } from '../src/reservations.js';
import { createOrderPlacedHandler, createReleaseStockHandler } from '../src/events/handlers.js';

const baseEvent = (): EventEnvelope =>
  createEvent(
    'OrderPlaced',
    {
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
    },
    { traceId: 'trace-1', correlationId: 'order-1' }
  );

describe('inventory order placed handler', () => {
  it('creates a reservation and publishes InventoryReserved with propagated traces', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 1000
    });

    const incoming = baseEvent();
    await handler(incoming);

    const reservation = store.findByOrderId('order-1');
    expect(reservation).not.toBeNull();
    expect(reservation?.status).toBe('RESERVED');

    const published = await bus.pop('payments');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('InventoryReserved');
    expect(published?.traceId).toBe(incoming.traceId);
    expect(published?.correlationId).toBe('order-1');
    expect(published?.causationId).toBe(incoming.eventId);
  });

  it('publishes InventoryReservationFailed when reservations are disabled', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: false,
      opTimeoutMs: 1000
    });

    await handler(baseEvent());

    const failureToOrders = await bus.pop('orders');
    const failureToPayments = await bus.pop('payments');

    expect(failureToOrders?.eventName).toBe('InventoryReservationFailed');
    expect(failureToPayments?.eventName).toBe('InventoryReservationFailed');

    const reservation = store.findByOrderId('order-1');
    expect(reservation?.status).toBe('FAILED');
  });

  it('releases stock when receiving ReleaseStock', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const successHandler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 1000
    });

    const incoming = baseEvent();
    await successHandler(incoming);
    const reservedEvent = await bus.pop('payments');
    expect(reservedEvent).not.toBeNull();

    const reservation = store.findByOrderId('order-1');
    expect(reservation).not.toBeNull();

    const releaseHandler = createReleaseStockHandler({ store, bus, logger });

    const releaseEvent = createEvent(
      'ReleaseStock',
      {
        reservationId: reservation!.reservationId,
        orderId: 'order-1'
      },
      {
        traceId: incoming.traceId,
        correlationId: 'order-1',
        causationId: incoming.eventId
      }
    );

    await releaseHandler(releaseEvent);

    const releasedEvent = await bus.pop('orders');
    expect(releasedEvent?.eventName).toBe('InventoryReleased');
    expect(releasedEvent?.traceId).toBe(incoming.traceId);
    expect(releasedEvent?.causationId).toBe(releaseEvent.eventId);
    expect(store.findByOrderId('order-1')?.status).toBe('RELEASED');
  });

  it('is idempotent for duplicate OrderPlaced events', async () => {
    const store = createReservationStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createOrderPlacedHandler({
      store,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 1000
    });

    const event = baseEvent();
    await handler(event);
    await handler(event);

    const first = await bus.pop('payments');
    const second = await bus.pop('payments');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
