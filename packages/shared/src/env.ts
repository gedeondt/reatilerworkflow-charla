import { config } from 'dotenv';

import { z } from './z.js';

config();

const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';

const messageQueueUrlSchema = z.string().url();

export function getMessageQueueUrl(): string {
  const rawValue = process.env.MESSAGE_QUEUE_URL;

  if (rawValue === undefined) {
    return DEFAULT_MESSAGE_QUEUE_URL;
  }

  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return DEFAULT_MESSAGE_QUEUE_URL;
  }

  try {
    return messageQueueUrlSchema.parse(trimmedValue);
  } catch (error) {
    if (process.env.NODE_ENV === 'test' && trimmedValue === DEFAULT_MESSAGE_QUEUE_URL) {
      return trimmedValue;
    }

    throw error;
  }
}
