import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import axios from 'axios';
import { z } from 'zod';
import { scenarioSchema, type Scenario } from '@reatiler/saga-kernel';

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

type ScenarioBootstrapEvent = {
  eventName: string;
  data: Record<string, unknown>;
} & Record<string, unknown>;

type ScenarioBootstrapExample = {
  queue: string;
  event: ScenarioBootstrapEvent;
};

type LogEntry = {
  traceId: string;
  domain: string;
  eventName: string;
  occurredAt: string;
};

const QUEUE_BASE = process.env.QUEUE_BASE ?? 'http://localhost:3005';
const KV_BASE = process.env.KV_BASE ?? 'http://localhost:3200';
const DEFAULT_SCENARIO = process.env.SCENARIO_NAME ?? 'retailer-happy-path';
const PORT = Number(process.env.PORT) || 3300;

const VISUALIZER_QUEUE = 'visualizer';
const EMPTY_DELAY_MS = 200;
const ERROR_DELAY_MS = 1000;
const LOG_BUFFER_SIZE = 200;

const BUSINESS_DIR_NAME = 'business';
const SCENARIO_DESIGNER_BASE =
  process.env.SCENARIO_DESIGNER_BASE ?? 'http://localhost:3201';

type ScenarioSource = 'business' | 'draft';

type DynamicScenarioRecord = {
  name: string;
  definition: Scenario;
  origin: { type: 'draft'; draftId: string };
  appliedAt: string;
  bootstrapExample?: ScenarioBootstrapExample;
};

const logBuffer: LogEntry[] = [];

const resetLogBuffer = () => {
  logBuffer.splice(0, logBuffer.length);
};

const dynamicScenarios = new Map<string, DynamicScenarioRecord>();

type ActiveScenarioState = { name: string; source: ScenarioSource };

let activeScenario: ActiveScenarioState = { name: DEFAULT_SCENARIO, source: 'business' };

const getActiveScenario = (): ActiveScenarioState => activeScenario;

const getActiveScenarioName = (): string => activeScenario.name;

const setActiveScenario = (name: string, source: ScenarioSource): void => {
  if (activeScenario.name === name && activeScenario.source === source) {
    return;
  }

  activeScenario = { name, source };
  resetLogBuffer();
};

const getScenarioSource = (name: string): ScenarioSource =>
  dynamicScenarios.has(name) ? 'draft' : 'business';

const registerDynamicScenario = (record: DynamicScenarioRecord) => {
  dynamicScenarios.set(record.name, record);
};

const listDynamicScenarios = () => Array.from(dynamicScenarios.values());

const clearDynamicScenarios = () => dynamicScenarios.clear();

const listScenarioItems = async (): Promise<
  Array<{ name: string; source: ScenarioSource }>
> => {
  const items = new Map<string, ScenarioSource>();
  const businessNames = await listBusinessScenarioNames();

  for (const name of businessNames) {
    items.set(name, 'business');
  }

  for (const record of listDynamicScenarios()) {
    items.set(record.name, 'draft');
  }

  return Array.from(items.entries())
    .map(([name, source]) => ({ name, source }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.message === 'string' ? payload.message : '');
    this.status = status;
    this.payload = payload;
  }
}

const DraftSummarySchema = z
  .object({
    id: z.string(),
    status: z.union([z.literal('draft'), z.literal('ready')]).default('draft'),
    currentProposal: z.object({}).passthrough(),
    hasGeneratedScenario: z.boolean(),
    generatedScenarioPreview: z.unknown().optional(),
    guidance: z.string().optional(),
  })
  .passthrough();

type DraftSummary = z.infer<typeof DraftSummarySchema>;

const ScenarioDefinitionSchema = scenarioSchema;

type ScenarioDefinition = Scenario;

const ScenarioBootstrapEventSchema = z
  .object({
    eventName: z.string().min(1),
    data: z.record(z.unknown()),
  })
  .passthrough();

const ScenarioBootstrapSchema = z
  .object({
    queue: z.string().min(1),
    event: ScenarioBootstrapEventSchema,
  })
  .passthrough();

