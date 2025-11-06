import pino, { LoggerOptions } from 'pino';
import type { LevelWithSilent } from 'pino';

export type CreateLoggerOptions = LoggerOptions & {
  service?: string;
};

export type Logger = ReturnType<typeof createLogger>;

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

  return pino(loggerOptions);
}

export const logger = createLogger();
