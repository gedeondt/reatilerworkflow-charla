import { randomUUID } from 'node:crypto';
import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { z } from './z.js';
import { getMessageQueueUrl } from './env.js';
import { getEventSchema, type EventData, type EventName } from './events-schemas.js';

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
    traceId: z.string().min(1),
    correlationId: z.string().min(1),
    occurredAt: z.string().datetime(),
    causationId: z.string().min(1).nullable().optional(),
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
  const headers: OutgoingHttpHeaders = {};

  if (serializedBody !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(serializedBody).toString();
  }

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers
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
        path: `/queues/${encodeQueueName(queue)}/pop`
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

export function createEnvEventBus(): EventBus {
  return createHttpEventBus(getMessageQueueUrl());
}

export function createEvent<N extends EventName>(
  eventName: N,
  data: EventData<N>,
  {
    traceId,
    correlationId,
    causationId
  }: { traceId: string; correlationId: string; causationId?: string | null }
): (EventEnvelope & { eventName: N; data: EventData<N> }) {
  const schema = getEventSchema(eventName);

  const parsedData = schema.parse(data) as EventData<N>;

  const envelope: EventEnvelope = {
    eventName,
    version: 1,
    eventId: randomUUID(),
    traceId,
    correlationId,
    occurredAt: new Date().toISOString(),
    data: parsedData
  };

  if (typeof causationId === 'string' && causationId.length > 0) {
    envelope.causationId = causationId;
  }

  return envelope as EventEnvelope & { eventName: N; data: EventData<N> };
}

export function parseEvent<N extends EventName>(
  eventName: N,
  envelope: EventEnvelope
): {
  envelope: EventEnvelope & { eventName: N };
  data: EventData<N>;
} {
  const parsedEnvelope = eventEnvelopeSchema.parse(envelope);

  if (parsedEnvelope.eventName !== eventName) {
    throw new Error(
      `Unexpected event received. Expected "${eventName}" but got "${parsedEnvelope.eventName}".`
    );
  }

  const schema = getEventSchema(eventName);

  const data = schema.parse(parsedEnvelope.data) as EventData<N>;

  return {
    envelope: parsedEnvelope as EventEnvelope & { eventName: N },
    data
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
