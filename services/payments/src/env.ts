import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().refine((value) => value === 3003, { message: 'PORT must be 3003' }),
  ALLOW_AUTH: z.coerce.boolean(),
  WORKER_POLL_MS: z.coerce.number().int().positive(),
  OP_TIMEOUT_MS: z.coerce.number().int().positive()
});

export const env = envSchema.parse({
  PORT: process.env.PORT ?? 3003,
  ALLOW_AUTH: process.env.ALLOW_AUTH ?? 'true',
  WORKER_POLL_MS: process.env.WORKER_POLL_MS ?? 250,
  OP_TIMEOUT_MS: process.env.OP_TIMEOUT_MS ?? 1500
});
