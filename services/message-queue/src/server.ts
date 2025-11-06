import Fastify from 'fastify';

import { createLogger } from '@reatiler/shared/logger';

import { InMemoryQueue } from './queue.js';
import { registerQueueRoutes } from './routes.js';

export function buildServer(queue: InMemoryQueue = new InMemoryQueue()) {
  const logger = createLogger({ service: 'message-queue' });

  const server = Fastify({
    logger
  });

  server.get('/health', async () => ({ status: 'ok' }));

  registerQueueRoutes(server, queue);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT ?? '3005', 10);

  const server = buildServer();

  server
    .listen({ port, host: '0.0.0.0' })
    .then((address) => {
      server.log.info(`message-queue service listening on ${address}`);
    })
    .catch((error) => {
      server.log.error(error, 'Failed to start message-queue service');
      process.exit(1);
    });
}
