import Fastify from 'fastify';
import { routes } from './routes';

const server = Fastify({
  logger: true,
  requestTimeout: 5000,
  connectionTimeout: 5000
});

server.get('/health', async () => ({ status: 'ok', service: 'message-queue' }));
server.register(routes);

const port = Number(process.env.PORT ?? 3005);
server.listen({ port, host: '0.0.0.0' })
  .then(() => server.log.info(`listening on ${port}`))
  .catch((err) => { server.log.error(err); process.exit(1); });

process.on('SIGINT', () => server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => server.close().then(() => process.exit(0)));