const GeneratedScenarioSchema = z
  .object({
    content: ScenarioDefinitionSchema,
    createdAt: z.string(),
    bootstrapExample: ScenarioBootstrapSchema.optional(),
  })
  .passthrough();

const ScenarioDraftSchema = z
  .object({
    id: z.string(),
    generatedScenario: GeneratedScenarioSchema.optional(),
  })
  .passthrough();

const applyScenarioBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('existing'),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('draft'),
    draftId: z.string().min(1),
  }),
]);

const ensureScenarioExists = async (name: string): Promise<ScenarioSource> => {
  if (dynamicScenarios.has(name)) {
    return 'draft';
  }

  let available: string[];

  try {
    available = await listBusinessScenarioNames();
  } catch (error) {
    throw new HttpError(500, {
      error: 'list_scenarios_failed',
      message: 'Unable to list available scenarios.',
      cause: error instanceof Error ? error.message : error,
    });
  }

  if (available.includes(name)) {
    return 'business';
  }

  throw new HttpError(400, {
    error: 'unknown_scenario',
    message: `Scenario "${name}" is not registered.`,
  });
};

const fetchDraftSummary = async (draftId: string): Promise<DraftSummary> => {
  const url = `${SCENARIO_DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/summary`;

  try {
    const response = await axios.get(url, { validateStatus: () => true });

    if (response.status === 404) {
      throw new HttpError(404, {
        error: 'draft_not_found',
        message: `Draft "${draftId}" was not found in scenario-designer.`,
      });
    }

    if (response.status >= 400) {
      throw new HttpError(response.status, {
        error: 'designer_error',
        message: 'scenario-designer returned an error for the requested draft.',
      });
    }

    const parsed = DraftSummarySchema.safeParse(response.data);

    if (!parsed.success) {
      throw new HttpError(502, {
        error: 'invalid_draft_summary',
        message: 'scenario-designer returned an invalid draft summary.',
      });
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, {
      error: 'designer_unreachable',
      message: 'Failed to contact scenario-designer.',
      cause: error instanceof Error ? error.message : error,
    });
  }
};

const fetchDraftScenarioDefinition = async (
  draftId: string,
): Promise<ScenarioDefinition> => {
  const url = `${SCENARIO_DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/json`;

  try {
    const response = await axios.get(url, { validateStatus: () => true });

    if (response.status === 404) {
      throw new HttpError(404, {
        error: 'generated_scenario_not_found',
        message: 'Generated scenario JSON not found for this draft.',
      });
    }

    if (response.status >= 400) {
      throw new HttpError(response.status, {
        error: 'designer_error',
        message: 'scenario-designer failed to return the generated scenario.',
      });
    }

    const parsed = ScenarioDefinitionSchema.safeParse(response.data);

    if (!parsed.success) {
      throw new HttpError(502, {
        error: 'invalid_scenario_definition',
        message: 'Generated scenario JSON is invalid.',
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, {
      error: 'designer_unreachable',
      message: 'Failed to retrieve the generated scenario JSON.',
      cause: error instanceof Error ? error.message : error,
    });
  }
};

const fetchDraftBootstrapExample = async (
  draftId: string,
): Promise<ScenarioBootstrapExample | undefined> => {
  const url = `${SCENARIO_DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}`;

  try {
    const response = await axios.get(url, { validateStatus: () => true });

    if (response.status === 404) {
      throw new HttpError(404, {
        error: 'draft_not_found',
        message: `Draft "${draftId}" was not found in scenario-designer.`,
      });
    }

    if (response.status >= 400) {
      throw new HttpError(response.status, {
        error: 'designer_error',
        message: 'scenario-designer returned an error for the requested draft.',
      });
    }

    const parsed = ScenarioDraftSchema.safeParse(response.data);

    if (!parsed.success) {
      throw new HttpError(502, {
        error: 'invalid_draft_payload',
        message: 'scenario-designer returned an invalid draft payload.',
      });
    }

    return parsed.data.generatedScenario?.bootstrapExample;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, {
      error: 'designer_unreachable',
      message: 'Failed to retrieve the draft payload.',
      cause: error instanceof Error ? error.message : error,
    });
  }
};

const appendLogEntry = (entry: LogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
  }
};

