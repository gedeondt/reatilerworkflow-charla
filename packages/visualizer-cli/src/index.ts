import process from 'node:process';

import chalk from 'chalk';

import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';
import { loadScenario, type Scenario } from '@reatiler/saga-kernel';

import { createRenderer } from './render';
import { getExecutionRows, type DomainStatusUpdate, upsertExecution, FINISHED_RETENTION_MS } from './state';

const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';
const POLL_INTERVAL_MS = 1000;
const VISUALIZER_QUEUE = 'visualizer';
const DEFAULT_MAX_TRACES = 5;
const REFRESH_INTERVAL_MS = Math.max(500, Math.floor(FINISHED_RETENTION_MS / 2));

type EventClassification = 'success' | 'compensation' | 'failure' | 'other';
type EventFlow = { fromDomainId: string; toDomainId: string };

type CliOptions = {
  maxTraces: number;
};

type OnEvent = (envelope: EventEnvelope, context: { queue: string }) => void;

type MirroredMessage = {
  queue: string;
  message: unknown;
};

const scenarioName = process.env.SCENARIO_NAME ?? 'retailer-happy-path';

let scenario: Scenario;

try {
  scenario = loadScenario(scenarioName);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Unable to load scenario "${scenarioName}": ${message}`);
  process.exit(1);
}

function parseCliOptions(argv: string[]): CliOptions {
  let maxTraces = DEFAULT_MAX_TRACES;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--max-traces') {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? '', 10);

      if (!Number.isNaN(parsed) && parsed > 0) {
        maxTraces = parsed;
      }

      index += 1;
      continue;
    }

    if (argument.startsWith('--max-traces=')) {
      const [, raw] = argument.split('=', 2);
      const parsed = Number.parseInt(raw ?? '', 10);

      if (!Number.isNaN(parsed) && parsed > 0) {
        maxTraces = parsed;
      }
    }
  }

  return { maxTraces };
}

const { maxTraces } = parseCliOptions(process.argv.slice(2));

const DOMAINS = scenario.domains;

const queueToDomainId: Record<string, string> = {};

for (const domain of DOMAINS) {
  queueToDomainId[domain.queue] = domain.id;
}

const scenarioEventNames = new Set<string>();

for (const scenarioEvent of scenario.events) {
  scenarioEventNames.add(scenarioEvent.name);
}

const EVENT_STATE_UPDATES: Record<string, DomainStatusUpdate[]> = {};

for (const listener of scenario.listeners) {
  for (const action of listener.actions) {
    if (action.type !== 'set-state') {
      continue;
    }

    const updates = EVENT_STATE_UPDATES[listener.on.event] ?? [];
    updates.push({ domainId: action.domain, status: action.status });
    EVENT_STATE_UPDATES[listener.on.event] = updates;
  }
}

const EVENT_FLOWS_TARGETS: Record<string, string[]> = {};

for (const listener of scenario.listeners) {
  for (const action of listener.actions) {
    if (action.type !== 'emit') {
      continue;
    }

    const entries = EVENT_FLOWS_TARGETS[listener.on.event] ?? [];
    entries.push(action.toDomain);
    EVENT_FLOWS_TARGETS[listener.on.event] = entries;
  }
}

const messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? DEFAULT_MESSAGE_QUEUE_URL;
const configuredFilterCorrelationId = (() => {
  const raw = process.env.VIS_FILTER_ORDER_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
})();

const seenEvents = new Set<string>();
const unknownQueuesLogged = new Set<string>();
const unknownEventsLogged = new Set<string>();
let connectionErrorLogged = false;
let pushStatusMessage:
  | ((message: string, level: 'info' | 'warning' | 'error') => void)
  | undefined;

function classifyEvent(eventName: string): EventClassification {
  const updates = EVENT_STATE_UPDATES[eventName];

  if (!updates || updates.length === 0) {
    return 'other';
  }

  const statuses = updates.map((update: DomainStatusUpdate) => update.status.toLowerCase());

  if (statuses.some((status: string) => status.includes('fail') || status.includes('error'))) {
    return 'failure';
  }

  if (
    statuses.some((status: string) => status.includes('cancel') || status.includes('refund') || status.includes('release'))
  ) {
    return 'compensation';
  }

  return 'success';
}

function classificationToChalk(classification: EventClassification) {
  switch (classification) {
    case 'success':
      return chalk.green;
    case 'compensation':
      return chalk.yellow;
    case 'failure':
      return chalk.red;
    case 'other':
    default:
      return chalk.gray;
  }
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function extractEntityId(data: Record<string, unknown>): string {
  const candidateKeys = ['id', 'entityId', 'orderId', 'requestId'];

  for (const key of candidateKeys) {
    const value = data[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const nestedId = extractEntityId(value as Record<string, unknown>);

      if (nestedId !== 'n/a') {
        return nestedId;
      }
    }
  }

  return 'n/a';
}

function logConnectionError(error: unknown) {
  if (connectionErrorLogged) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  connectionErrorLogged = true;

  pushStatusMessage?.(`⚠️  Unable to reach message queue at ${messageQueueUrl}: ${message}`, 'warning');
}

function logConnectionRecovered() {
  if (!connectionErrorLogged) {
    return;
  }

  connectionErrorLogged = false;
  pushStatusMessage?.('✅ Connection to message queue restored.', 'info');
}

async function pollVisualizerQueue(onEvent: OnEvent): Promise<void> {
  const url = new URL(`/queues/${VISUALIZER_QUEUE}/pop`, messageQueueUrl);

  let response: Response;

  try {
    response = await fetch(url, { method: 'POST' });
  } catch (error) {
    logConnectionError(error);
    return;
  }

  if (!response.ok) {
    const error = new Error(`Unexpected response ${response.status} ${response.statusText}`);
    logConnectionError(error);
    return;
  }

  logConnectionRecovered();

  if (response.status === 204) {
    return;
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    return;
  }

  if (typeof payload !== 'object' || payload === null) {
    return;
  }

  if ('status' in payload && (payload as { status?: string }).status === 'empty') {
    return;
  }

  const message = (payload as { message?: unknown }).message;

  if (!message || typeof message !== 'object') {
    return;
  }

  const { queue, message: envelopeCandidate } = message as MirroredMessage;

  if (typeof queue !== 'string') {
    return;
  }

  const parsedEnvelope = eventEnvelopeSchema.safeParse(envelopeCandidate);

  if (!parsedEnvelope.success) {
    pushStatusMessage?.(
      `⚠️  Received malformed event from queue "${queue}": ${parsedEnvelope.error.message}`,
      'warning'
    );
    return;
  }

  const envelope = parsedEnvelope.data;

  if (seenEvents.has(envelope.eventId)) {
    return;
  }

  seenEvents.add(envelope.eventId);
  onEvent(envelope, { queue });
}

function startPolling(onEvent: OnEvent): () => void {
  let isPolling = false;
  let stopped = false;

  const poll = async () => {
    if (stopped) {
      return;
    }

    try {
      await pollVisualizerQueue(onEvent);
    } catch (error) {
      pushStatusMessage?.(`❌ Unexpected error while polling: ${String(error)}`, 'error');
    }
  };

  void poll();

  const timer = setInterval(async () => {
    if (isPolling || stopped) {
      return;
    }

    isPolling = true;

    try {
      await poll();
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function start(): void {
  const renderer = createRenderer(scenario.name, DOMAINS);
  const { appendLogLine, renderExecutions } = renderer;
  pushStatusMessage = renderer.pushStatusMessage;

  if (configuredFilterCorrelationId) {
    pushStatusMessage?.(
      `🎯 Filter active. Showing correlationId=${configuredFilterCorrelationId}.`,
      'info'
    );
  }

  const refreshExecutions = () => {
    renderExecutions(getExecutionRows(DOMAINS, maxTraces, Date.now()));
  };

  const refreshTimer = setInterval(refreshExecutions, REFRESH_INTERVAL_MS);

  const stopPolling = startPolling((envelope, { queue }) => {
    const correlationId = envelope.correlationId?.trim() ?? null;

    if (configuredFilterCorrelationId && correlationId !== configuredFilterCorrelationId) {
      return;
    }

    const timestamp = new Date();
    const formattedTimestamp = chalk.gray(`[${formatTimestamp(timestamp)}]`);
    const queueLabel = chalk.cyan(`[${queue}]`);
    const classification = classifyEvent(envelope.eventName);
    const colorizeEvent = classificationToChalk(classification);
    const queueDomainId = queueToDomainId[queue];
    const flowTargets = EVENT_FLOWS_TARGETS[envelope.eventName] ?? [];
    const flows: EventFlow[] = queueDomainId
      ? flowTargets.map((toDomainId: string) => ({ fromDomainId: queueDomainId, toDomainId }))
      : [];
    const entityId = extractEntityId(envelope.data);
    const traceId = envelope.traceId?.trim() ?? null;

    const stateUpdates = EVENT_STATE_UPDATES[envelope.eventName] ?? [];

    const result = upsertExecution(
      { traceId, correlationId, domains: DOMAINS, updates: stateUpdates },
      timestamp.getTime()
    );

    if (!result) {
      return;
    }

    const details: string[] = [`Entity=${entityId}`, `Trace=${result.displayId}`, `Correlation=${correlationId ?? 'n/a'}`];

    if (flows.length > 0) {
      flows.forEach(({ fromDomainId, toDomainId }) => {
        details.push(`from=${fromDomainId} → to=${toDomainId}`);
      });
    }

    appendLogLine(
      `${formattedTimestamp} ${queueLabel} ${colorizeEvent(envelope.eventName)} (${details.join(', ')})`
    );

    refreshExecutions();

    if (!queueDomainId && !unknownQueuesLogged.has(queue)) {
      unknownQueuesLogged.add(queue);
      pushStatusMessage?.(`⚠️  Unknown queue "${queue}" for current scenario.`, 'warning');
    }

    if (!scenarioEventNames.has(envelope.eventName) && !unknownEventsLogged.has(envelope.eventName)) {
      unknownEventsLogged.add(envelope.eventName);
      pushStatusMessage?.(
        `⚠️  Unknown event "${envelope.eventName}" for scenario "${scenarioName}".`,
        'warning'
      );
    }
  });

  const shutdown = () => {
    stopPolling();
    clearInterval(refreshTimer);
    renderer.destroy();
    process.exit(0);
  };

  renderer.screen.key(['C-c', 'q'], shutdown);
  process.once('SIGTERM', shutdown);

  refreshExecutions();
}

start();
