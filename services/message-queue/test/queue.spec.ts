import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { routes } from '../src/routes.js';
import { pop, push, _reset } from '../src/queue.js';

const baseEnvelope = {
  eventName: 'OrderPlaced',
  version: 1 as const,
  eventId: '00000000-0000-0000-0000-000000000001',
  traceId: 'trace-1',
  correlationId: 'corr-1',
  occurredAt: '2025-01-01T00:00:00.000Z',
  data: { orderId: 'ord-1' }
};

afterEach(() => {
  _reset();
});

describe('queue helpers', () => {
  it('push and pop preserve FIFO order', () => {
    push('orders', baseEnvelope);
    push('orders', { ...baseEnvelope, eventId: '00000000-0000-0000-0000-000000000002', traceId: 'trace-2' });

    expect(pop('orders')?.eventId).toBe('00000000-0000-0000-0000-000000000001');
    expect(pop('orders')?.eventId).toBe('00000000-0000-0000-0000-000000000002');
    expect(pop('orders')).toBeNull();
  });
});

describe('queue routes', () => {
  async function buildApp() {
    const app = Fastify();
    await app.register(routes);
    await app.ready();
    return app;
  }

  it('enqueues messages via HTTP', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/queues/orders/messages',
        payload: baseEnvelope
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns the next message when popping', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'POST', url: '/queues/orders/messages', payload: baseEnvelope });
      const response = await app.inject({ method: 'POST', url: '/queues/orders:pop' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: baseEnvelope });
    } finally {
      await app.close();
    }
  });

  it('indicates empty queue when there are no messages', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/queues/orders:pop' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'empty' });
    } finally {
      await app.close();
    }
  });
});
