import type { EventBus, EventEnvelope } from './event-bus.js';

type MaybePromise<T> = T | Promise<T>;

type Logger = {
  info?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  debug?: (message: unknown, ...args: unknown[]) => void;
};

type WorkerOptions = {
  queueName: string;
  bus: EventBus;
  dispatch: (event: EventEnvelope) => MaybePromise<unknown>;
  isProcessed: (eventId: string) => MaybePromise<boolean>;
  markProcessed: (eventId: string) => MaybePromise<void>;
  pollIntervalMs?: number;
  logger?: Logger;
};

type WorkerStatus = 'idle' | 'running';

export type WorkerController = {
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStatus(): WorkerStatus;
};

type ProcessResult = 'empty' | 'duplicate' | 'processed';

export function startWorker({
  queueName,
  bus,
  dispatch,
  isProcessed,
  markProcessed,
  pollIntervalMs = 250,
  logger
}: WorkerOptions): WorkerController {
  let running = false;
  let status: WorkerStatus = 'idle';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let processing: Promise<void> | null = null;

  const log = {
    info: logger?.info?.bind(logger),
    error: logger?.error?.bind(logger),
    warn: logger?.warn?.bind(logger),
    debug: logger?.debug?.bind(logger)
  };

  const processOnce = async (): Promise<ProcessResult> => {
    const envelope = await bus.pop(queueName);

    if (!envelope) {
      return 'empty';
    }

    if (await isProcessed(envelope.eventId)) {
      log.debug?.({ eventId: envelope.eventId, queueName }, 'event already processed');
      return 'duplicate';
    }

    try {
      await dispatch(envelope);
      await markProcessed(envelope.eventId);
      log.info?.(
        {
          eventName: envelope.eventName,
          eventId: envelope.eventId,
          queueName
        },
        'event processed'
      );
      return 'processed';
    } catch (error) {
      log.error?.({ error, eventId: envelope.eventId, queueName }, 'failed to process event');
      throw error;
    }
  };

  const schedule = (delay: number) => {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      processing = processOnce()
        .then((result) => {
          if (!running) {
            return;
          }

          const nextDelay = result === 'empty' ? pollIntervalMs : 0;
          schedule(nextDelay);
        })
        .catch(() => {
          if (!running) {
            return;
          }

          schedule(pollIntervalMs);
        })
        .finally(() => {
          processing = null;
        });
    }, delay);
  };

  const start = () => {
    if (running) {
      return;
    }

    running = true;
    status = 'running';
    schedule(0);
  };

  const stop = async () => {
    if (!running) {
      status = 'idle';
      return;
    }

    running = false;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const currentProcessing = processing;
    processing = null;

    if (currentProcessing) {
      try {
        await currentProcessing;
      } catch {
        // ignore errors during shutdown
      }
    }

    status = 'idle';
  };

  const isRunning = () => running;
  const getStatus = () => status;

  return {
    start,
    stop,
    isRunning,
    getStatus
  };
}
