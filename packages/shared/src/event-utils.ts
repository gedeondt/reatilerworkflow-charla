import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from './event-bus.js';

export type CreateEventEnvelopeOptions<T extends Record<string, unknown>> = {
  eventName: string;
  traceId: string;
  correlationId: string;
  data: T;
  causationId?: string | null;
};

export function createEventEnvelope<T extends Record<string, unknown>>({
  eventName,
  traceId,
  correlationId,
  data,
  causationId
}: CreateEventEnvelopeOptions<T>): EventEnvelope & { data: T } {
  const envelope: EventEnvelope & { data: T } = {
    eventName,
    version: 1,
    eventId: randomUUID(),
    traceId,
    correlationId,
    occurredAt: new Date().toISOString(),
    data
  };

  if (causationId) {
    envelope.causationId = causationId;
  }

  return envelope;
}
