import { FastifyInstance } from 'fastify';

import { CreateReservationRequest, ReservationIdParams } from './schemas.js';

type RoutesDependencies = {
  logger: FastifyInstance['log'];
};

export async function routes(app: FastifyInstance, _deps: RoutesDependencies) {
  app.post('/reservations', async (req, reply) => {
    const body = CreateReservationRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.get('/reservations/:id', async (req, reply) => {
    const params = ReservationIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/reservations/:id/commit', async (req, reply) => {
    const params = ReservationIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/reservations/:id/release', async (req, reply) => {
    const params = ReservationIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });
}
