import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { routes } from '../src/http/routes.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(routes);
  await app.ready();
  return app;
}

describe('order contract', () => {
  it('POST /orders valida y responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/orders')
        .send({ requestId: 'r1', lines: [{ sku: 'SKU1', qty: 1 }], amount: 100 });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /orders 400 si falta amount', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/orders')
        .send({ requestId: 'r1', lines: [{ sku: 'SKU1', qty: 1 }] });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /orders/:id responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).get('/orders/ORD-1');
      expect(res.status).toBe(501);
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
