import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { envelopeSchema } from './types';
import { push, pop } from './queue';

export async function routes(app: FastifyInstance) {
  const paramsName = z.object({ name: z.string().min(1) });

  app.post('/queues/:name/messages', async (req) => {
    const { name } = paramsName.parse(req.params);
    const body = envelopeSchema.parse(req.body);
    push(name, body);
    return { status: 'ok' };
  });

  app.post('/queues/:name:pop', async (req) => {
    const { name } = paramsName.parse(req.params);
    const msg = pop(name);
    if (!msg) return { status: 'empty' };
    return { message: msg };
  });
}
