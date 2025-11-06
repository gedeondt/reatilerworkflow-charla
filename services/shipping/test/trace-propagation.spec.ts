import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createPaymentAuthorizedHandler } from '../src/events/handlers.js';
import { createShipmentStore } from '../src/shipments.js';

describe('shipping trace propagation', () => {
  it('preserves trace metadata when preparing shipments', async () => {
    const bus = new FakeEventBus();
    const store = createShipmentStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createPaymentAuthorizedHandler({
      store,
      bus,
      logger,
      allowPrepare: true,
      opTimeoutMs: 100,
      nextQueue: 'payments'
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

    await handler({ ...incoming, eventId: 'evt-incoming' });

    const published = await bus.pop('payments');

    expect(published?.traceId).toBe('trace-xyz');
    expect(published?.correlationId).toBe('order-123');
    expect(published?.causationId).toBe('evt-incoming');
  });
});
