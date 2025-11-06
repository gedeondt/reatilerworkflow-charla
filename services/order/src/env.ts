import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().refine((value) => value === 3001, { message: 'PORT must be 3001' }),
  MESSAGE_QUEUE_URL: z.string().url()
});

export const env = envSchema.parse({
  PORT: process.env.PORT ?? 3001,
  MESSAGE_QUEUE_URL: process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3005'
});
