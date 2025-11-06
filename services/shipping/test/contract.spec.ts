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

describe('shipping contract', () => {
  it('POST /shipments valida y responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/shipments')
        .send({
          orderId: 'ORD-1',
          address: { line1: 'Calle', city: 'Ciudad', zip: '1234', country: 'AR' }
        });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /shipments 400 si falta address', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/shipments')
        .send({ orderId: 'ORD-1' });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /shipments/:id responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).get('/shipments/SHP-1');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /shipments/:id/dispatch responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).post('/shipments/SHP-1/dispatch');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });
});
