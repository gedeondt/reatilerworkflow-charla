import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { z } from './z.js';
import { getMessageQueueUrl } from './env.js';

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

type HttpMethod = 'POST';

type RequestOptions = {
  method: HttpMethod;
  path: string;
  body?: unknown;
};

async function sendRequest({ method, path, body }: RequestOptions): Promise<unknown> {
  const baseUrl = new URL(getMessageQueueUrl());
  const url = new URL(path, baseUrl);
  const isHttps = url.protocol === 'https:';
  const requester = isHttps ? httpsRequest : httpRequest;

  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  const headers: NodeJS.OutgoingHttpHeaders = {};

  if (serializedBody !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(serializedBody).toString();
  }

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
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
            return reject(new Error(rawBody || `Request failed with status ${res.statusCode}`));
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

function encodeQueueName(queue: string): string {
  return encodeURIComponent(queue);
}

export async function push(queue: string, event: EventEnvelope): Promise<void> {
  const parsedEvent = eventEnvelopeSchema.parse(event);

  await sendRequest({
    method: 'POST',
    path: `/queues/${encodeQueueName(queue)}/messages`,
    body: parsedEvent
  });
}

export async function pop(queue: string): Promise<EventEnvelope | null> {
  const response = (await sendRequest({
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
