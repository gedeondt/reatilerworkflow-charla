import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { z } from './z.js';

export type EventEnvelope = {
  eventName: string;
  version: 1;
  eventId: string;
  traceId: string;
  correlationId: string;
  occurredAt: string;
  causationId?: string | null;
  data: Record<string, unknown>;
};

const eventEnvelopeSchema = z
  .object({
    eventName: z.string(),
    version: z.literal(1),
    eventId: z.string().min(1),
    traceId: z.string(),
    correlationId: z.string(),
    occurredAt: z.string().datetime(),
    causationId: z.string().nullable().optional(),
    data: z.record(z.unknown())
  })
  .strict();

export interface EventBus {
  push(queue: string, event: EventEnvelope): Promise<void>;
  pop(queue: string): Promise<EventEnvelope | null>;
}

type HttpMethod = 'POST';

type RequestOptions = {
  method: HttpMethod;
  path: string;
  body?: unknown;
};

function encodeQueueName(queue: string): string {
  return encodeURIComponent(queue);
}

function getRequester(url: URL) {
  return url.protocol === 'https:' ? httpsRequest : httpRequest;
}

async function sendRequest(baseUrl: URL, { method, path, body }: RequestOptions): Promise<unknown> {
  const url = new URL(path, baseUrl);
  const requester = getRequester(url);
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'content-type': 'application/json',
          ...(serializedBody ? { 'content-length': Buffer.byteLength(serializedBody).toString() } : {})
        }
      },
      (res) => {
        const chunks: Uint8Array[] = [];

        res.on('data', (chunk) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });

        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(rawBody || `Request failed with status ${res.statusCode}`));
            return;
          }

          if (!rawBody) {
            resolve(undefined);
            return;
          }

          try {
            resolve(JSON.parse(rawBody));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);

    if (serializedBody) {
      req.write(serializedBody);
    }

    req.end();
  });
}

export function createHttpEventBus(baseUrl: string): EventBus {
  const parsedBaseUrl = new URL(baseUrl);

  return {
    async push(queue: string, event: EventEnvelope): Promise<void> {
      const payload = eventEnvelopeSchema.parse(event);

      await sendRequest(parsedBaseUrl, {
        method: 'POST',
        path: `/queues/${encodeQueueName(queue)}/messages`,
        body: payload
      });
    },
    async pop(queue: string): Promise<EventEnvelope | null> {
      const response = (await sendRequest(parsedBaseUrl, {
        method: 'POST',
        path: `/queues/${encodeQueueName(queue)}:pop`
      })) as unknown;

      if (!response) {
        return null;
      }

      const payload = response as Record<string, unknown>;

      if (payload.status === 'empty') {
        return null;
      }

      if (!('message' in payload)) {
        throw new Error('Unexpected response shape from message queue.');
      }

      const message = eventEnvelopeSchema.parse(payload.message);

      return message;
    }
  };
}

export class FakeEventBus implements EventBus {
  private readonly queues = new Map<string, EventEnvelope[]>();

  async push(queue: string, event: EventEnvelope): Promise<void> {
    const payload = eventEnvelopeSchema.parse(event);
    const currentQueue = this.queues.get(queue) ?? [];
    currentQueue.push(payload);
    this.queues.set(queue, currentQueue);
  }

  async pop(queue: string): Promise<EventEnvelope | null> {
    const currentQueue = this.queues.get(queue);

    if (!currentQueue || currentQueue.length === 0) {
      return null;
    }

    const message = currentQueue.shift() ?? null;
    return message;
  }

  reset(): void {
    this.queues.clear();
  }
}

export { eventEnvelopeSchema };
