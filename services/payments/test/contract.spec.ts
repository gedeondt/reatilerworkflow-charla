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

describe('payments contract', () => {
  it('POST /payments/authorize valida y responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/payments/authorize')
        .send({ orderId: 'ORD-1', amount: 100 });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /payments/authorize 400 si falta amount', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/payments/authorize')
        .send({ orderId: 'ORD-1' });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /payments/capture valida y responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/payments/capture')
        .send({ paymentId: 'PAY-1' });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('POST /payments/capture 400 si falta paymentId', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/payments/capture')
        .send({});
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /payments/refund responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server)
        .post('/payments/refund')
        .send({ paymentId: 'PAY-1' });
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });

  it('GET /payments/:id responde 501', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.server).get('/payments/PAY-1');
      expect(res.status).toBe(501);
    } finally {
      await app.close();
    }
  });
});
