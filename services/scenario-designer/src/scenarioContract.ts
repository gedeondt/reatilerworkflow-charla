import { z } from 'zod';

const primitiveFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'datetime']);

const arrayItemFieldSchema = z
  .record(primitiveFieldTypeSchema)
  .refine((value) => Object.keys(value).length > 0, 'Array items must declare at least one field');

const arrayFieldSchema = z
  .object({
    type: z.literal('array'),
    items: arrayItemFieldSchema,
  })
  .strict();

const scenarioEventFieldSchema = z.union([primitiveFieldTypeSchema, arrayFieldSchema]);

const scenarioEventFieldsSchema = z
  .record(scenarioEventFieldSchema)
  .refine((value) => Object.keys(value).length > 0, 'Event fields must declare at least one entry');

const scenarioEventSchema = z
  .object({
    name: z.string().trim().min(1, 'Event name must not be empty'),
    fields: scenarioEventFieldsSchema.optional(),
  })
  .strict();

const scenarioDomainSchema = z
  .object({
    id: z.string().trim().min(1, 'Domain id must not be empty'),
    queue: z.string().trim().min(1, 'Domain queue must not be empty'),
  })
  .strict();

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
    domain: z.string().trim().min(1, 'set-state actions require a domain'),
    status: z.string().trim().min(1, 'set-state actions require a status'),
  })
  .strict();

const constValueSchema = z.object({ const: z.unknown() }).strict();

const arrayItemMappingValueSchema = z
  .union([z.string().trim().min(1, 'Array item mappings must reference a field'), constValueSchema])
  .refine((value) => typeof value !== 'string' || value.length > 0, {
    message: 'Array item mappings must reference a field',
  });

const arrayItemMappingSchema = z
  .object({
    from: z.string().trim().min(1, 'Array mappings must reference a source array field'),
    item: z
      .record(arrayItemMappingValueSchema)
      .refine((value) => Object.keys(value).length > 0, 'Array mappings must define at least one destination field'),
  })
  .strict();

const emitMappingValueSchema = z.union([
  z.string().trim().min(1, 'Mappings must reference a source field'),
  constValueSchema,
  arrayItemMappingSchema,
]);

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    mode: z.literal('AUTO').optional(),
    event: z.string().trim().min(1, 'Emit actions require an event name'),
    toDomain: z.string().trim().min(1, 'Emit actions require a destination domain'),
    map: z
      .record(emitMappingValueSchema)
      .refine((value) => Object.keys(value).length > 0, 'Emit mappings must define at least one field')
      .optional(),
  })
  .strict();

const listenerActionSchema = z.union([setStateActionSchema, emitActionSchema]);

const listenerSchema = z
  .object({
    id: z.string().trim().min(1, 'Listener id must not be empty'),
    on: z
      .object({
        event: z.string().trim().min(1, 'Listeners must subscribe to an event'),
      })
      .strict(),
    delayMs: z.number().int().min(0, 'delayMs must be a non-negative integer').optional(),
    actions: z.array(listenerActionSchema).min(1, 'Listeners must declare at least one action'),
  })
  .strict();

export const scenarioContractSchema = z
  .object({
    name: z.string().trim().min(1, 'Scenario name must not be empty'),
    version: z.number().int().min(1, 'Scenario version must be at least 1'),
    domains: z.array(scenarioDomainSchema).min(1, 'Scenario must declare at least one domain'),
    events: z.array(scenarioEventSchema).min(1, 'Scenario must declare at least one event'),
    listeners: z.array(listenerSchema).min(1, 'Scenario must declare at least one listener'),
  })
  .strict();

export type ScenarioContract = z.infer<typeof scenarioContractSchema>;

type ScenarioContractIssueType = 'invalid_json' | 'invalid_contract';

export type InspectScenarioContractFailure = {
  ok: false;
  type: ScenarioContractIssueType;
  errors: string[];
};

export type InspectScenarioContractResult =
  | { ok: true; scenario: ScenarioContract }
  | InspectScenarioContractFailure;

type ScenarioEventFieldInfo =
  | { kind: 'primitive'; type: z.infer<typeof primitiveFieldTypeSchema> }
  | { kind: 'array'; items: Record<string, z.infer<typeof primitiveFieldTypeSchema>> };

type ScenarioEventFieldMap = Map<string, ScenarioEventFieldInfo>;

type EmitArrayMapping = {
  from: string;
  item: Record<string, string | { const: unknown }>;
};

const formatZodIssuePath = (path: (string | number)[]): string =>
  path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : segment.includes('.') ? `['${segment}']` : `.${segment}`,
    )
    .join('')
    .replace(/^[.]/u, '');

const formatZodIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = formatZodIssuePath(issue.path);
    return path ? `${issue.message} (ruta: ${path})` : issue.message;
  });

