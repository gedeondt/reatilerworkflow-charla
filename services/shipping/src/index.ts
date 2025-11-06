import Fastify from 'fastify';

import { createLogger } from '@reatiler/shared';

import { env } from './env.js';

const server = Fastify({
  logger: createLogger({ service: 'shipping', level: env.LOG_LEVEL })
});

server.get('/health', async () => ({ status: 'ok', service: 'shipping' }));

async function start() {
  try {
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    server.log.error(error, 'Failed to start shipping service');
    process.exit(1);
  }
}

start();
