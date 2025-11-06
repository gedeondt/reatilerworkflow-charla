import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { _reset } from '../src/queue.js';

const app = buildServer();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  _reset();
});

it('health responde', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok', service: 'message-queue' });
});

it('push y pop funcionan', async () => {
  const envelope = {
    eventName: 'Ping',
    version: 1 as const,
    eventId: 'e1',
    traceId: 't1',
    correlationId: 'c1',
    occurredAt: new Date().toISOString(),
    data: {}
  };

  const pushResponse = await app.inject({
    method: 'POST',
    url: '/queues/test/messages',
    payload: envelope
  });
  expect(pushResponse.statusCode).toBe(200);
  expect(pushResponse.json()).toEqual({ status: 'ok' });

  const popResponse = await app.inject({
    method: 'POST',
    url: '/queues/test/pop'
  });
  expect(popResponse.statusCode).toBe(200);
  expect(popResponse.json()).toEqual({ message: envelope });
});
