import { FastifyInstance } from 'fastify';
import { CreateOrderReq, OrderIdParams } from './schemas.js';

export async function routes(app: FastifyInstance) {
  app.post('/orders', async (req, reply) => {
    const body = CreateOrderReq.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/orders/:id/cancel', async (req, reply) => {
    const params = OrderIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.get('/orders/:id', async (req, reply) => {
    const params = OrderIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });
}
