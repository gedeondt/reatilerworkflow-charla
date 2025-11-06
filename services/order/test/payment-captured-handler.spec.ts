import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
import type { EventEnvelope } from '@reatiler/shared';

import { createOrderStore } from '../src/orders.js';
import { createPaymentCapturedHandler } from '../src/events/handlers.js';

const paymentCapturedEvent = (): EventEnvelope => ({
  eventName: 'PaymentCaptured',
  version: 1,
  eventId: 'evt-6',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
    paymentId: 'pay-1',
    orderId: 'order-1',
    amount: 199.99
  }
});

describe('order payment captured handler', () => {
  it('confirms the order and logs OrderConfirmed', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
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
      },
      status: 'PLACED',
      traceId: 'trace-1',
      requestId: 'trace-1'
    });

    const handler = createPaymentCapturedHandler({ store, bus, logger });

    await handler(paymentCapturedEvent());

    const order = store.get('order-1');
    expect(order?.status).toBe('CONFIRMED');

    const published = await bus.pop('orders-log');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('OrderConfirmed');
    expect(published?.data).toMatchObject({
      orderId: 'order-1',
      status: 'CONFIRMED'
    });
  });

  it('is idempotent on repeated PaymentCaptured events', async () => {
    const store = createOrderStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      orderId: 'order-2',
      lines: [
        {
          sku: 'SKU-9',
          qty: 1
        }
      ],
      amount: 49.99,
      address: {
        line1: 'Side St 45',
        city: 'Smallville',
        zip: '67890',
        country: 'AR'
      },
      status: 'PLACED',
      traceId: 'trace-2',
      requestId: 'trace-2'
    });

    const handler = createPaymentCapturedHandler({ store, bus, logger });
    const event: EventEnvelope = {
      ...paymentCapturedEvent(),
      eventId: 'evt-7',
      correlationId: 'order-2',
      data: {
        paymentId: 'pay-2',
        orderId: 'order-2',
        amount: 49.99
      }
    };

    await handler(event);
    await handler(event);

    const first = await bus.pop('orders-log');
    const second = await bus.pop('orders-log');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
