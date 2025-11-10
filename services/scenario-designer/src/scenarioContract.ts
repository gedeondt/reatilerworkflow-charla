import { z } from 'zod';

const primitiveFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'datetime']);

const arrayFieldSchema = z
  .object({
    type: z.literal('array'),
    items: z.record(primitiveFieldTypeSchema),
  })
  .strict();

const eventFieldSchema = z.record(primitiveFieldTypeSchema.or(arrayFieldSchema));

const constValueSchema = z.object({ const: z.unknown() }).strict();

const arrayItemMapSchema = z
  .object({
    from: z.string().min(1),
    item: z.record(z.union([z.string().min(1), constValueSchema])),
  })
  .strict();

const mapValueSchema = z.union([z.string().min(1), constValueSchema, arrayItemMapSchema]);

type MapValue = z.infer<typeof mapValueSchema>;
type ConstMapValue = Extract<MapValue, { const: unknown }>;
type ArrayMapValue = Extract<MapValue, { from: string }>;

const isConstMapValue = (value: MapValue | ConstMapValue): value is ConstMapValue =>
  typeof value === 'object' && value !== null && 'const' in value;

const isArrayMapValue = (value: MapValue): value is ArrayMapValue =>
  typeof value === 'object' && value !== null && 'from' in value && 'item' in value;

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    mode: z.literal('AUTO').optional(),
    event: z.string().min(1),
    toDomain: z.string().min(1),
    map: z.record(mapValueSchema).optional(),
  })
  .strict();

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
    domain: z.string().min(1),
    status: z.string().min(1),
  })
  .strict();

const listenerSchema = z
  .object({
    id: z.string().min(1),
    on: z.object({ event: z.string().min(1) }).strict(),
    delayMs: z.number().int().nonnegative().optional(),
    actions: z.array(z.union([setStateActionSchema, emitActionSchema])).min(1),
  })
  .strict();

const eventSchema = z
  .object({
    name: z.string().min(1),
    fields: eventFieldSchema.optional(),
  })
  .strict();

const domainSchema = z
  .object({
    id: z.string().min(1),
    queue: z.string().min(1),
  })
  .strict();

export const scenarioContractSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().nonnegative(),
    domains: z.array(domainSchema).min(1),
    events: z.array(eventSchema).min(1),
    listeners: z.array(listenerSchema).min(1),
  })
  .strict();

export type ScenarioContract = z.infer<typeof scenarioContractSchema>;

export type InspectScenarioContractSuccess = { ok: true; scenario: ScenarioContract };
export type InspectScenarioContractFailure = {
  ok: false;
  type: 'invalid_json' | 'invalid_contract';
  errors: string[];
};

export type InspectScenarioContractResult =
  | InspectScenarioContractSuccess
  | InspectScenarioContractFailure;

const formatIssuePath = (path: (string | number)[]): string =>
  path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : segment.includes('.') ? `['${segment}']` : `.${segment}`,
    )
    .join('')
    .replace(/^[.]/u, '');

const formatIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return path ? `${issue.message} (ruta: ${path})` : issue.message;
  });

type EventFieldInfo = {
  scalarFields: Set<string>;
  arrayItems: Map<string, Set<string>>;
};

const collectEventFieldInfo = (scenario: ScenarioContract): Map<string, EventFieldInfo> => {
  const eventFieldMap = new Map<string, EventFieldInfo>();

  for (const event of scenario.events) {
    const scalarFields = new Set<string>();
    const arrayItems = new Map<string, Set<string>>();

    if (event.fields) {
      for (const [fieldName, fieldSchema] of Object.entries(event.fields)) {
        if (typeof fieldSchema === 'string') {
          scalarFields.add(fieldName);
          continue;
        }

        arrayItems.set(fieldName, new Set(Object.keys(fieldSchema.items)));
      }
    }

    eventFieldMap.set(event.name, { scalarFields, arrayItems });
  }

  return eventFieldMap;
};

const isConstItemValue = (value: unknown): value is ConstMapValue =>
  typeof value === 'object' && value !== null && 'const' in value;

const validateEmitMaps = (scenario: ScenarioContract): string[] => {
  const errors: string[] = [];
  const eventsByName = collectEventFieldInfo(scenario);

  for (const listener of scenario.listeners) {
    const onEvent = listener.on.event;
    const eventInfo = eventsByName.get(onEvent);

    if (!eventInfo) {
      errors.push(`El listener '${listener.id}' hace referencia al evento '${onEvent}', que no existe.`);
      continue;
    }

    for (const action of listener.actions) {
      if (action.type !== 'emit' || !action.map) {
        continue;
      }

      for (const [destField, rawValue] of Object.entries(action.map)) {
        const value = rawValue as MapValue;

        if (typeof value === 'string') {
          if (!eventInfo.scalarFields.has(value)) {
            errors.push(
              `La acción emit '${action.event}' en el listener '${listener.id}' mapea el campo '${destField}' desde '${value}', que no existe en el evento '${onEvent}'.`,
            );
          }

          continue;
        }

        if (isConstMapValue(value)) {
          continue;
        }

        if (!isArrayMapValue(value)) {
          errors.push(
            `La acción emit '${action.event}' en el listener '${listener.id}' tiene un mapeo inválido en '${destField}'.`,
          );
          continue;
        }

        const sourceArray = eventInfo.arrayItems.get(value.from);

        if (!sourceArray) {
          errors.push(
            `La acción emit '${action.event}' en el listener '${listener.id}' intenta mapear el array '${value.from}', que no existe en el evento '${onEvent}'.`,
          );
          continue;
        }

        for (const [itemDestField, itemValue] of Object.entries(value.item)) {
          if (typeof itemValue === 'string') {
            if (!sourceArray.has(itemValue)) {
              errors.push(
                `La acción emit '${action.event}' en el listener '${listener.id}' mapea el campo de item '${itemDestField}' desde '${itemValue}', que no existe en los elementos del array '${value.from}' del evento '${onEvent}'.`,
              );
            }

            continue;
          }

          if (!isConstItemValue(itemValue)) {
            errors.push(
              `La acción emit '${action.event}' en el listener '${listener.id}' tiene un mapeo inválido en '${destField}.${itemDestField}'.`,
            );
          }
        }
      }
    }
  }

  return errors;
};

export const inspectScenarioContract = (
  content: string | unknown,
): InspectScenarioContractResult => {
  let parsed: unknown = content;

  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      return {
        ok: false,
        type: 'invalid_json',
        errors: ['La respuesta del modelo no es JSON válido.'],
      };
    }
  }

  const validation = scenarioContractSchema.safeParse(parsed);

  if (!validation.success) {
    return {
      ok: false,
      type: 'invalid_contract',
      errors: formatIssues(validation.error.issues),
    };
  }

  const scenario = validation.data;
  const referenceErrors = validateEmitMaps(scenario);

  if (referenceErrors.length > 0) {
    return {
      ok: false,
      type: 'invalid_contract',
      errors: referenceErrors,
    };
  }

  return { ok: true, scenario };
};
