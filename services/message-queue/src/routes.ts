import type { FastifyInstance } from 'fastify';

import { InMemoryQueue } from './queue.js';
import { EventEnvelopeSchema, type EventEnvelope } from './types.js';

type QueueParams = {
  name: string;
};

type PopQueueParams = {
  name?: string;
  'name:pop'?: string;
};

function resolveQueueName(params: PopQueueParams): string {
  const rawName = params.name ?? params['name:pop'] ?? '';
  return rawName.replace(/:pop$/, '');
}

export function registerQueueRoutes(server: FastifyInstance, queue: InMemoryQueue) {
  server.post<{ Params: QueueParams; Body: unknown }>('/queues/:name/messages', async (request, reply) => {
    const result = EventEnvelopeSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        error: 'Invalid event envelope',
        issues: result.error.flatten()
      });
    }

    const envelope: EventEnvelope = result.data;
    queue.push(request.params.name, envelope);

    return reply.status(202).send({ status: 'enqueued' });
  });

  server.post<{ Params: PopQueueParams }>('/queues/:name:pop', async (request, reply) => {
    const queueName = resolveQueueName(request.params);
    const message = queue.pop(queueName);

    if (!message) {
      return reply.send({ status: 'empty' });
    }

    return reply.send({ message });
  });
}
