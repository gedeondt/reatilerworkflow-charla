import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
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

    expect(pop<typeof baseEnvelope>('orders')?.eventId).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
    expect(pop<typeof baseEnvelope>('orders')?.eventId).toBe(
      '00000000-0000-0000-0000-000000000002'
    );
    expect(pop<typeof baseEnvelope>('orders')).toBeNull();
  });
});

describe('queue routes', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('enqueues messages via HTTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/queues/orders/messages',
      payload: baseEnvelope
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns the next message when popping', async () => {
    await app.inject({ method: 'POST', url: '/queues/orders/messages', payload: baseEnvelope });
    const response = await app.inject({ method: 'POST', url: '/queues/orders/pop' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: baseEnvelope });
  });

  it('indicates empty queue when there are no messages', async () => {
    const response = await app.inject({ method: 'POST', url: '/queues/orders/pop' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'empty' });
  });

  it('mirrors enqueued messages to the visualizer queue', async () => {
    await app.inject({ method: 'POST', url: '/queues/orders/messages', payload: baseEnvelope });

    const ordersMessage = pop<typeof baseEnvelope>('orders');
    expect(ordersMessage).toEqual(baseEnvelope);

    const mirrored = pop<{ queue: string; message: typeof baseEnvelope }>('visualizer');
    expect(mirrored).toEqual({ queue: 'orders', message: baseEnvelope });
  });
});
