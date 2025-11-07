import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createPaymentCapturedHandler } from '../src/events/handlers.js';
import { createOrderStore } from '../src/orders.js';

describe('order trace propagation', () => {
  it('preserves trace metadata when confirming an order', async () => {
    const bus = new FakeEventBus();
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

    await handler({ ...incoming, eventId: 'evt-incoming' });

    const published = await bus.pop('orders');

    expect(published?.traceId).toBe('trace-xyz');
    expect(published?.correlationId).toBe('order-123');
    expect(published?.causationId).toBe('evt-incoming');
  });
});
