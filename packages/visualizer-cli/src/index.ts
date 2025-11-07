import process from 'node:process';

import blessed, { type Widgets } from 'blessed';
import chalk from 'chalk';

import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';

const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';
const POLL_INTERVAL_MS = 1000;
const MAX_LOG_LINES = 50;
const HIGHLIGHT_DURATION_MS = 400;

const QUEUES = ['orders', 'inventory', 'payments', 'shipping'] as const;
const DOMAINS = [
  { key: 'order', label: 'Order' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'payments', label: 'Payments' },
  { key: 'shipping', label: 'Shipping' }
] as const;
const VISUALIZER_QUEUE = 'visualizer';

type QueueName = (typeof QUEUES)[number];
type DomainKey = (typeof DOMAINS)[number]['key'];
type DomainLabel = (typeof DOMAINS)[number]['label'];

const domainKeyToLabel = DOMAINS.reduce<Record<DomainKey, DomainLabel>>((acc, { key, label }) => {
  acc[key] = label;
  return acc;
}, {} as Record<DomainKey, DomainLabel>);

type DomainState = Record<DomainKey, string>;
type DomainStateUpdate = { domain: DomainKey; state: string };

type Flow = { from: DomainKey; to: DomainKey };

const eventFlows: Record<string, Flow> = {
  OrderPlaced: { from: 'order', to: 'inventory' },
  InventoryReserved: { from: 'inventory', to: 'payments' },
  InventoryCommitted: { from: 'inventory', to: 'payments' },
  PaymentAuthorized: { from: 'payments', to: 'shipping' },
  ShipmentPrepared: { from: 'shipping', to: 'payments' },
  ShipmentDispatched: { from: 'shipping', to: 'order' },
  PaymentCaptured: { from: 'payments', to: 'order' },
  OrderConfirmed: { from: 'order', to: 'order' },
  OrderCancelled: { from: 'order', to: 'order' },
  InventoryReservationFailed: { from: 'inventory', to: 'order' },
  PaymentFailed: { from: 'payments', to: 'order' },
  ShipmentFailed: { from: 'shipping', to: 'order' },
  PaymentRefunded: { from: 'payments', to: 'order' },
  InventoryReleased: { from: 'inventory', to: 'order' }
} as const;

const INITIAL_DOMAIN_STATE: DomainState = {
  order: '',
  inventory: '',
  payments: '',
  shipping: ''
};

const EVENT_STATE_UPDATES: Partial<Record<string, DomainStateUpdate[]>> = {
  OrderPlaced: [{ domain: 'order', state: 'PLACED' }],
  OrderConfirmed: [{ domain: 'order', state: 'CONFIRMED' }],
  OrderCancelled: [{ domain: 'order', state: 'CANCELLED' }],
  OrderFailed: [{ domain: 'order', state: 'FAILED' }],
  InventoryReserved: [{ domain: 'inventory', state: 'RESERVED' }],
  InventoryCommitted: [{ domain: 'inventory', state: 'COMMITTED' }],
  InventoryReleased: [{ domain: 'inventory', state: 'RELEASED' }],
  InventoryReservationFailed: [{ domain: 'inventory', state: 'FAILED' }],
  PaymentAuthorized: [{ domain: 'payments', state: 'AUTHORIZED' }],
  PaymentCaptured: [
    { domain: 'payments', state: 'CAPTURED' },
    { domain: 'order', state: 'CONFIRMED' }
  ],
  PaymentRefunded: [{ domain: 'payments', state: 'REFUNDED' }],
  PaymentFailed: [{ domain: 'payments', state: 'FAILED' }],
  ShipmentPrepared: [{ domain: 'shipping', state: 'PREPARED' }],
  ShipmentDispatched: [{ domain: 'shipping', state: 'DISPATCHED' }],
  ShipmentFailed: [{ domain: 'shipping', state: 'FAILED' }]
};

type EventClassification = 'success' | 'compensation' | 'failure' | 'other';

const messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? DEFAULT_MESSAGE_QUEUE_URL;

const seenEvents = new Set<string>();
let connectionErrorLogged = false;
let pushStatusMessage:
  | ((message: string, level: 'info' | 'warning' | 'error') => void)
  | undefined;

type OnEvent = (envelope: EventEnvelope, context: { queue: QueueName }) => void;

function isKnownQueue(queue: string): queue is QueueName {
  return (QUEUES as readonly string[]).includes(queue);
}

function createScreen(): Widgets.Screen {
  const screen = blessed.screen({ smartCSR: true });
  screen.title = 'Reatiler Workflow — SAGA Visualizer';
  return screen;
}

