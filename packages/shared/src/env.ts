import { config } from 'dotenv';

import { z } from './z.js';

config();

const messageQueueEnvSchema = z.object({
  MESSAGE_QUEUE_URL: z.string().url()
});

export type MessageQueueEnv = z.infer<typeof messageQueueEnvSchema>;

let cachedEnv: MessageQueueEnv | null = null;

export function loadMessageQueueEnv(overrides: Partial<MessageQueueEnv> = {}): MessageQueueEnv {
  if (Object.keys(overrides).length > 0) {
    return messageQueueEnvSchema.parse({
      MESSAGE_QUEUE_URL: overrides.MESSAGE_QUEUE_URL ?? process.env.MESSAGE_QUEUE_URL
    });
  }

  if (!cachedEnv) {
    cachedEnv = messageQueueEnvSchema.parse({
      MESSAGE_QUEUE_URL: process.env.MESSAGE_QUEUE_URL
    });
  }

  return cachedEnv;
}

export function getMessageQueueUrl(overrides: Partial<MessageQueueEnv> = {}): string {
  return loadMessageQueueEnv(overrides).MESSAGE_QUEUE_URL;
}
