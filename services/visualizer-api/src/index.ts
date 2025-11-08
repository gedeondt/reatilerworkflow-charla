import Fastify from 'fastify';
import cors from '@fastify/cors';
import axios from 'axios';

type TraceEvent = {
  eventName: string;
  occurredAt: string;
};

type TraceDomain = {
  events: TraceEvent[];
};

export type TraceView = {
  traceId: string;
  lastUpdatedAt: string;
  domains: Record<string, TraceDomain>;
};

const QUEUE_BASE = process.env.QUEUE_BASE ?? 'http://localhost:3005';
const KV_BASE = process.env.KV_BASE ?? 'http://localhost:3200';
const SCENARIO_NAME = process.env.SCENARIO_NAME ?? 'retailer-happy-path';
const PORT = Number(process.env.PORT) || 3300;

const VISUALIZER_QUEUE = 'visualizer';
const EMPTY_DELAY_MS = 200;
const ERROR_DELAY_MS = 1000;

const app = Fastify({ logger: true });

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const namespaceUrl = (namespace: string) =>
  `${KV_BASE}/kv/${encodeURIComponent(namespace)}`;

const recordUrl = (namespace: string, key: string) =>
  `${namespaceUrl(namespace)}/${encodeURIComponent(key)}`;

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

app.get('/traces', async (_request, reply) => {
  try {
    const response = await axios.get(namespaceUrl(SCENARIO_NAME), {
      validateStatus: (status) => status === 404 || (status >= 200 && status < 300),
    });

    if (response.status === 404) {
      return reply.send([]);
    }

    const payload = response.data;
    if (!Array.isArray(payload)) {
      return reply.send([]);
    }

    const traces = payload
      .map((entry: { key?: string; value?: TraceView }) => entry?.value)
      .filter((value): value is TraceView => Boolean(value));

    return reply.send(traces);
  } catch (error) {
    app.log.error({ err: error }, 'failed to load traces');
    return reply.send([]);
  }
});

type VisualizerEvent = {
  traceId?: string;
  domain?: string;
  metadata?: {
    domain?: string;
  };
  eventName?: string;
  occurredAt?: string;
};

const resolveDomain = (event: VisualizerEvent): string => {
  if (typeof event.domain === 'string' && event.domain.length > 0) {
    return event.domain;
  }

  const metadataDomain = event.metadata?.domain;
  if (typeof metadataDomain === 'string' && metadataDomain.length > 0) {
    return metadataDomain;
  }

  return 'unknown';
};

export const applyEventToState = async (event: VisualizerEvent): Promise<void> => {
  const traceId = typeof event.traceId === 'string' && event.traceId.length > 0 ? event.traceId : 'unknown';
  const domain = resolveDomain(event);
  const eventName = typeof event.eventName === 'string' && event.eventName.length > 0 ? event.eventName : 'UnknownEvent';
  const occurredAt = typeof event.occurredAt === 'string' && event.occurredAt.length > 0 ? event.occurredAt : new Date().toISOString();

  const key = `trace:${traceId}`;
  const url = recordUrl(SCENARIO_NAME, key);

  let current: TraceView | null = null;

  const response = await axios.get(url, {
    validateStatus: (status) => status === 404 || (status >= 200 && status < 300),
  });

  if (response.status !== 404) {
    current = response.data as TraceView;
  }

  if (!current) {
    current = {
      traceId,
      lastUpdatedAt: occurredAt,
      domains: {},
    };
  }

  if (!current.domains[domain]) {
    current.domains[domain] = { events: [] };
  }

  current.domains[domain].events.push({ eventName, occurredAt });
  current.lastUpdatedAt = occurredAt;

  await axios.put(url, current);
};

const consumeLoop = async (): Promise<void> => {
  for (;;) {
    try {
      const response = await axios.post(
        `${QUEUE_BASE}/queues/${encodeURIComponent(VISUALIZER_QUEUE)}/pop`,
        {},
        { validateStatus: () => true },
      );

      if (response.status !== 200 || !response.data) {
        await delay(EMPTY_DELAY_MS);
        continue;
      }

      const message = (response.data as { message?: VisualizerEvent }).message;

      if (!message) {
        await delay(EMPTY_DELAY_MS);
        continue;
      }

      try {
        await applyEventToState(message);
      } catch (error) {
        app.log.error({ err: error }, 'failed to apply event to state');
        await delay(ERROR_DELAY_MS);
      }
    } catch (error) {
      app.log.error({ err: error }, 'failed to consume from queue');
      await delay(ERROR_DELAY_MS);
    }
  }
};

if (process.env.NODE_ENV !== 'test') {
  app
    .listen({ port: PORT, host: '0.0.0.0' })
    .then(() => {
      app.log.info(`visualizer-api listening on ${PORT}`);
      consumeLoop().catch((error) => {
        app.log.error({ err: error }, 'consume loop crashed');
      });
    })
    .catch((error) => {
      app.log.error({ err: error }, 'failed to start visualizer-api');
      process.exit(1);
    });
}

export { app, consumeLoop };
