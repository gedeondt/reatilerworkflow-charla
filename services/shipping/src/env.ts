import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().refine((value) => value === 3004, { message: 'PORT must be 3004' }),
  ALLOW_PREPARE: z.coerce.boolean(),
  WORKER_POLL_MS: z.coerce.number().int().positive(),
  OP_TIMEOUT_MS: z.coerce.number().int().positive()
});

export const env = envSchema.parse({
  PORT: process.env.PORT ?? 3004,
  ALLOW_PREPARE: process.env.ALLOW_PREPARE ?? 'true',
  WORKER_POLL_MS: process.env.WORKER_POLL_MS ?? 250,
  OP_TIMEOUT_MS: process.env.OP_TIMEOUT_MS ?? 1500
});
