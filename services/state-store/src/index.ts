import Fastify from 'fastify';
import cors from '@fastify/cors';

type NamespaceStore = Map<string, unknown>;
const store = new Map<string, NamespaceStore>();

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
  methods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
});

app.put<{ Params: { ns: string; key: string } }>('/kv/:ns/:key', async (request, reply) => {
  const { ns, key } = request.params;
  const value = request.body as unknown;

  let namespace = store.get(ns);
  if (!namespace) {
    namespace = new Map();
    store.set(ns, namespace);
  }

  namespace.set(key, value);

  return reply.status(204).send();
});

app.get<{ Params: { ns: string; key: string } }>('/kv/:ns/:key', async (request, reply) => {
  const { ns, key } = request.params;
  const namespace = store.get(ns);

  if (!namespace || !namespace.has(key)) {
    return reply.status(404).send();
  }

  return reply.send(namespace.get(key));
});

app.get<{ Params: { ns: string } }>('/kv/:ns', async (request, reply) => {
  const { ns } = request.params;
  const namespace = store.get(ns);
  const entries: Array<{ key: string; value: unknown }> = [];

  if (namespace) {
    for (const [key, value] of namespace.entries()) {
      entries.push({ key, value });
    }
  }

  return reply.send(entries);
});

app.delete<{ Params: { ns: string; key: string } }>('/kv/:ns/:key', async (request, reply) => {
  const { ns, key } = request.params;
  const namespace = store.get(ns);

  if (namespace) {
    namespace.delete(key);
    if (namespace.size === 0) {
      store.delete(ns);
    }
  }

  return reply.status(204).send();
});

app.delete<{ Params: { ns: string } }>('/kv/:ns', async (request, reply) => {
  const { ns } = request.params;
  store.delete(ns);
  return reply.status(204).send();
});

app.get('/health', async (_request, reply) => {
  return reply.send({ ok: true });
});

const portValue = process.env.PORT;
const port = portValue ? Number(portValue) : 3200;

if (Number.isNaN(port)) {
  throw new TypeError(`Invalid PORT value: ${portValue}`);
}

const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`state-store listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
