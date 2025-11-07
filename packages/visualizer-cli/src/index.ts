import process from 'node:process';

import chalk from 'chalk';
import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';

const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';
const POLL_INTERVAL_MS = 1000;
const QUEUES = ['orders', 'inventory', 'payments', 'shipping'] as const;

type QueueName = (typeof QUEUES)[number];

const messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? DEFAULT_MESSAGE_QUEUE_URL;

let pollTimer: ReturnType<typeof setInterval> | undefined;
let isPolling = false;
let connectionErrorLogged = false;

console.log(chalk.bold('Reatiler SAGA Visualizer CLI - V1 (peek mode)'));
console.log(chalk.gray(`Message queue URL: ${messageQueueUrl}`));

function buildQueueUrl(queue: QueueName): URL {
  const url = new URL(`/queues/${encodeURIComponent(queue)}/pop`, messageQueueUrl);
  url.searchParams.set('peek', 'true');
  return url;
}

function logConnectionError(error: unknown) {
  if (connectionErrorLogged) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.warn(chalk.yellow(`⚠️  Unable to reach message queue at ${messageQueueUrl}: ${message}`));
  connectionErrorLogged = true;
}

function logConnectionRecovered() {
  if (!connectionErrorLogged) {
    return;
  }

  console.log(chalk.green('✅ Connection to message queue restored.'));
  connectionErrorLogged = false;
}

function logEvent(queue: QueueName, envelope: EventEnvelope) {
  const timestamp = new Date().toLocaleTimeString('en-GB', {
    hour12: false
  });

  const queueLabel = chalk.cyan(`[${queue}]`);
  const timeLabel = chalk.gray(`[${timestamp}]`);
  const eventLabel = chalk.green(envelope.eventName);
  const correlationId = envelope.correlationId ?? 'n/a';
  const traceId = envelope.traceId ?? 'n/a';

  console.log(
    `${timeLabel} ${queueLabel} ${eventLabel} (corr=${correlationId}, trace=${traceId})`
  );
}

async function pollQueue(queue: QueueName): Promise<void> {
  const url = buildQueueUrl(queue);

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
    // Empty response bodies are acceptable in peek mode.
    return;
  }

  if (typeof payload !== 'object' || payload === null) {
    return;
  }

  if ('status' in payload && (payload as { status?: string }).status === 'empty') {
    return;
  }

  const message = (payload as { message?: unknown }).message;

  if (!message) {
    return;
  }

  const parsedEnvelope = eventEnvelopeSchema.safeParse(message);

  if (!parsedEnvelope.success) {
    console.warn(chalk.yellow(`⚠️  Received malformed event from queue "${queue}": ${parsedEnvelope.error.message}`));
    return;
  }

  logEvent(queue, parsedEnvelope.data);
}

async function pollQueues(): Promise<void> {
  for (const queue of QUEUES) {
    await pollQueue(queue);
  }
}

function stopPolling(signal?: NodeJS.Signals) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  if (signal) {
    console.log(chalk.gray(`Received ${signal}, shutting down...`));
  }

  process.exit(0);
}

async function start() {
  await pollQueues();

  pollTimer = setInterval(async () => {
    if (isPolling) {
      return;
    }

    isPolling = true;

    try {
      await pollQueues();
    } catch (error) {
      console.error(chalk.red('Unexpected error while polling message queues:'), error);
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL_MS);

  process.once('SIGINT', stopPolling);
  process.once('SIGTERM', stopPolling);
}

void start();
