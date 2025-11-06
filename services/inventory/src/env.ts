import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().refine((value) => value === 3002, { message: 'PORT must be 3002' }),
  MESSAGE_QUEUE_URL: z.string().url(),
  ALLOW_RESERVATION: z.coerce.boolean(),
  WORKER_POLL_MS: z.coerce.number().int().positive(),
  OP_TIMEOUT_MS: z.coerce.number().int().positive()
});

export const env = envSchema.parse({
  PORT: process.env.PORT ?? 3002,
  MESSAGE_QUEUE_URL: process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3005',
  ALLOW_RESERVATION: process.env.ALLOW_RESERVATION ?? 'true',
  WORKER_POLL_MS: process.env.WORKER_POLL_MS ?? 250,
  OP_TIMEOUT_MS: process.env.OP_TIMEOUT_MS ?? 1500
});
