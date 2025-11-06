import type { EventBus, EventEnvelope } from './event-bus.js';

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
};

type Logger = {
  info?: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function publishWithRetry(
  bus: EventBus,
  queue: string,
  envelope: EventEnvelope,
  logger: Logger,
  options: RetryOptions = {}
): Promise<void> {
  const { retries = 3, baseMs = 100 } = options;

  let attempt = 0;

  // We perform one attempt per loop iteration. If the maximum number of retries is
  // exceeded we rethrow the error so the caller can decide how to react.
  // A retry count of `n` means we try at most `n + 1` times.
  for (;;) {
    try {
      await bus.push(queue, envelope);
      return;
    } catch (error) {
      const maxAttempts = retries + 1;
      attempt += 1;

      if (attempt >= maxAttempts) {
        logger.error?.(
          { queue, eventName: envelope.eventName, eventId: envelope.eventId, error },
          'failed to publish event after retries'
        );
        throw error;
      }

      const delayMs = baseMs * 2 ** (attempt - 1);
      logger.warn?.(
        {
          queue,
          eventName: envelope.eventName,
          eventId: envelope.eventId,
          attempt,
          maxAttempts,
          delayMs,
          error
        },
        'retrying event publication'
      );
      await delay(delayMs);
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    throw new Error('Timeout must be greater than 0ms');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
