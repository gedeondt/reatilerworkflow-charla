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
