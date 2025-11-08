import Fastify from 'fastify';
import cors from '@fastify/cors';

type NamespaceStore = Map<string, unknown>;

type KvParams = {
  ns: string;
  key: string;
};

type NamespaceParams = {
  ns: string;
};

const app = Fastify({ logger: true });
const store = new Map<string, NamespaceStore>();

const getNamespace = (namespace: string): NamespaceStore => {
  let map = store.get(namespace);
  if (!map) {
    map = new Map();
    store.set(namespace, map);
  }

  return map;
};

await app.register(cors, { origin: true });

app.put<{ Params: KvParams; Body: unknown }>('/kv/:ns/:key', async (request, reply) => {
  const { ns, key } = request.params;
  const value = request.body;

  const namespace = getNamespace(ns);
  namespace.set(key, value);

  return reply.status(204).send();
});

app.get<{ Params: KvParams }>('/kv/:ns/:key', async (request, reply) => {
  const { ns, key } = request.params;
  const namespace = store.get(ns);

  if (!namespace || !namespace.has(key)) {
    return reply.status(404).send();
  }

  return reply.send(namespace.get(key));
});

app.get<{ Params: NamespaceParams }>('/kv/:ns', async (request, reply) => {
  const { ns } = request.params;
  const namespace = store.get(ns);

  if (!namespace) {
    return reply.send([]);
  }

  const entries = Array.from(namespace.entries()).map(([key, value]) => ({ key, value }));
  return reply.send(entries);
});

app.delete<{ Params: KvParams }>('/kv/:ns/:key', async (request, reply) => {
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

app.delete<{ Params: NamespaceParams }>('/kv/:ns', async (request, reply) => {
  const { ns } = request.params;
  store.delete(ns);

  return reply.status(204).send();
});

app.get('/health', async (_request, reply) => {
  return reply.send({ ok: true });
});

const port = Number(process.env.PORT) || 3200;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`state-store listening on port ${port}`);
} catch (error) {
  app.log.error({ err: error }, 'Failed to start state-store');
  process.exit(1);
}
