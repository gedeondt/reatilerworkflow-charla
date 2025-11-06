import { FastifyInstance } from 'fastify';

import { z } from '@reatiler/shared/z';

import { InMemoryQueue } from './queue.js';
import { EventEnvelope } from './types.js';

export const eventEnvelopeSchema = z.object({
  eventName: z.string().min(1),
  version: z.literal(1),
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  correlationId: z.string().min(1),
  occurredAt: z.string().datetime(),
  causationId: z.string().min(1).optional(),
  data: z.record(z.any())
});

type QueueParams = {
  name: string;
};

export function registerQueueRoutes(server: FastifyInstance, queue: InMemoryQueue) {
  server.post<{ Params: QueueParams; Body: EventEnvelope }>('/queues/:name/messages', async (request, reply) => {
    const result = eventEnvelopeSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        status: 'error',
        message: 'Invalid event envelope',
        issues: result.error.flatten()
      });
    }

    queue.push(request.params.name, result.data);

    return reply.status(202).send({ status: 'enqueued' });
  });

  server.post<{ Params: QueueParams }>('/queues/:name/pop', async (request, reply) => {
    const message = queue.pop(request.params.name);

    if (!message) {
      return reply.send({ status: 'empty' });
    }

    return reply.send({ status: 'ok', message });
  });
}
