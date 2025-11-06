import { describe, expect, it } from 'vitest';

import { InMemoryQueue } from '../src/queue.js';
import { buildServer } from '../src/server.js';

const baseEnvelope = {
  eventName: 'OrderPlaced',
  version: 1 as const,
  eventId: 'evt-1',
  traceId: 'trace-1',
  correlationId: 'corr-1',
  occurredAt: new Date().toISOString(),
  data: { orderId: 'ord-1' }
};

describe('InMemoryQueue', () => {
  it('pushes and pops messages for a queue', () => {
    const queue = new InMemoryQueue();

    queue.push('orders', baseEnvelope);
    const message = queue.pop('orders');

    expect(message).toEqual(baseEnvelope);
  });

  it('preserves FIFO ordering', () => {
    const queue = new InMemoryQueue();

    queue.push('orders', baseEnvelope);
    queue.push('orders', { ...baseEnvelope, eventId: 'evt-2', traceId: 'trace-2' });

    expect(queue.pop('orders')?.eventId).toBe('evt-1');
    expect(queue.pop('orders')?.eventId).toBe('evt-2');
    expect(queue.pop('orders')).toBeNull();
  });
});

describe('queue routes', () => {
  it('validates event envelopes on publish', async () => {
    const server = buildServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/queues/orders/messages',
      payload: { ...baseEnvelope, version: 2 }
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it('enqueues and dequeues messages via HTTP routes', async () => {
    const server = buildServer();
    await server.ready();

    const enqueueResponse = await server.inject({
      method: 'POST',
      url: '/queues/orders/messages',
      payload: baseEnvelope
    });

    expect(enqueueResponse.statusCode).toBe(202);

    const popResponse = await server.inject({
      method: 'POST',
      url: '/queues/orders/pop'
    });

    expect(popResponse.statusCode).toBe(200);
    expect(popResponse.json()).toEqual({ status: 'ok', message: baseEnvelope });

    await server.close();
  });
});
