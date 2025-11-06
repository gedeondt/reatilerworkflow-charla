import Fastify from 'fastify';

import { createLogger, loadEnv } from '@reatiler/shared';

import { InMemoryQueue } from './queue.js';
import { registerQueueRoutes } from './routes.js';

const env = loadEnv(undefined, { PORT: 3005 });

export function buildServer(queue: InMemoryQueue = new InMemoryQueue()) {
  const server = Fastify({
    logger: createLogger({ service: 'message-queue', level: env.LOG_LEVEL })
  });

  server.get('/health', async () => ({ status: 'ok', service: 'message-queue' }));

  registerQueueRoutes(server, queue);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();

  server
    .listen({ port: env.PORT, host: '0.0.0.0' })
    .catch((error) => {
      server.log.error(error, 'Failed to start message-queue service');
      process.exit(1);
    });
}