const buildEventFieldMap = (event: ScenarioContract['events'][number]): ScenarioEventFieldMap => {
  const entries = new Map<string, ScenarioEventFieldInfo>();

  if (!event.fields) {
    return entries;
  }

  for (const [fieldName, definition] of Object.entries(event.fields)) {
    if (typeof definition === 'string') {
      entries.set(fieldName, { kind: 'primitive', type: definition });
      continue;
    }

    entries.set(fieldName, { kind: 'array', items: definition.items });
  }

  return entries;
};

const validateMappings = (scenario: ScenarioContract): string[] => {
  const errors: string[] = [];
  const domains = new Set(scenario.domains.map((domain) => domain.id));
  const eventsByName = new Map<string, ScenarioContract['events'][number]>();
  const eventFieldMaps = new Map<string, ScenarioEventFieldMap>();

  for (const event of scenario.events) {
    eventsByName.set(event.name, event);
    eventFieldMaps.set(event.name, buildEventFieldMap(event));
  }

  for (const listener of scenario.listeners) {
    const sourceEvent = eventsByName.get(listener.on.event);

    if (!sourceEvent) {
      errors.push(
        `Listener "${listener.id}" referencia el evento desconocido "${listener.on.event}" en la propiedad on.event`,
      );
    }

    for (const action of listener.actions) {
      if (action.type === 'set-state') {
        if (!domains.has(action.domain)) {
          errors.push(
            `La acción set-state "${listener.id}" -> "${action.domain}" usa un dominio que no existe en el escenario`,
          );
        }
        continue;
      }

      if (!domains.has(action.toDomain)) {
        errors.push(
          `La acción emit "${listener.id}" envía al dominio desconocido "${action.toDomain}"`,
        );
      }

      const targetEvent = eventsByName.get(action.event);
      if (!targetEvent) {
        errors.push(
          `La acción emit "${listener.id}" referencia el evento de destino desconocido "${action.event}"`,
        );
      }

      if (!action.map || !sourceEvent) {
        continue;
      }

      const fieldMap = eventFieldMaps.get(sourceEvent.name) ?? new Map<string, ScenarioEventFieldInfo>();

      for (const [destinationField, mapping] of Object.entries(action.map)) {
        if (typeof mapping === 'string') {
          const fieldInfo = fieldMap.get(mapping);

          if (!fieldInfo) {
            errors.push(
              `La acción emit "${listener.id}" mapea el campo "${destinationField}" desde "${mapping}" que no existe en el evento "${sourceEvent.name}"`,
            );
            continue;
          }

          if (fieldInfo.kind !== 'primitive') {
            errors.push(
              `La acción emit "${listener.id}" intenta asignar el array "${mapping}" al campo "${destinationField}" sin usar la forma { from, item }`,
            );
          }

          continue;
        }

        if ('const' in mapping) {
          continue;
        }

        if (!('from' in mapping) || !('item' in mapping)) {
          errors.push(
            `La acción emit "${listener.id}" tiene un map inválido para el campo "${destinationField}" y no sigue la forma permitida`,
          );
          continue;
        }

        const arrayMapping = mapping as EmitArrayMapping;
        const arrayInfo = fieldMap.get(arrayMapping.from);

        if (!arrayInfo || arrayInfo.kind !== 'array') {
          errors.push(
            `La acción emit "${listener.id}" referencia el array "${arrayMapping.from}" en el campo "${destinationField}" pero no existe en el evento "${sourceEvent?.name ?? listener.on.event}"`,
          );
          continue;
        }

        for (const [itemDestination, itemMapping] of Object.entries(arrayMapping.item)) {
          if (typeof itemMapping === 'string') {
            if (!(itemMapping in arrayInfo.items)) {
              errors.push(
                `La acción emit "${listener.id}" referencia el campo de item "${itemMapping}" que no existe dentro del array "${arrayMapping.from}" del evento "${sourceEvent.name}"`,
              );
            }
            continue;
          }

          // { const: unknown } es siempre válido, no requiere comprobaciones adicionales
        }
      }
    }
  }

  return errors;
};

const tryParseJson = (input: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
    return { ok: false, error: message };
  }
};

const ensureObjectInput = (input: unknown): { ok: true; value: unknown } | { ok: false; error: string } => {
  if (typeof input === 'string') {
    return tryParseJson(input);
  }

  if (input instanceof Buffer) {
    return tryParseJson(input.toString('utf8'));
  }

  return { ok: true, value: input };
};

export const inspectScenarioContract = (input: unknown): InspectScenarioContractResult => {
  const prepared = ensureObjectInput(input);

  if (!prepared.ok) {
    return { ok: false, type: 'invalid_json', errors: [prepared.error] };
  }

  const parsed = scenarioContractSchema.safeParse(prepared.value);

  if (!parsed.success) {
    return { ok: false, type: 'invalid_contract', errors: formatZodIssues(parsed.error.issues) };
  }

  const mappingErrors = validateMappings(parsed.data);

  if (mappingErrors.length > 0) {
    return { ok: false, type: 'invalid_contract', errors: mappingErrors };
  }

  return { ok: true, scenario: parsed.data };
};
