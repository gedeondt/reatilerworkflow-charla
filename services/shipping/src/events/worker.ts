import {
  ProcessedEventStore,
  createEnvEventBus,
  startWorker,
  type EventBus,
  type WorkerController
} from '@reatiler/shared';

import { env } from '../env.js';
import type { Dispatcher } from './dispatcher.js';

const queueName = 'shipping';

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  debug?: (message: unknown, ...args: unknown[]) => void;
};

type CreateWorkerOptions = {
  logger: Logger;
  dispatcher: Dispatcher;
  bus?: EventBus;
  store?: ProcessedEventStore;
  pollIntervalMs?: number;
};

export function createWorker({
  logger,
  dispatcher,
  bus = createEnvEventBus(),
  store = new ProcessedEventStore(),
  pollIntervalMs
}: CreateWorkerOptions): WorkerController {
  return startWorker({
    queueName,
    bus,
    dispatch: (event) => dispatcher.dispatch(event),
    isProcessed: (eventId) => store.has(eventId),
    markProcessed: (eventId) => store.add(eventId),
    pollIntervalMs,
    logger
  });
}
