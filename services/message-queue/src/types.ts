export interface EventEnvelope {
  eventName: string;
  version: 1;
  eventId: string;
  traceId: string;
  correlationId: string;
  occurredAt: string;
  causationId?: string;
  data: Record<string, unknown>;
}
