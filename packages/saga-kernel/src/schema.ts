import { z } from '@reatiler/shared/z';

const domainSchema = z
  .object({
    id: z.string().min(1, 'Domain id must be a non-empty string'),
    queue: z.string().min(1, 'Domain queue must be a non-empty string')
  })
  .strict();

export type Domain = z.infer<typeof domainSchema>;

const eventSchema = z
  .object({
    name: z.string().min(1, 'Event name must be a non-empty string')
  })
  .strict();

export type ScenarioEvent = z.infer<typeof eventSchema>;

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    event: z.string().min(1, 'Emit action requires an event name'),
    toDomain: z.string().min(1, 'Emit action requires a target domain')
  })
  .strict();

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
    domain: z.string().min(1, 'Set-state action requires a domain id'),
    status: z.string().min(1, 'Set-state action requires a status')
  })
  .strict();

export const listenerActionSchema = z.union([emitActionSchema, setStateActionSchema]);

export type ListenerAction = z.infer<typeof listenerActionSchema>;

const listenerSchema = z
  .object({
    id: z.string().min(1, 'Listener id must be a non-empty string'),
    on: z
      .object({
        event: z.string().min(1, 'Listener on.event must reference an existing event')
      })
      .strict(),
    delayMs: z.number().int().min(0).optional(),
    actions: z.array(listenerActionSchema).min(1, 'Listener must define at least one action')
  })
  .strict();

export type Listener = z.infer<typeof listenerSchema>;

export const scenarioSchema = z
  .object({
    name: z.string().min(1, 'Scenario name must be a non-empty string'),
    version: z.number().int().min(0, 'Scenario version must be a positive integer'),
    domains: z.array(domainSchema).min(1, 'Scenario must declare at least one domain'),
    events: z.array(eventSchema).min(1, 'Scenario must declare at least one event'),
    listeners: z.array(listenerSchema)
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const domainIds = new Set<string>();

    for (const [index, domain] of scenario.domains.entries()) {
      if (domainIds.has(domain.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Domain id "${domain.id}" is declared more than once`,
          path: ['domains', index, 'id']
        });
      } else {
        domainIds.add(domain.id);
      }
    }

    const domainById = new Map(scenario.domains.map((domain) => [domain.id, domain] as const));

    const eventNames = new Set<string>();

    for (const [index, event] of scenario.events.entries()) {
      if (eventNames.has(event.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Event "${event.name}" is declared more than once`,
          path: ['events', index, 'name']
        });
      } else {
        eventNames.add(event.name);
      }
    }

    const listenerIds = new Set<string>();

    for (const [index, listener] of scenario.listeners.entries()) {
      if (listenerIds.has(listener.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Listener id "${listener.id}" is declared more than once`,
          path: ['listeners', index, 'id']
        });
      } else {
        listenerIds.add(listener.id);
      }

      if (!eventNames.has(listener.on.event)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Listener "${listener.id}" references unknown event "${listener.on.event}"`,
          path: ['listeners', index, 'on', 'event']
        });
      }

      listener.actions.forEach((action, actionIndex) => {
        if (action.type === 'set-state') {
          if (!domainById.has(action.domain)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Action ${action.type} references unknown domain "${action.domain}"`,
              path: ['listeners', index, 'actions', actionIndex, 'domain']
            });
          }
        }

        if (action.type === 'emit') {
          if (!eventNames.has(action.event)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Action emit references unknown event "${action.event}"`,
              path: ['listeners', index, 'actions', actionIndex, 'event']
            });
          }

          if (!domainById.has(action.toDomain)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Action emit references unknown domain "${action.toDomain}"`,
              path: ['listeners', index, 'actions', actionIndex, 'toDomain']
            });
          }
        }
      });
    }
  });

export type Scenario = z.infer<typeof scenarioSchema>;
