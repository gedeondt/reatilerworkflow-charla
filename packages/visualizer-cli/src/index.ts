import process from 'node:process';

import blessed, { type Widgets } from 'blessed';
import chalk from 'chalk';

import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';
import { loadScenario, type Scenario } from '@reatiler/saga-kernel';

const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';
const POLL_INTERVAL_MS = 1000;
const MAX_LOG_LINES = 50;
const HIGHLIGHT_DURATION_MS = 400;
const VISUALIZER_QUEUE = 'visualizer';

type DomainState = Record<string, string>;
type StateUpdate = { domainId: string; status: string };
type EventFlow = { fromDomainId: string; toDomainId: string };

const scenarioName = process.env.SCENARIO_NAME ?? 'retailer-happy-path';

let scenario: Scenario;

try {
  scenario = loadScenario(scenarioName);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Unable to load scenario "${scenarioName}": ${message}`);
  process.exit(1);
}

const DOMAINS = scenario.domains.map((domain) => {
  const label = domain.id.charAt(0).toUpperCase() + domain.id.slice(1);
  return { id: domain.id, queue: domain.queue, label };
});

const queueToDomainId = DOMAINS.reduce<Record<string, string>>((acc, domain) => {
  acc[domain.queue] = domain.id;
  return acc;
}, {});

const scenarioEventNames = new Set(scenario.events.map((event) => event.name));

const EVENT_STATE_UPDATES = scenario.listeners.reduce<Record<string, StateUpdate[]>>(
  (acc, listener) => {
    listener.actions.forEach((action) => {
      if (action.type !== 'set-state') {
        return;
      }

      const updates = acc[listener.on.event] ?? [];
      updates.push({ domainId: action.domain, status: action.status });
      acc[listener.on.event] = updates;
    });

    return acc;
  },
  {}
);

const EVENT_FLOWS_TARGETS = scenario.listeners.reduce<Record<string, string[]>>(
  (acc, listener) => {
    listener.actions.forEach((action) => {
      if (action.type !== 'emit') {
        return;
      }

      const entries = acc[listener.on.event] ?? [];
      entries.push(action.toDomain);
      acc[listener.on.event] = entries;
    });

    return acc;
  },
  {}
);

const createInitialDomainState = (): DomainState => {
  return DOMAINS.reduce<Record<string, string>>((acc, domain) => {
    acc[domain.id] = '-';
    return acc;
  }, {});
};

type EventClassification = 'success' | 'compensation' | 'failure' | 'other';

function isScenarioEventName(eventName: string): boolean {
  return scenarioEventNames.has(eventName);
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

type OnEvent = (envelope: EventEnvelope, context: { queue: string }) => void;

function createScreen(): Widgets.Screen {
  const screen = blessed.screen({ smartCSR: true });
  screen.title = `Reatiler Workflow — ${scenario.name}`;
  return screen;
}

function createLayout(screen: Widgets.Screen) {
  blessed.box({
    parent: screen,
    top: 0,
    left: 'center',
    width: 'shrink',
    height: 1,
    content: chalk.bold(`Reatiler Workflow — ${scenario.name}`),
    tags: true
  });

  const domainBoxes: Record<string, Widgets.BoxElement> = {};
  const widthPercent = 100 / DOMAINS.length;
  const columnWidth = `${widthPercent}%`;

  DOMAINS.forEach(({ id, label }, index) => {
    const box = blessed.box({
      parent: screen,
      top: 1,
      left: `${index * widthPercent}%`,
      width: columnWidth,
      height: '65%',
      border: { type: 'line' },
      label: ` ${label} `,
      style: {
        border: { fg: 'white' },
        label: { fg: 'white', bold: true }
      }
    });

    domainBoxes[id] = box;
  });

  const eventLogBox = blessed.box({
    parent: screen,
    top: '66%',
    left: 0,
    width: '100%',
    height: '34%',
    border: { type: 'line' },
    label: ' Event Log ',
    style: {
      border: { fg: 'white' },
      label: { fg: 'white', bold: true }
    },
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    content: chalk.gray('Waiting for events...')
  });

  return { domainBoxes, eventLogBox };
}

function classifyEvent(eventName: string): EventClassification {
  const updates = EVENT_STATE_UPDATES[eventName];

  if (!updates || updates.length === 0) {
    return 'other';
  }

  const statuses = updates.map((update) => update.status.toLowerCase());

  if (statuses.some((status) => status.includes('fail') || status.includes('error'))) {
    return 'failure';
  }

  if (statuses.some((status) => status.includes('cancel') || status.includes('refund') || status.includes('release'))) {
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

function classificationToBorderColor(classification: EventClassification): string {
  switch (classification) {
    case 'success':
      return 'green';
    case 'compensation':
      return 'yellow';
    case 'failure':
      return 'red';
    default:
      return 'grey';
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

type MirroredMessage = {
  queue: string;
  message: unknown;
};

function logConnectionError(error: unknown) {
  if (connectionErrorLogged) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  connectionErrorLogged = true;

  pushStatusMessage?.(
    `⚠️  Unable to reach message queue at ${messageQueueUrl}: ${message}`,
    'warning'
  );
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

function updateBoxColor(box: Widgets.BoxElement, color: string) {
  box.style = {
    ...box.style,
    border: { ...(box.style?.border ?? {}), fg: color },
    label: { ...(box.style?.label ?? {}), fg: color, bold: true }
  };
}

function start(): void {
  const screen = createScreen();
  const { domainBoxes, eventLogBox } = createLayout(screen);
  const logLines: string[] = [];
  const highlightTimeouts = new Map<string, NodeJS.Timeout>();
  const sagaSnapshots = new Map<string, DomainState>();
  let activeCorrelationId: string | null = configuredFilterCorrelationId;

  const getOrCreateSagaSnapshot = (correlationId: string): DomainState => {
    const existing = sagaSnapshots.get(correlationId);

    if (existing) {
      return existing;
    }

    const initialState: DomainState = createInitialDomainState();
    sagaSnapshots.set(correlationId, initialState);
    return initialState;
  };

  const refreshDomainColumns = () => {
    const activeState = activeCorrelationId ? sagaSnapshots.get(activeCorrelationId) : undefined;

    DOMAINS.forEach(({ id }) => {
      const state = activeState?.[id];
      const content = state && state !== '-' ? chalk.bold(state) : chalk.gray('-');
      domainBoxes[id].setContent(content);
    });
  };

  const appendLogLine = (line: string) => {
    logLines.push(line);

    if (logLines.length > MAX_LOG_LINES) {
      logLines.splice(0, logLines.length - MAX_LOG_LINES);
    }

    eventLogBox.setContent(logLines.join('\n'));
    eventLogBox.setScrollPerc(100);
    screen.render();
  };

  pushStatusMessage = (message, level) => {
    const colorized =
      level === 'error'
        ? chalk.red(message)
        : level === 'warning'
          ? chalk.yellow(message)
          : chalk.cyan(message);
    appendLogLine(`${chalk.gray(`[${formatTimestamp(new Date())}]`)} ${colorized}`);
  };

  if (configuredFilterCorrelationId) {
    pushStatusMessage?.(
      `🎯 Filter active. Showing correlationId=${configuredFilterCorrelationId}.`,
      'info'
    );
  }

  const highlightDomain = (domainId: string, classification: EventClassification) => {
    const box = domainBoxes[domainId];

    if (!box) {
      return;
    }

    const color = classificationToBorderColor(classification);

    updateBoxColor(box, color);
    screen.render();

    const existingTimeout = highlightTimeouts.get(domainId);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      updateBoxColor(box, 'white');
      screen.render();
      highlightTimeouts.delete(domainId);
    }, HIGHLIGHT_DURATION_MS);

    highlightTimeouts.set(domainId, timeout);
  };

  const stopPolling = startPolling((envelope, { queue }) => {
    const timestamp = chalk.gray(`[${formatTimestamp(new Date())}]`);
    const queueLabel = chalk.cyan(`[${queue}]`);
    const classification = classifyEvent(envelope.eventName);
    const colorizeEvent = classificationToChalk(classification);
    const queueDomainId = queueToDomainId[queue];
    const flowTargets = EVENT_FLOWS_TARGETS[envelope.eventName] ?? [];
    const flows: EventFlow[] = queueDomainId
      ? flowTargets.map((toDomainId) => ({ fromDomainId: queueDomainId, toDomainId }))
      : [];
    const entityId = extractEntityId(envelope.data);
    const correlationId = envelope.correlationId?.trim();

    if (!correlationId) {
      pushStatusMessage?.(
        `⚠️  Received event without correlationId: ${envelope.eventName}`,
        'warning'
      );
      return;
    }

    const sagaSnapshot = getOrCreateSagaSnapshot(correlationId);

    const stateUpdates = EVENT_STATE_UPDATES[envelope.eventName];

    if (stateUpdates) {
      stateUpdates.forEach(({ domainId, status }) => {
        sagaSnapshot[domainId] = status;
      });
    }

    if (!configuredFilterCorrelationId && activeCorrelationId === null) {
      activeCorrelationId = correlationId;
    }

    const isActiveCorrelation = activeCorrelationId === correlationId;

    const details: string[] = [
      `Entity=${entityId}`,
      `Trace=${envelope.traceId}`,
      `Correlation=${correlationId}${isActiveCorrelation ? '' : ' (inactive)'}`
    ];

    if (flows.length > 0) {
      flows.forEach(({ fromDomainId, toDomainId }) => {
        details.push(`from=${fromDomainId} → to=${toDomainId}`);
      });
    }

    const logLine = `${timestamp} ${queueLabel} ${colorizeEvent(
      envelope.eventName
    )} (${details.join(', ')})`;

    appendLogLine(logLine);

    if (isActiveCorrelation) {
      refreshDomainColumns();
      screen.render();
    }

    if (isActiveCorrelation && flows.length > 0) {
      flows.forEach(({ fromDomainId, toDomainId }) => {
        highlightDomain(fromDomainId, classification);

        if (toDomainId !== fromDomainId) {
          highlightDomain(toDomainId, classification);
        }
      });
    }
  
    if (!queueDomainId && !unknownQueuesLogged.has(queue)) {
      unknownQueuesLogged.add(queue);
      pushStatusMessage?.(
        `⚠️  Unknown queue "${queue}" for current scenario.`,
        'warning'
      );
    }

    if (!isScenarioEventName(envelope.eventName) && !unknownEventsLogged.has(envelope.eventName)) {
      unknownEventsLogged.add(envelope.eventName);
      pushStatusMessage?.(
        `⚠️  Unknown event "${envelope.eventName}" for scenario "${scenarioName}".`,
        'warning'
      );
    }
  });

  const shutdown = () => {
    stopPolling();

    for (const timeout of highlightTimeouts.values()) {
      clearTimeout(timeout);
    }

    screen.destroy();
    process.exit(0);
  };

  screen.key(['C-c', 'q'], shutdown);
  process.once('SIGTERM', shutdown);

  refreshDomainColumns();
  screen.render();
}

start();
