import { z } from 'zod';

const primitiveFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'datetime']);

const arrayFieldSchema = z
  .object({
    type: z.literal('array'),
    items: z.record(primitiveFieldTypeSchema),
  })
  .strict();

const eventFieldSchema = z.union([primitiveFieldTypeSchema, arrayFieldSchema]);

export const eventFieldsSchema = z.record(eventFieldSchema);

export const scenarioDomainSchema = z
  .object({
    id: z.string().min(1),
    queue: z.string().min(1),
  })
  .strict();

export const scenarioEventSchema = z
  .object({
    name: z.string().min(1),
    fields: eventFieldsSchema.optional(),
  })
  .strict();

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
    domain: z.string().min(1),
    status: z.string().min(1),
  })
  .strict();

const emitArrayItemValueSchema = z.union([
  z.string().min(1),
  z.object({ const: z.unknown() }).strict(),
]);

const emitArrayMapSchema = z
  .object({
    from: z.string().min(1),
    item: z.record(emitArrayItemValueSchema),
  })
  .strict();

const emitMapValueSchema = z.union([
  z.string().min(1),
  z.object({ const: z.unknown() }).strict(),
  emitArrayMapSchema,
]);

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    mode: z.literal('AUTO').optional(),
    event: z.string().min(1),
    toDomain: z.string().min(1),
    map: z.record(emitMapValueSchema).optional(),
  })
  .strict();

export const listenerSchema = z
  .object({
    id: z.string().min(1),
    on: z.object({ event: z.string().min(1) }).strict(),
    delayMs: z.number().int().nonnegative().optional(),
    actions: z.array(z.union([setStateActionSchema, emitActionSchema])).min(1),
  })
  .strict();

export const scenarioContractSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().nonnegative(),
    domains: z.array(scenarioDomainSchema).min(1),
    events: z.array(scenarioEventSchema).min(1),
    listeners: z.array(listenerSchema).min(1),
  })
  .strict();

export type PrimitiveFieldType = z.infer<typeof primitiveFieldTypeSchema>;
export type ArrayField = z.infer<typeof arrayFieldSchema>;
export type EventField = z.infer<typeof eventFieldSchema>;
export type EventFields = z.infer<typeof eventFieldsSchema>;
export type ScenarioDomain = z.infer<typeof scenarioDomainSchema>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
export type SetStateAction = z.infer<typeof setStateActionSchema>;
export type EmitArrayItemValue = z.infer<typeof emitArrayItemValueSchema>;
export type EmitArrayMap = z.infer<typeof emitArrayMapSchema>;
export type EmitMapValue = z.infer<typeof emitMapValueSchema>;
export type EmitAction = z.infer<typeof emitActionSchema>;
export type Listener = z.infer<typeof listenerSchema>;
export type ScenarioContract = z.infer<typeof scenarioContractSchema>;
export type EmitMap = Record<string, EmitMapValue>;

type EmitConstValue = { const: unknown };

const isEmitConstValue = (
  value: EmitMapValue | EmitArrayItemValue,
): value is EmitConstValue => typeof value === 'object' && value !== null && 'const' in value;

const isEmitArrayMapValue = (value: EmitMapValue): value is EmitArrayMap =>
  typeof value === 'object' && value !== null && 'from' in value && 'item' in value;

export const scenarioDslRules = `
El escenario se define con JSON estricto y las siguientes reglas:
- name es un string y version es un número entero.
- domains es un array de objetos { id, queue }.
- events es un array de objetos { name, fields? } y fields describe el payload.
- Cada fields es un diccionario donde el valor es uno de: "text", "number", "boolean", "datetime" o un objeto { "type": "array", "items": { ... } }.
- Los items de un array solo aceptan tipos primitivos del DSL y no pueden anidar otros arrays.
- listeners es un array de objetos con { id, on.event, delayMs?, actions }.
- Las acciones permitidas son:
  - { "type": "set-state", "domain": string, "status": string }.
  - { "type": "emit", "event": string, "toDomain": string, "mode"?: "AUTO", "map"?: { ... } }.
- El map de un emit relaciona campos destino con campos del evento de entrada o valores constantes.
- Para mapear arrays se usa { "from": "arrayOrigen", "item": { destino: origen | { const } } }.
- No se admiten claves adicionales ni modos distintos a AUTO.
`.trim();

const formatIssuePath = (path: (string | number)[]): string =>
  path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : segment.includes('.') ? `['${segment}']` : `.${segment}`,
    )
    .join('')
    .replace(/^\./u, '');

const formatSchemaIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return path ? `${issue.message} (ruta: ${path})` : issue.message;
  });

const isArrayField = (field: EventField | undefined): field is ArrayField =>
  Boolean(field && typeof field === 'object' && 'type' in field && field.type === 'array');

