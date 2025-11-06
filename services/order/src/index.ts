import Fastify from 'fastify';

import { createHttpEventBus } from '@reatiler/shared';

import { env } from './env.js';
import { routes } from './http/routes.js';
import { createDispatcher } from './events/dispatcher.js';
import { createWorker } from './events/worker.js';
import { createOrderStore } from './orders.js';
import {
  createInventoryReservedHandler,
  createInventoryReservationFailedHandler,
  createPaymentFailedHandler,
  createPaymentCapturedHandler,
  createInventoryReleasedHandler,
  createPaymentRefundedHandler
} from './events/handlers.js';

const server = Fastify({ logger: true });
const bus = createHttpEventBus(env.MESSAGE_QUEUE_URL);
const dispatcher = createDispatcher(server.log);
const store = createOrderStore();
const worker = createWorker({
  logger: server.log,
  dispatcher,
  bus,
  pollIntervalMs: env.WORKER_POLL_MS
});

dispatcher.registerHandler(
  'InventoryReserved',
  createInventoryReservedHandler({ store, logger: server.log })
);

dispatcher.registerHandler(
  'InventoryReservationFailed',
  createInventoryReservationFailedHandler({ store, bus, logger: server.log })
);

dispatcher.registerHandler(
  'PaymentFailed',
  createPaymentFailedHandler({ store, bus, logger: server.log })
);

dispatcher.registerHandler(
  'PaymentCaptured',
  createPaymentCapturedHandler({ store, bus, logger: server.log })
);

dispatcher.registerHandler(
  'InventoryReleased',
  createInventoryReleasedHandler({ store, bus, logger: server.log })
);

dispatcher.registerHandler(
  'PaymentRefunded',
  createPaymentRefundedHandler({ store, bus, logger: server.log })
);

worker.start();

server.get('/health', async () => ({
  status: 'ok',
  service: 'order',
  worker: worker.isRunning() ? 'up' : 'down'
}));

server.register(async (app) => routes(app, { bus, store, logger: server.log }));

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
