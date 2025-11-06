import { describe, expect, it } from 'vitest';

import { InMemoryQueue } from '../src/queue.js';
import { buildServer } from '../src/server.js';

const baseEnvelope = {
  eventName: 'OrderPlaced',
  version: 1 as const,
  eventId: '00000000-0000-0000-0000-000000000001',
  traceId: 'trace-1',
  correlationId: 'corr-1',
  occurredAt: '2025-01-01T00:00:00.000Z',
  data: { orderId: 'ord-1' }
};

describe('InMemoryQueue', () => {
  it('pushes and pops messages in FIFO order', () => {
    const queue = new InMemoryQueue();

    queue.push('orders', baseEnvelope);
    queue.push('orders', { ...baseEnvelope, eventId: '00000000-0000-0000-0000-000000000002', traceId: 'trace-2' });

    expect(queue.pop('orders')?.eventId).toBe('00000000-0000-0000-0000-000000000001');
    expect(queue.pop('orders')?.eventId).toBe('00000000-0000-0000-0000-000000000002');
    expect(queue.pop('orders')).toBeNull();
  });
});

describe('queue routes', () => {
  it('rejects envelopes missing identifiers', async () => {
    const server = buildServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/queues/orders/messages',
      payload: {
        ...baseEnvelope,
        eventId: undefined
      }
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error).toBe('Invalid event envelope');

    await server.close();
  });

  it('rejects envelopes with invalid version', async () => {
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

  it('returns empty status when queue has no messages', async () => {
    const server = buildServer();
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/queues/orders:pop'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'empty' });

    await server.close();
  });

  it('enqueues and dequeues messages via HTTP routes', async () => {
    const queue = new InMemoryQueue();
    const server = buildServer(queue);
    await server.ready();

    const enqueueResponse = await server.inject({
      method: 'POST',
      url: '/queues/orders/messages',
      payload: baseEnvelope
    });

    expect(enqueueResponse.statusCode).toBe(202);
    expect(queue.size('orders')).toBe(1);

    const popResponse = await server.inject({
      method: 'POST',
      url: '/queues/orders:pop'
    });

    expect(popResponse.statusCode).toBe(200);
    expect(popResponse.json()).toEqual({ message: baseEnvelope });

    await server.close();
  });
});
