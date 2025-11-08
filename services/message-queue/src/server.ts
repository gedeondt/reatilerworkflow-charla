import Fastify from 'fastify';
import { routes } from './routes.js';

export function buildServer() {
  const logLevel = process.env.LOG_LEVEL ?? 'warn';

  const app = Fastify({
    logger: { level: logLevel },
    requestTimeout: 5000,
    connectionTimeout: 5000
  });

  app.addHook('onResponse', (request, reply, done) => {
    const [path] = request.url.split('?');
    const isRoutineRoute =
      path === '/traces' ||
      path === '/logs' ||
      path === '/scenario' ||
      path.startsWith('/kv/');

    if (isRoutineRoute) {
      done();
      return;
    }

    request.log.info({ url: request.url, statusCode: reply.statusCode }, 'handled');
    done();
  });

  app.get('/health', async () => ({ status: 'ok', service: 'message-queue' }));
  app.register(routes);

  return app;
}
