import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { FakeEventBus } from '@reatiler/shared/event-bus';

import { routes } from '../src/http/routes.js';
import { createOrderStore } from '../src/orders.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const store = createOrderStore();
  const bus = new FakeEventBus();
  await app.register(async (instance) => routes(instance, { bus, store, logger: app.log }));
  await app.ready();
  return app;
}

describe('order contract', () => {
  it('POST /orders valida y responde 201', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/orders')
        .send({
          requestId: 'r1',
          lines: [{ sku: 'SKU1', qty: 1 }],
          amount: 100,
          address: {
            line1: 'Main St 123',
            city: 'Metropolis',
            zip: '12345',
            country: 'AR'
          }
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ orderId: expect.any(String), status: 'PLACED' });
    } finally {
      await app.close();
    }
  });

  it('POST /orders 400 si falta amount', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/orders')
        .send({
          requestId: 'r1',
          lines: [{ sku: 'SKU1', qty: 1 }],
          address: {
            line1: 'Main St 123',
            city: 'Metropolis',
            zip: '12345',
            country: 'AR'
          }
        });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /orders/:id responde 404 si no existe', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).get('/orders/ORD-1');
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('POST /orders/:id/cancel responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).post('/orders/ORD-1/cancel');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });
});
