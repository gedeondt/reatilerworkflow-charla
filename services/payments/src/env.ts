import { loadEnv, portSchema, queueUrlSchema } from '@reatiler/shared';

export const env = loadEnv(
  {
    PORT: portSchema.default(3003),
    MESSAGE_QUEUE_URL: queueUrlSchema
  },
  { PORT: 3003, MESSAGE_QUEUE_URL: 'http://localhost:3005' }
);
