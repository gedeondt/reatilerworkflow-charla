import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  SCENARIO_NAME: z.string().min(1).default('retailer-happy-path'),
  MESSAGE_QUEUE_URL: z.string().url().default('http://localhost:3005')
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  SCENARIO_NAME: process.env.SCENARIO_NAME,
  MESSAGE_QUEUE_URL: process.env.MESSAGE_QUEUE_URL
});
