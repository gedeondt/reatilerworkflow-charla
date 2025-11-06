import { FastifyInstance } from 'fastify';
import { CreateShipmentRequest, ShipmentIdParams } from './schemas.js';

export async function routes(app: FastifyInstance) {
  app.post('/shipments', async (req, reply) => {
    const body = CreateShipmentRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.get('/shipments/:id', async (req, reply) => {
    const params = ShipmentIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.post('/shipments/:id/dispatch', async (req, reply) => {
    const params = ShipmentIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });
}
