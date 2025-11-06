import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { routes } from '../src/http/routes.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(routes);
  await app.ready();
  return app;
}

describe('inventory contract', () => {
  it('POST /reservations valida y responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/reservations')
        .send({ orderId: 'ORD-1', items: [{ sku: 'SKU1', qty: 1 }] });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /reservations 400 si faltan items', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/reservations')
        .send({ orderId: 'ORD-1' });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /reservations/:id responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).get('/reservations/RSV-1');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /reservations/:id/commit responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).post('/reservations/RSV-1/commit');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /reservations/:id/release responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).post('/reservations/RSV-1/release');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });
});
