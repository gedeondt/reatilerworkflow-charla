import { loadEnv, portSchema, queueUrlSchema } from '@reatiler/shared';

export const env = loadEnv(
  {
    PORT: portSchema.default(3004),
    MESSAGE_QUEUE_URL: queueUrlSchema
  },
  { PORT: 3004, MESSAGE_QUEUE_URL: 'http://localhost:3005' }
);
