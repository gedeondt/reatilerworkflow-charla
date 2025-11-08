import process from 'node:process';

import cors from '@fastify/cors';
import axios, { AxiosInstance } from 'axios';
import fastify from 'fastify';

const DEFAULT_QUEUE_BASE = 'http://localhost:3005';
const DEFAULT_KV_BASE = 'http://localhost:3200';
const DEFAULT_SCENARIO_NAME = 'retailer-happy-path';
const DEFAULT_PORT = 3300;
const VISUALIZER_QUEUE = 'visualizer';
const EMPTY_DELAY_MS = 200;
const ERROR_DELAY_MS = 1000;

type TraceEvent = {
  eventName: string;
  occurredAt: string;
};

type TraceView = {
  traceId: string;
  lastUpdatedAt: string;
  domains: {
    [domainName: string]: {
      events: TraceEvent[];
    };
  };
};

type MirroredQueueMessage = {
  queue?: unknown;
  message?: unknown;
  event?: unknown;
};

type PopResponsePayload = {
  message?: unknown;
  status?: string;
};

const queueBase = process.env.QUEUE_BASE ?? DEFAULT_QUEUE_BASE;
const kvBase = process.env.KV_BASE ?? DEFAULT_KV_BASE;
const scenarioName = process.env.SCENARIO_NAME ?? DEFAULT_SCENARIO_NAME;
const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;

const app = fastify({ logger: true });

const queueClient: AxiosInstance = axios.create({
  baseURL: queueBase,
  timeout: 5000
});

const kvClient: AxiosInstance = axios.create({
  baseURL: kvBase,
  timeout: 5000
});

let shouldStop = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseTraceView(payload: unknown): TraceView | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const container = payload as { value?: unknown };
  const raw = 'value' in container ? container.value : payload;

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const traceId = candidate.traceId;
  const lastUpdatedAt = candidate.lastUpdatedAt;
  const domainsCandidate = candidate.domains;

  if (
    typeof traceId !== 'string' ||
    typeof lastUpdatedAt !== 'string' ||
    !domainsCandidate ||
    typeof domainsCandidate !== 'object'
  ) {
    return null;
  }

  const domainsEntries = Object.entries(domainsCandidate as Record<string, unknown>);
  const domains: TraceView['domains'] = {};

  for (const [domainName, value] of domainsEntries) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const eventsCandidate = (value as { events?: unknown }).events;
    const events: TraceEvent[] = Array.isArray(eventsCandidate)
      ? eventsCandidate
          .map((event): TraceEvent | null => {
            if (!event || typeof event !== 'object') {
              return null;
            }

            const { eventName, occurredAt } = event as Record<string, unknown>;

            if (typeof eventName !== 'string' || typeof occurredAt !== 'string') {
              return null;
            }

            return { eventName, occurredAt };
          })
          .filter((event): event is TraceEvent => event !== null)
      : [];

    domains[domainName] = { events };
  }

  return {
    traceId,
    lastUpdatedAt,
    domains
  };
}

async function fetchTrace(traceId: string): Promise<TraceView | null> {
  const key = `trace:${traceId}`;
  const url = `/kv/${encodeURIComponent(scenarioName)}/${encodeURIComponent(key)}`;

  const response = await kvClient.get(url, {
    validateStatus: (status) => status >= 200 && status < 300 || status === 404
  });

  if (response.status === 404) {
    return null;
  }

  const parsed = parseTraceView(response.data);

  if (!parsed) {
    throw new Error('Unexpected payload while fetching trace view.');
  }

  return parsed;
}

async function saveTrace(trace: TraceView): Promise<void> {
  const key = `trace:${trace.traceId}`;
  const url = `/kv/${encodeURIComponent(scenarioName)}/${encodeURIComponent(key)}`;

  await kvClient.put(url, { value: trace });
}

function buildUpdatedTrace(
  existing: TraceView | null,
  update: { traceId: string; domain: string; eventName: string; occurredAt: string }
): TraceView {
  const domains: TraceView['domains'] = existing
    ? Object.fromEntries(
        Object.entries(existing.domains).map(([domainName, value]) => [
          domainName,
          { events: [...value.events] }
        ])
      )
    : {};

  const domainEvents = domains[update.domain]?.events ?? [];
  const nextEvents = [...domainEvents, { eventName: update.eventName, occurredAt: update.occurredAt }];

  domains[update.domain] = { events: nextEvents };

  return {
    traceId: existing?.traceId ?? update.traceId,
    lastUpdatedAt: new Date().toISOString(),
    domains
  };
}

function extractDomain(event: Record<string, unknown>, fallbackQueue?: string): string {
  const directDomain = event.domain;

  if (typeof directDomain === 'string' && directDomain.length > 0) {
    return directDomain;
  }

  const metadata = event.metadata;

  if (metadata && typeof metadata === 'object') {
    const metadataDomain = (metadata as Record<string, unknown>).domain;

    if (typeof metadataDomain === 'string' && metadataDomain.length > 0) {
      return metadataDomain;
    }
  }

  if (typeof fallbackQueue === 'string' && fallbackQueue.length > 0) {
    return fallbackQueue;
  }

  return 'unknown';
}

