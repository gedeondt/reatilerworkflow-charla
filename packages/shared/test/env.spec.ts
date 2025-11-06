import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getMessageQueueUrl } from '../src/env.js';

const ORIGINAL_ENV = process.env.MESSAGE_QUEUE_URL;

describe('getMessageQueueUrl', () => {
  beforeEach(() => {
    delete process.env.MESSAGE_QUEUE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.MESSAGE_QUEUE_URL;
    } else {
      process.env.MESSAGE_QUEUE_URL = ORIGINAL_ENV;
    }
  });

  it('returns localhost fallback when env var is not set', () => {
    expect(getMessageQueueUrl()).toBe('http://localhost:3005');
  });

  it('returns provided url when env var is valid', () => {
    process.env.MESSAGE_QUEUE_URL = 'http://mq:3005';

    expect(getMessageQueueUrl()).toBe('http://mq:3005');
  });

  it('throws when env var is not a valid url', () => {
    process.env.MESSAGE_QUEUE_URL = 'not-a-url';

    expect(() => getMessageQueueUrl()).toThrowError();
  });
});
