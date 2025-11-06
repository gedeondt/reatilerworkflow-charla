import { z } from 'zod';
export const envelopeSchema = z.object({
  eventName: z.string(),
  version: z.literal(1),
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  correlationId: z.string().min(1),
  occurredAt: z.string().datetime(),
  causationId: z.string().min(1).optional(),
  data: z.record(z.unknown())
});
export type EventEnvelope = z.infer<typeof envelopeSchema>;
