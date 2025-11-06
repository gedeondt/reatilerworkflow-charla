import { FastifyInstance } from 'fastify';
import { AuthorizePaymentRequest, PaymentActionRequest, PaymentIdParams } from './schemas.js';

export async function routes(app: FastifyInstance) {
  app.post('/payments/authorize', async (req, reply) => {
    const body = AuthorizePaymentRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/payments/capture', async (req, reply) => {
    const body = PaymentActionRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/payments/refund', async (req, reply) => {
    const body = PaymentActionRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.get('/payments/:id', async (req, reply) => {
    const params = PaymentIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });
}
