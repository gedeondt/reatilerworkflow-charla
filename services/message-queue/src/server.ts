import Fastify from 'fastify';
import { routes } from './routes';

export function buildServer() {
  const app = Fastify({
    logger: true,
    requestTimeout: 5000,
    connectionTimeout: 5000
  });

  app.get('/health', async () => ({ status: 'ok', service: 'message-queue' }));
  app.register(routes);

  return app;
}
