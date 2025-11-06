import { config } from 'dotenv';

import { z } from './z.js';

config();

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');
export const portSchema = z.coerce.number().int().min(1).max(65535);
export const queueUrlSchema = z.string().url();

export const baseEnvSchema = z.object({
  PORT: portSchema,
  MESSAGE_QUEUE_URL: queueUrlSchema.optional(),
  LOG_LEVEL: logLevelSchema
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function loadEnv<T extends z.ZodRawShape>(shape?: T, defaults: Partial<Record<keyof BaseEnv, unknown>> = {}) {
  const customSchema = shape ? z.object(shape) : undefined;
  const schema = customSchema ? baseEnvSchema.merge(customSchema) : baseEnvSchema;

  return schema.parse({
    PORT: process.env.PORT ?? defaults.PORT,
    MESSAGE_QUEUE_URL: process.env.MESSAGE_QUEUE_URL ?? defaults.MESSAGE_QUEUE_URL,
    LOG_LEVEL: process.env.LOG_LEVEL ?? defaults.LOG_LEVEL ?? 'info'
  });
}
