import { pino as createPino, type Logger as PinoLogger, type LoggerOptions, type LevelWithSilent } from 'pino';

import type { EventEnvelope } from './event-bus.js';

export type CreateLoggerOptions = LoggerOptions & {
  service?: string;
};

export type Logger = PinoLogger;

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { service, level, ...rest } = options;
  const resolvedLevel = (level ?? (process.env.LOG_LEVEL as LevelWithSilent | undefined) ?? 'info') as LevelWithSilent;

  const loggerOptions: LoggerOptions = {
    level: resolvedLevel,
    ...rest
  };

  if (service && !loggerOptions.name) {
    loggerOptions.name = service;
  }

  return createPino(loggerOptions);
}

export const logger = createLogger();

type LogEventLevel = 'info' | 'warn' | 'error' | 'debug';

type LogEventOptions = {
  level?: LogEventLevel;
  context?: Record<string, unknown>;
  service?: string;
};

type LogMethod = (obj: unknown, msg?: string, ...args: unknown[]) => void;

type GenericLogger = {
  [K in LogEventLevel]?: LogMethod;
} & {
  bindings?: () => { name?: string };
};

export function logEvent(
  logger: GenericLogger,
  envelope: EventEnvelope,
  message: string,
  options: LogEventOptions = {}
): void {
  const { level = 'info', context = {}, service } = options;
  const logFn =
    logger[level] ??
    logger.info ??
    logger.warn ??
    logger.error ??
    logger.debug;

  if (!logFn) {
    return;
  }

  const bindingsService = typeof logger.bindings === 'function' ? logger.bindings().name : undefined;

  const payload: Record<string, unknown> = {
    eventName: envelope.eventName,
    traceId: envelope.traceId,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId ?? null,
    ...context
  };

  const resolvedService = service ?? bindingsService;

  if (resolvedService) {
    payload.service = resolvedService;
  }

  const boundLog = logFn.bind(logger) as LogMethod;
  boundLog(payload, message);
}