const getLogEntries = (): LogEntry[] => [...logBuffer];

const isRoutineVisualizerPath = (path: string): boolean =>
  path === '/scenario' || path.startsWith('/logs') || path.startsWith('/traces');

const app = Fastify({ logger: true, disableRequestLogging: true });

app.addHook('onResponse', (request, reply, done) => {
  const rawUrl = request.raw.url ?? request.url ?? '';
  const path = rawUrl.split('?')[0] ?? rawUrl;

  if (!isRoutineVisualizerPath(path)) {
    request.log.info(
      {
        method: request.method,
        url: path,
        statusCode: reply.statusCode,
      },
      'request completed',
    );
  }

  done();
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const namespaceUrl = (namespace: string) =>
  `${KV_BASE}/kv/${encodeURIComponent(namespace)}`;

const recordUrl = (namespace: string, key: string) =>
  `${namespaceUrl(namespace)}/${encodeURIComponent(key)}`;

const findBusinessDirectory = (startDir: string): string | null => {
  let current: string | null = startDir;

  while (current) {
    const candidate = join(current, BUSINESS_DIR_NAME);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
};

const loadBusinessScenarioDefinition = async (name: string): Promise<Scenario> => {
  const businessDir = findBusinessDirectory(process.cwd());

  if (!businessDir) {
    throw new HttpError(500, {
      error: 'business_directory_not_found',
      message: 'Business scenarios directory could not be located.',
    });
  }

  const filePath = join(businessDir, `${name}.json`);

  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;

    if (code === 'ENOENT') {
      throw new HttpError(404, {
        error: 'scenario_not_found',
        message: `Scenario "${name}" was not found in business definitions.`,
      });
    }

    throw new HttpError(500, {
      error: 'scenario_read_failed',
      message: `Unable to read scenario "${name}" from disk.`,
      cause: error instanceof Error ? error.message : error,
    });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new HttpError(500, {
      error: 'scenario_parse_failed',
      message: `Scenario "${name}" contains invalid JSON.`,
      cause: error instanceof Error ? error.message : error,
    });
  }

  const validation = scenarioSchema.safeParse(parsed);

  if (!validation.success) {
    throw new HttpError(500, {
      error: 'invalid_scenario_definition',
      message: `Scenario "${name}" does not satisfy the scenario schema.`,
      issues: validation.error.issues.map((issue) => issue.message),
    });
  }

  return validation.data;
};

const listBusinessScenarioNames = async (): Promise<string[]> => {
  const businessDir = findBusinessDirectory(process.cwd());

  if (!businessDir) {
    return [];
  }

  const entries = await readdir(businessDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
    .map((entry) => entry.name.replace(/\.json$/u, ''))
    .sort();
};

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

app.get('/scenario', async (_request, reply) => {
  const { name, source } = getActiveScenario();
  return reply.send({ name, source });
});

app.get('/scenario-bootstrap', async (_request, reply) => {
  const { name, source } = getActiveScenario();

  if (source !== 'draft') {
    return reply.send({ hasBootstrap: false });
  }

  const record = dynamicScenarios.get(name);

  if (!record || !record.bootstrapExample) {
    return reply.send({ hasBootstrap: false });
  }

  return reply.send({
    hasBootstrap: true,
    queue: record.bootstrapExample.queue,
    event: record.bootstrapExample.event,
  });
});

app.get<{ Querystring: { name?: string } }>('/scenario-definition', async (request, reply) => {
  const { name } = request.query ?? {};

  if (typeof name !== 'string' || name.trim().length === 0) {
    return reply
      .status(400)
      .send({ error: 'missing_name', message: 'Query parameter "name" is required.' });
  }

  const record = dynamicScenarios.get(name);

  if (record) {
    return reply.send(record.definition);
  }

  try {
    const definition = await loadBusinessScenarioDefinition(name);
    return reply.send(definition);
  } catch (error) {
    if (error instanceof HttpError) {
      return reply.status(error.status).send(error.payload);
    }

    request.log.error({ err: error }, 'unexpected error loading business scenario definition');
    return reply.status(500).send({
      error: 'unexpected_error',
      message: 'Failed to load scenario definition.',
    });
  }
});

app.get('/scenarios', async (_request, reply) => {
  try {
    const items = await listScenarioItems();
    return reply.send({ items });
  } catch (error) {
    app.log.error({ err: error }, 'failed to list scenarios');
    return reply.status(500).send({ error: 'Unable to list scenarios.' });
  }
});

app.post('/scenario/apply', async (request, reply) => {
  const parsedBody = applyScenarioBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply
      .status(400)
      .send({ error: 'invalid_request', message: 'Invalid request body.', issues: parsedBody.error.issues });
  }

  const body = parsedBody.data;

  try {
    if (body.type === 'existing') {
      const source = await ensureScenarioExists(body.name);

      if (source === 'draft') {
        const record = dynamicScenarios.get(body.name);

        if (record) {
          registerDynamicScenario({
            ...record,
            appliedAt: new Date().toISOString(),
          });
        }
      }

      setActiveScenario(body.name, source);

      return reply.send({ name: body.name, status: 'active', source });
    }

    const summary = await fetchDraftSummary(body.draftId);

    if (summary.status !== 'ready') {
      throw new HttpError(400, {
        error: 'draft_not_ready',
        message: 'Mark the draft as ready before applying it.',
      });
    }

    if (!summary.hasGeneratedScenario) {
      throw new HttpError(400, {
        error: 'draft_without_scenario',
        message: 'Generate the scenario JSON before applying the draft.',
      });
    }

    const definition = await fetchDraftScenarioDefinition(body.draftId);
    let bootstrapExample: ScenarioBootstrapExample | undefined;

    try {
      bootstrapExample = await fetchDraftBootstrapExample(body.draftId);
    } catch (error) {
      if (error instanceof HttpError) {
        app.log.warn({ err: error }, 'failed to load bootstrap example for draft');
      } else {
        app.log.warn({ err: error }, 'unexpected error loading bootstrap example for draft');
      }
    }
    const scenarioName = definition.name;

    registerDynamicScenario({
      name: scenarioName,
      definition,
      origin: { type: 'draft', draftId: body.draftId },
      appliedAt: new Date().toISOString(),
      bootstrapExample,
    });

    setActiveScenario(scenarioName, 'draft');

    return reply.send({ name: scenarioName, status: 'active', source: 'draft' });
  } catch (error) {
    if (error instanceof HttpError) {
      app.log.warn({ err: error }, 'failed to apply scenario');
      return reply.status(error.status).send(error.payload);
    }

    app.log.error({ err: error }, 'unexpected error while applying scenario');
    return reply
      .status(500)
      .send({ error: 'unexpected_error', message: 'Failed to apply scenario.' });
  }
});

app.post<{ Body: { name?: unknown } }>('/scenario', async (request, reply) => {
  const { name } = request.body ?? {};

  if (typeof name !== 'string' || name.length === 0) {
    return reply
      .status(400)
      .send({ error: 'Request body must include a scenario name.' });
  }

  try {
    const source = await ensureScenarioExists(name);

    if (source === 'draft') {
      const record = dynamicScenarios.get(name);

      if (record) {
        registerDynamicScenario({ ...record, appliedAt: new Date().toISOString() });
      }
    }

    setActiveScenario(name, source);
  } catch (error) {
    if (error instanceof HttpError) {
      return reply.status(error.status).send(error.payload);
    }

    app.log.error({ err: error }, 'failed to validate scenario before switch');
    return reply
      .status(500)
      .send({ error: 'Unable to validate requested scenario.' });
  }

  return reply.send({ name });
});

app.get('/traces', async (_request, reply) => {
  try {
    const namespace = getActiveScenarioName();
    const response = await axios.get(namespaceUrl(namespace), {
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
  const namespace = getActiveScenarioName();
  const url = recordUrl(namespace, key);

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

export const __testing = {
  normalizeVisualizerPayload,
  resetLogBuffer,
  getLogEntries,
  getActiveScenarioName,
  getActiveScenario,
  setActiveScenarioName: (name: string, source: ScenarioSource = 'business') => {
    activeScenario = { name, source };
  },
  clearDynamicScenarios,
  registerDynamicScenario,
  listDynamicScenarios,
};

export { app, consumeLoop };
