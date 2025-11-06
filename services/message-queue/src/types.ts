import { z } from '@reatiler/shared/z';

export const EventEnvelopeSchema = z
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

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