async function popVisualizerEvent(): Promise<{ queue?: string; event: Record<string, unknown> } | null> {
  const response = await queueClient.post(`/queues/${encodeURIComponent(VISUALIZER_QUEUE)}/pop`, undefined, {
    validateStatus: () => true
  });

  if (response.status >= 400) {
    throw new Error(`Queue responded with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  const payload = response.data as PopResponsePayload | undefined;

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.status === 'empty') {
    return null;
  }

  const message = payload.message;

  if (!message || typeof message !== 'object') {
    return null;
  }

  const { queue, message: nestedMessage, event } = message as MirroredQueueMessage;

  let envelopeCandidate: unknown = null;

  if (nestedMessage && typeof nestedMessage === 'object') {
    envelopeCandidate = nestedMessage;
  } else if (event && typeof event === 'object') {
    envelopeCandidate = event;
  } else if (typeof (message as Record<string, unknown>).eventName === 'string') {
    envelopeCandidate = message;
  }

  if (!envelopeCandidate || typeof envelopeCandidate !== 'object') {
    return null;
  }

  return {
    queue: typeof queue === 'string' ? queue : undefined,
    event: envelopeCandidate as Record<string, unknown>
  };
}

async function processNextEvent(): Promise<boolean> {
  const payload = await popVisualizerEvent();

  if (!payload) {
    return false;
  }

  const { queue, event } = payload;

  const traceIdCandidate = event.traceId;
  const eventNameCandidate = event.eventName;
  const occurredAtCandidate = event.occurredAt;

  const traceId = typeof traceIdCandidate === 'string' && traceIdCandidate.length > 0 ? traceIdCandidate : 'unknown';
  const eventName = typeof eventNameCandidate === 'string' && eventNameCandidate.length > 0 ? eventNameCandidate : 'unknown';
  const occurredAt =
    typeof occurredAtCandidate === 'string' && occurredAtCandidate.length > 0
      ? occurredAtCandidate
      : new Date().toISOString();

  const domain = extractDomain(event, queue);

  let existing: TraceView | null = null;

  try {
    existing = await fetchTrace(traceId);
  } catch (error) {
    app.log.warn({ err: error, traceId }, 'failed to fetch existing trace view');
  }

  const updatedTrace = buildUpdatedTrace(existing, { traceId, domain, eventName, occurredAt });

  await saveTrace(updatedTrace);

  app.log.debug({ traceId, domain, eventName }, 'trace view updated');

  return true;
}

async function consumeLoop(): Promise<void> {
  while (!shouldStop) {
    try {
      const processed = await processNextEvent();

      if (!processed) {
        await delay(EMPTY_DELAY_MS);
      }
    } catch (error) {
      app.log.error({ err: error }, 'error while processing visualizer queue');
      await delay(ERROR_DELAY_MS);
    }
  }
}

async function listTraces(): Promise<TraceView[]> {
  const url = `/kv/${encodeURIComponent(scenarioName)}`;
  const response = await kvClient.get(url, {
    validateStatus: (status) => status >= 200 && status < 300 || status === 404
  });

  if (response.status === 404) {
    return [];
  }

  const payload = response.data;

  if (!payload) {
    return [];
  }

  const traces: TraceView[] = [];

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const parsed = parseTraceView(item);

      if (parsed) {
        traces.push(parsed);
      }
    }

    return traces;
  }

  if (typeof payload === 'object') {
    if (Array.isArray((payload as { items?: unknown }).items)) {
      const items = (payload as { items?: unknown[] }).items ?? [];

      for (const item of items) {
        const parsed = parseTraceView(item);

        if (parsed) {
          traces.push(parsed);
        }
      }

      return traces;
    }

    for (const value of Object.values(payload as Record<string, unknown>)) {
      const parsed = parseTraceView(value);

      if (parsed) {
        traces.push(parsed);
      }
    }
  }

  return traces;
}

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

app.get('/traces', async (_request, reply) => {
  try {
    const traces = await listTraces();
    return reply.send(traces);
  } catch (error) {
    app.log.error({ err: error }, 'failed to list traces');
    return reply.status(500).send({ error: 'Failed to load traces.' });
  }
});

const server = app;

let consumerPromise: Promise<void> | null = null;

async function start(): Promise<void> {
  consumerPromise = consumeLoop();

  try {
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info({ port }, 'visualizer-api listening');
  } catch (error) {
    server.log.error({ err: error }, 'failed to start visualizer-api');
    shouldStop = true;

    try {
      await consumerPromise;
    } catch (consumeError) {
      server.log.error({ err: consumeError }, 'consumer loop failed during startup');
    }

    process.exit(1);
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shouldStop) {
    return;
  }

  shouldStop = true;
  server.log.info({ signal }, 'shutting down visualizer-api');

  try {
    await server.close();
  } catch (error) {
    server.log.error({ err: error }, 'error while closing server');
  }

  try {
    await consumerPromise;
  } catch (error) {
    server.log.error({ err: error }, 'error while stopping consumer loop');
  }

  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal as NodeJS.Signals);
  });
});

await start();
