import pino, { LoggerOptions } from 'pino';

type LogLevel = pino.Level | 'silent';

type LoggerConfig = {
  service?: string;
  level?: LogLevel;
  options?: LoggerOptions;
};

export function createLogger(config: LoggerConfig = {}) {
  const { service = 'app', level, options } = config;
  const resolvedLevel = level ?? ((process.env.LOG_LEVEL as LogLevel) || 'info');

  return pino({
    name: service,
    level: resolvedLevel,
    ...options
  });
}

export type Logger = ReturnType<typeof createLogger>;