function createLayout(screen: Widgets.Screen) {
  blessed.box({
    parent: screen,
    top: 0,
    left: 'center',
    width: 'shrink',
    height: 1,
    content: chalk.bold('Reatiler Workflow — SAGA Visualizer'),
    tags: true
  });

  const domainBoxes: Record<DomainKey, Widgets.BoxElement> = {} as Record<DomainKey, Widgets.BoxElement>;

  DOMAINS.forEach(({ key, label }, index) => {
    const box = blessed.box({
      parent: screen,
      top: 1,
      left: `${index * 25}%`,
      width: '25%',
      height: '65%',
      border: { type: 'line' },
      label: ` ${label} `,
      style: {
        border: { fg: 'white' },
        label: { fg: 'white', bold: true }
      }
    });

    domainBoxes[key] = box;
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
  const successEvents = new Set([
    'OrderPlaced',
    'OrderConfirmed',
    'InventoryReserved',
    'InventoryCommitted',
    'PaymentAuthorized',
    'PaymentCaptured',
    'ShipmentPrepared',
    'ShipmentDispatched'
  ]);

  const compensationEvents = new Set(['InventoryReleased', 'PaymentRefunded']);

  const failureEvents = new Set([
    'OrderCancelled',
    'InventoryReservationFailed',
    'PaymentFailed',
    'ShipmentFailed',
    'OrderFailed'
  ]);

  if (successEvents.has(eventName)) {
    return 'success';
  }

  if (compensationEvents.has(eventName)) {
    return 'compensation';
  }

  if (failureEvents.has(eventName)) {
    return 'failure';
  }

  return 'other';
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

function extractOrderId(data: Record<string, unknown>): string {
  const direct = data.orderId;

  if (typeof direct === 'string') {
    return direct;
  }

  const order = data.order;

  if (order && typeof order === 'object') {
    const nested = order as Record<string, unknown>;
    const nestedId = nested.orderId ?? nested.id;

    if (typeof nestedId === 'string') {
      return nestedId;
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

  if (!isKnownQueue(queue)) {
    pushStatusMessage?.(
      `⚠️  Received mirrored event for unknown queue "${queue}". Ignoring.`,
      'warning'
    );
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
  const highlightTimeouts = new Map<DomainKey, NodeJS.Timeout>();
  const sagaStates = new Map<string, DomainState>();
  let activeCorrelationId: string | null = null;

  const getOrCreateSagaState = (correlationId: string): DomainState => {
    const existing = sagaStates.get(correlationId);

    if (existing) {
      return existing;
    }

    const initialState: DomainState = { ...INITIAL_DOMAIN_STATE };
    sagaStates.set(correlationId, initialState);
    return initialState;
  };

  const refreshDomainColumns = () => {
    const activeState = activeCorrelationId ? sagaStates.get(activeCorrelationId) : undefined;

    DOMAINS.forEach(({ key }) => {
      const state = activeState?.[key];
      const content = state ? chalk.bold(state) : chalk.gray('-');
      domainBoxes[key].setContent(content);
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

  const highlightDomain = (domain: DomainKey, classification: EventClassification) => {
    const box = domainBoxes[domain];

    if (!box) {
      return;
    }

    const color = classificationToBorderColor(classification);

    updateBoxColor(box, color);
    screen.render();

    const existingTimeout = highlightTimeouts.get(domain);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      updateBoxColor(box, 'white');
      screen.render();
      highlightTimeouts.delete(domain);
    }, HIGHLIGHT_DURATION_MS);

    highlightTimeouts.set(domain, timeout);
  };

  const stopPolling = startPolling((envelope, { queue }) => {
    const timestamp = chalk.gray(`[${formatTimestamp(new Date())}]`);
    const queueLabel = chalk.cyan(`[${queue}]`);
    const classification = classifyEvent(envelope.eventName);
    const colorizeEvent = classificationToChalk(classification);
    const flow = eventFlows[envelope.eventName];
    const orderId = extractOrderId(envelope.data);
    const correlationId = envelope.correlationId;
    const sagaState = getOrCreateSagaState(correlationId);

    if (!activeCorrelationId) {
      activeCorrelationId = correlationId;
    }

    const isActiveCorrelation = activeCorrelationId === correlationId;

    const stateUpdates = EVENT_STATE_UPDATES[envelope.eventName];

    if (stateUpdates) {
      stateUpdates.forEach(({ domain, state }) => {
        sagaState[domain] = state;
      });
    }

    const details: string[] = [`Order=${orderId}`, `Trace=${envelope.traceId}`];

    if (flow) {
      const fromLabel = domainKeyToLabel[flow.from];
      const toLabel = domainKeyToLabel[flow.to];
      details.push(`from=${fromLabel} → to=${toLabel}`);
    }

    const logLine = `${timestamp} ${queueLabel} ${colorizeEvent(
      envelope.eventName
    )} (${details.join(', ')})`;

    appendLogLine(logLine);

    if (isActiveCorrelation) {
      refreshDomainColumns();
      screen.render();
    }

    if (flow) {
      highlightDomain(flow.from, classification);

      if (flow.to !== flow.from) {
        highlightDomain(flow.to, classification);
      }
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
