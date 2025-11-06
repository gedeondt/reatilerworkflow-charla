import Fastify from 'fastify';

import { env } from './env.js';
import { routes } from './http/routes.js';
import { createDispatcher } from './events/dispatcher.js';
import { createWorker } from './events/worker.js';

const server = Fastify({ logger: true });
const dispatcher = createDispatcher(server.log);
const worker = createWorker({ logger: server.log, dispatcher });

worker.start();

server.get('/health', async () => ({
  status: 'ok',
  service: 'inventory',
  worker: worker.isRunning() ? 'up' : 'down'
}));

server.register(routes);

const port = env.PORT;

server
  .listen({ port, host: '0.0.0.0' })
  .then(() => server.log.info(`listening on ${port}`))
  .catch(async (err) => {
    server.log.error(err);
    await worker.stop();
    process.exit(1);
  });

const shutdown = async () => {
  try {
    await worker.stop();
    await server.close();
    process.exit(0);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
