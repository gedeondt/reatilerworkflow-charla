import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';
import { push, pop, resetQueues } from './queue.js';

type MirroredMessage = {
  queue: string;
  message: EventEnvelope;
};

export async function routes(app: FastifyInstance) {
  const paramsName = z.object({ name: z.string().min(1) });

  app.post('/queues/:name/messages', async (req) => {
    const { name } = paramsName.parse(req.params);
    const body = eventEnvelopeSchema.parse(req.body);
    push(name, body);

    const mirrored: MirroredMessage = {
      queue: name,
      message: body
    };

    push('visualizer', mirrored);
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
    const msg = pop<EventEnvelope>(name);
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

  app.post('/admin/reset', async (_req, reply) => {
    resetQueues();
    return reply.status(204).send();
  });
}
