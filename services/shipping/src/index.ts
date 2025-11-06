import Fastify from 'fastify';

import { createEnvEventBus } from '@reatiler/shared';

import { env } from './env.js';
import { routes } from './http/routes.js';
import { createDispatcher } from './events/dispatcher.js';
import { createWorker } from './events/worker.js';
import { createShipmentStore } from './shipments.js';
import { createPaymentAuthorizedHandler } from './events/handlers.js';

const server = Fastify({ logger: true });
const bus = createEnvEventBus();
const dispatcher = createDispatcher(server.log);
const store = createShipmentStore();
const worker = createWorker({
  logger: server.log,
  dispatcher,
  bus,
  pollIntervalMs: env.WORKER_POLL_MS
});

dispatcher.registerHandler(
  'PaymentAuthorized',
  createPaymentAuthorizedHandler({
    store,
    bus,
    logger: server.log,
    allowPrepare: env.ALLOW_PREPARE,
    opTimeoutMs: env.OP_TIMEOUT_MS
  })
);

worker.start();

server.get('/health', async () => {
  const status = worker.getStatus();

  return {
    status: 'ok',
    service: 'shipping',
    worker: status.running ? 'up' : 'down',
    queueName: status.queueName,
    processedCount: status.processedCount,
    lastEventAt: status.lastEventAt
  };
});

server.register(async (app) => routes(app, { logger: server.log }));

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
