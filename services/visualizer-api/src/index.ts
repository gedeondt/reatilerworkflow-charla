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

type VisualizerEvent = {
  traceId?: string;
  correlationId?: string;
  domain?: string;
  metadata?: {
    domain?: string;
  };
  eventName?: string;
  occurredAt?: string;
};

export type NormalizedVisualizerEvent = {
  traceId: string;
  domain: string;
  eventName: string;
  occurredAt: string;
};

type LogEntry = {
  traceId: string;
  domain: string;
  eventName: string;
  occurredAt: string;
};

const QUEUE_BASE = process.env.QUEUE_BASE ?? 'http://localhost:3005';
const KV_BASE = process.env.KV_BASE ?? 'http://localhost:3200';
const SCENARIO_NAME = process.env.SCENARIO_NAME ?? 'retailer-happy-path';
const PORT = Number(process.env.PORT) || 3300;

const VISUALIZER_QUEUE = 'visualizer';
const EMPTY_DELAY_MS = 200;
const ERROR_DELAY_MS = 1000;
const LOG_BUFFER_SIZE = 200;

const logBuffer: LogEntry[] = [];

const appendLogEntry = (entry: LogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
  }
};

const getLogEntries = (): LogEntry[] => [...logBuffer];

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

app.get('/logs', async (_request, reply) => {
  return reply.send(getLogEntries());
});

const resolveTraceId = (event: VisualizerEvent): string => {
  if (typeof event.traceId === 'string' && event.traceId.length > 0) {
    return event.traceId;
  }

  if (typeof event.correlationId === 'string' && event.correlationId.length > 0) {
    return event.correlationId;
  }

  return 'unknown';
};

const resolveDomain = (event: VisualizerEvent, queue?: string): string => {
  if (typeof event.domain === 'string' && event.domain.length > 0) {
    return event.domain;
  }

  const metadataDomain = event.metadata?.domain;
  if (typeof metadataDomain === 'string' && metadataDomain.length > 0) {
    return metadataDomain;
  }

  if (typeof queue === 'string' && queue.length > 0) {
    return queue;
  }

  return 'unknown';
};

const resolveEventName = (event: VisualizerEvent): string => {
  if (typeof event.eventName === 'string' && event.eventName.length > 0) {
    return event.eventName;
  }

  return 'UnknownEvent';
};

const resolveOccurredAt = (event: VisualizerEvent): string => {
  if (typeof event.occurredAt === 'string' && event.occurredAt.length > 0) {
    return event.occurredAt;
  }

  return new Date().toISOString();
};

const unwrapMessage = (payload: unknown): { event: VisualizerEvent | null; queue?: string } => {
  if (!payload || typeof payload !== 'object') {
    return { event: null };
  }

  let current: unknown = payload;
  let queue: string | undefined;

  while (current && typeof current === 'object' && 'message' in current) {
    const container = current as { message?: unknown; queue?: unknown };
    if (typeof container.queue === 'string' && !queue) {
      queue = container.queue;
    }
    current = container.message;
  }

  if (!current || typeof current !== 'object') {
    return { event: null, queue };
  }

  return { event: current as VisualizerEvent, queue };
};

const normalizeVisualizerPayload = (payload: unknown): NormalizedVisualizerEvent | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if ('status' in payload && !('message' in (payload as Record<string, unknown>))) {
    return null;
  }

  const { event, queue } = unwrapMessage(payload);

  if (!event) {
    return null;
  }

  return {
    traceId: resolveTraceId(event),
    domain: resolveDomain(event, queue),
    eventName: resolveEventName(event),
    occurredAt: resolveOccurredAt(event),
  };
};

export const applyEventToState = async (event: NormalizedVisualizerEvent): Promise<void> => {
  const { traceId, domain, eventName, occurredAt } = event;

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

      const normalized = normalizeVisualizerPayload(response.data);

      if (!normalized) {
        await delay(EMPTY_DELAY_MS);
        continue;
      }

      try {
        await applyEventToState(normalized);
        appendLogEntry({
          traceId: normalized.traceId,
          domain: normalized.domain,
          eventName: normalized.eventName,
          occurredAt: normalized.occurredAt,
        });
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

const resetLogBuffer = () => {
  logBuffer.splice(0, logBuffer.length);
};

export const __testing = {
  normalizeVisualizerPayload,
  resetLogBuffer,
  getLogEntries,
};

export { app, consumeLoop };
