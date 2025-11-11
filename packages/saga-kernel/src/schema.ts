import { z } from '@reatiler/shared/z';

const domainEventSchema = z.object({
  name: z.string(),
  payloadSchema: z.any().optional()
});

const listenerActionSchema = z.object({
  type: z.enum(['emit', 'set-state']),
  event: z.string().optional(),
  toDomain: z.string().optional(),
  status: z.string().optional(),
  mapping: z.any().optional()
});

const domainListenerSchema = z.object({
  id: z.string(),
  delayMs: z.number().optional(),
  on: z.object({
    event: z.string()
  }),
  actions: z.array(listenerActionSchema)
});

const domainSchema = z.object({
  id: z.string(),
  queue: z.string(),
  events: z.array(domainEventSchema).optional(),
  listeners: z.array(domainListenerSchema).optional()
});

export const scenarioSchema = z.object({
  name: z.string(),
  version: z.number(),
  domains: z.array(domainSchema)
});

export type Scenario = z.infer<typeof scenarioSchema>;

export function normalizeScenario(raw: unknown): Scenario {
  return scenarioSchema.parse(raw);
}