export const validateEmitMap = (
  sourceEventFields: EventFields | undefined,
  targetEventFields: EventFields | undefined,
  map: EmitMap | undefined,
): string[] => {
  if (!map) {
    return [];
  }

  const errors: string[] = [];
  const sourceFields: EventFields = sourceEventFields ?? {};
  const targetFields: EventFields = targetEventFields ?? {};

  for (const [destinationKey, mapping] of Object.entries(map)) {
    const targetField = targetFields[destinationKey];

    if (!targetField) {
      errors.push(`El campo destino "${destinationKey}" no existe en el evento emitido.`);
    }

    if (typeof mapping === 'string') {
      const sourceField = sourceFields[mapping];

      if (!sourceField) {
        errors.push(
          `El campo origen "${mapping}" referenciado en el destino "${destinationKey}" no existe en el evento del listener.`,
        );
      }

      if (isArrayField(sourceField)) {
        errors.push(`El campo origen "${mapping}" es un array y no puede usarse como escalar en "${destinationKey}".`);
      }

      if (isArrayField(targetField)) {
        errors.push(`El campo destino "${destinationKey}" es un array y requiere un mapeo de array.`);
      }

      continue;
    }

    if (isEmitConstValue(mapping)) {
      if (isArrayField(targetField)) {
        errors.push(`El campo destino "${destinationKey}" es un array y requiere un mapeo de array.`);
      }

      continue;
    }

    if (!isEmitArrayMapValue(mapping)) {
      errors.push(
        `El mapeo del campo "${destinationKey}" debe ser un string, un objeto { const } o una definición de array válida.`,
      );
      continue;
    }

    const sourceArray = sourceFields[mapping.from];

    if (!isArrayField(sourceArray)) {
      errors.push(
        `El array origen "${mapping.from}" usado en el destino "${destinationKey}" no existe o no es un array válido en el evento del listener.`,
      );
    }

    if (!isArrayField(targetField)) {
      errors.push(`El campo destino "${destinationKey}" debe ser un array para recibir un mapeo de items.`);
    }

    const itemMappings = mapping.item;
    const sourceItemFields = isArrayField(sourceArray) ? sourceArray.items : {};
    const targetItemFields = isArrayField(targetField) ? targetField.items : {};

    for (const [itemKey, itemMapping] of Object.entries(itemMappings)) {
      if (!targetItemFields[itemKey]) {
        errors.push(
          `El campo de item "${itemKey}" no existe en el array destino "${destinationKey}" del evento emitido.`,
        );
      }

      if (typeof itemMapping === 'string') {
        const sourceItemField = sourceItemFields[itemMapping];

        if (!sourceItemField) {
          errors.push(
            `El campo de item origen "${itemMapping}" referenciado en "${destinationKey}.${itemKey}" no existe en el array origen "${mapping.from}".`,
          );
        }

        if (isArrayField(sourceItemField)) {
          errors.push(
            `El campo de item origen "${itemMapping}" en "${mapping.from}" es un array y no se permiten arrays anidados.`,
          );
        }

        continue;
      }

      if (isEmitConstValue(itemMapping)) {
        continue;
      }

      errors.push(
        `El mapeo del item "${itemKey}" en "${destinationKey}" tiene una estructura inválida. Solo se permiten strings o { const }.`,
      );
    }
  }

  return errors;
};

export type ScenarioInspectionResult =
  | { ok: true; scenario: ScenarioContract }
  | { ok: false; errors: string[] };

export const inspectScenarioContract = (input: unknown): ScenarioInspectionResult => {
  const validation = scenarioContractSchema.safeParse(input);

  if (!validation.success) {
    return { ok: false, errors: formatSchemaIssues(validation.error.issues) };
  }

  const scenario = validation.data;
  const errors: string[] = [];
  const domains = new Set(scenario.domains.map((domain) => domain.id));
  const eventsByName = new Map<string, ScenarioEvent>(
    scenario.events.map((event) => [event.name, event] as const),
  );

  for (const listener of scenario.listeners) {
    const sourceEvent = eventsByName.get(listener.on.event);

    if (!sourceEvent) {
      errors.push(`El listener "${listener.id}" apunta al evento inexistente "${listener.on.event}".`);
    }

    for (const action of listener.actions) {
      if (action.type === 'set-state') {
        if (!domains.has(action.domain)) {
          errors.push(
            `La acción set-state en el listener "${listener.id}" apunta al dominio inexistente "${action.domain}".`,
          );
        }

        continue;
      }

      const targetEvent = eventsByName.get(action.event);

      if (!targetEvent) {
        errors.push(
          `La acción emit en el listener "${listener.id}" apunta al evento inexistente "${action.event}".`,
        );
      }

      if (!domains.has(action.toDomain)) {
        errors.push(
          `La acción emit en el listener "${listener.id}" apunta al dominio inexistente "${action.toDomain}".`,
        );
      }

      const mapErrors = validateEmitMap(
        sourceEvent?.fields,
        targetEvent?.fields,
        action.map,
      );

      errors.push(...mapErrors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, scenario };
};
