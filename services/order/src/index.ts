import Fastify from 'fastify';
import { routes } from './http/routes.js';
import { env } from './env.js';

const server = Fastify({ logger: true });

server.get('/health', async () => ({ status: 'ok', service: 'order' }));
server.register(routes);

const port = env.PORT;
server.listen({ port, host: '0.0.0.0' })
  .then(() => server.log.info(`listening on ${port}`))
  .catch((err) => { server.log.error(err); process.exit(1); });

process.on('SIGINT', () => server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => server.close().then(() => process.exit(0)));
