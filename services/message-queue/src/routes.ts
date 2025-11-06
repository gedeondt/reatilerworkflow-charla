import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eventEnvelopeSchema } from '@reatiler/shared';
import { push, pop } from './queue.js';

export async function routes(app: FastifyInstance) {
  const paramsName = z.object({ name: z.string().min(1) });

  app.post('/queues/:name/messages', async (req) => {
    const { name } = paramsName.parse(req.params);
    const body = eventEnvelopeSchema.parse(req.body);
    push(name, body);
    app.log.info(
      {
        queue: name,
        eventName: body.eventName,
        eventId: body.eventId
      },
      'message enqueued'
    );
    return { status: 'ok' };
  });

  app.post('/queues/:name/pop', async (req) => {
    const { name } = paramsName.parse(req.params);
    const msg = pop(name);
    if (!msg) {
      return { status: 'empty' };
    }
    app.log.info(
      {
        queue: name,
        eventName: msg.eventName,
        eventId: msg.eventId
      },
      'message dequeued'
    );
    return { message: msg };
  });
}
