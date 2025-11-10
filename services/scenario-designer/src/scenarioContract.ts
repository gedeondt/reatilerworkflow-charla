import { z } from 'zod';

export const scenarioDslRules = [
  'Contrato DSL REAL:',
  '1. El JSON raíz tiene exactamente { name, version, domains, events, listeners }.',
  '2. domains es una lista de dominios únicos con la forma { "id": string, "queue": string }.',
  '3. events define objetos { "name", "fields" } donde cada campo es "text", "number", "boolean", "datetime" o { "type": "array", "items": tipo escalar u objeto plano de escalares } sin arrays de arrays.',
  '4. listeners reaccionan a un evento con { "id", "delayMs" (>=0), "on": { "event" }, y "actions" de tipo "emit" que solo incluyen { "event", "toDomain", "mode", "map" }.',
  '5. emit.map solo admite "dest": "campoOrigen", "dest": { "const": valor } o "destArray": { "from": "arrayOrigen", "item": { ... } } leyendo únicamente del evento que dispara el listener.',
  '6. No existe contexto global ni claves extra: prohibido subscribesTo, steps, lanes, actors, sagaSummary, openQuestions, payloadSchema, mapping u otras propiedades distintas a las descritas.',
].join('\n');

export const scenarioSystemPrompt = [
  'Eres un asistente que transforma descripciones en escenarios SAGA JSON ejecutables.',
  'Debes usar exclusivamente el DSL descrito a continuación.',
  '',
  scenarioDslRules,
].join('\n');

const scalarFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'datetime']);

const arrayItemsObjectSchema = z.record(scalarFieldTypeSchema);

const arrayFieldSchema = z
  .object({
    type: z.literal('array'),
    items: z.union([scalarFieldTypeSchema, arrayItemsObjectSchema]),
  })
  .strict();

const eventFieldSchema = z.union([scalarFieldTypeSchema, arrayFieldSchema]);

const eventFieldsSchema = z.record(eventFieldSchema);

const domainSchema = z
  .object({
    id: z.string().min(1, 'El id del dominio no puede estar vacío'),
    queue: z.string().min(1, 'La cola del dominio no puede estar vacía'),
  })
  .strict();

const scalarConstantSchema = z.union([z.string(), z.number(), z.boolean()]);

const scalarMappingSchema = z.union([
  z.string().min(1),
  z
    .object({ const: scalarConstantSchema })
    .strict(),
]);

const arrayMappingSchema = z
  .object({
    from: z.string().min(1),
    item: z
      .record(scalarMappingSchema)
      .refine((item) => Object.keys(item).length > 0, 'El mapeo del array no puede estar vacío'),
  })
  .strict();

const emitMapValueSchema = z.union([scalarMappingSchema, arrayMappingSchema]);

const emitMapSchema = z
  .record(emitMapValueSchema)
  .refine((map) => Object.keys(map).length > 0, 'El mapeo no puede estar vacío');

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    mode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
    event: z.string().min(1),
    toDomain: z.string().min(1),
    map: emitMapSchema,
  })
  .strict();

const listenerSchema = z
  .object({
    id: z.string().min(1),
    delayMs: z.number().int().min(0).default(0),
    on: z
      .object({ event: z.string().min(1) })
      .strict(),
    actions: z.array(emitActionSchema).min(1),
  })
  .strict();

export const scenarioContractSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().min(1),
    domains: z.array(domainSchema).min(1),
    events: z
      .array(
        z
          .object({
            name: z.string().min(1),
            fields: eventFieldsSchema,
          })
          .strict(),
      )
      .min(1),
    listeners: z.array(listenerSchema).min(1),
  })
  .strict();

export type ScenarioContract = z.infer<typeof scenarioContractSchema>;
export type ScenarioDomain = ScenarioContract['domains'][number];
export type ScenarioEvent = ScenarioContract['events'][number];
export type ScenarioListener = ScenarioContract['listeners'][number];
export type ScenarioEventField = z.infer<typeof eventFieldSchema>;
export type ScenarioArrayField = z.infer<typeof arrayFieldSchema>;
export type ScenarioArrayItemsObject = z.infer<typeof arrayItemsObjectSchema>;
export type ScenarioMapValue = z.infer<typeof emitMapValueSchema>;

export type ScenarioDslIssue = { message: string; path: (string | number)[] };

const isArrayField = (field: ScenarioEventField): field is ScenarioArrayField =>
  typeof field === 'object' && field !== null && 'type' in field && field.type === 'array';

const isArrayItemsObject = (
  items: ScenarioArrayField['items'],
): items is ScenarioArrayItemsObject => typeof items === 'object' && items !== null;

const ensureUnique = (
  values: string[],
  pathFactory: (index: number) => (string | number)[],
  descriptor: string,
): ScenarioDslIssue[] => {
  const seen = new Map<string, number>();
  const issues: ScenarioDslIssue[] = [];

  values.forEach((value, index) => {
    if (seen.has(value)) {
      issues.push({
        message: `El valor "${value}" de ${descriptor} está duplicado`,
        path: pathFactory(index),
      });
    } else {
      seen.set(value, index);
    }
  });

  return issues;
};

const validateEmitMap = (
  listenerIndex: number,
  actionIndex: number,
  sourceEvent: ScenarioEvent | undefined,
  targetEvent: ScenarioEvent | undefined,
  map: Record<string, ScenarioMapValue>,
): ScenarioDslIssue[] => {
  const issues: ScenarioDslIssue[] = [];

  Object.entries(map).forEach(([destKey, mapping]) => {
    const path: (string | number)[] = ['listeners', listenerIndex, 'actions', actionIndex, 'map', destKey];

    if (targetEvent) {
      const targetField = targetEvent.fields[destKey];

      if (!targetField) {
        issues.push({
          message: `El campo "${destKey}" no existe en el evento destino "${targetEvent.name}"`,
          path,
        });
      } else if (!isArrayField(targetField) && typeof mapping !== 'string' && !('const' in mapping)) {
        issues.push({
          message: `El campo destino "${destKey}" es escalar y debe mapearse con un alias o const`,
          path,
        });
      } else if (isArrayField(targetField) && (typeof mapping === 'string' || 'const' in mapping)) {
        issues.push({
          message: `El campo destino "${destKey}" es un array y requiere la forma { "from", "item" }`,
          path,
        });
      }

      if (isArrayField(targetField) && typeof mapping !== 'string' && !('const' in mapping)) {
        const targetItems = targetField.items;

        if (isArrayItemsObject(targetItems)) {
          Object.keys(mapping.item).forEach((subKey) => {
            if (!(subKey in targetItems)) {
              issues.push({
                message: `El subcampo "${subKey}" no existe en el array destino "${destKey}" del evento "${targetEvent.name}"`,
                path: [...path, 'item', subKey],
              });
            }
          });
        }
      }
    }

    if (typeof mapping === 'string') {
      if (!sourceEvent) {
        issues.push({
          message: `No se puede resolver el campo origen "${mapping}" porque el evento de origen es desconocido`,
          path,
        });
      } else {
        const sourceField = sourceEvent.fields[mapping];

        if (!sourceField) {
          issues.push({
            message: `El campo origen "${mapping}" no existe en el evento "${sourceEvent.name}"`,
            path,
          });
        } else if (isArrayField(sourceField)) {
          issues.push({
            message: `El campo origen "${mapping}" es un array y no puede asignarse directamente a un escalar`,
            path,
          });
        }
      }

      return;
    }

    if ('const' in mapping) {
      return;
    }

    const fromField = mapping.from;

    if (!sourceEvent) {
      issues.push({
        message: `No se puede evaluar el array origen "${fromField}" porque el evento de origen es desconocido`,
        path,
      });
      return;
    }

    const sourceArrayField = sourceEvent.fields[fromField];

    if (!sourceArrayField || !isArrayField(sourceArrayField)) {
      issues.push({
        message: `El campo "${fromField}" del evento "${sourceEvent.name}" debe ser un array para mapear "${destKey}"`,
        path,
      });
      return;
    }

    const sourceItems = sourceArrayField.items;

    Object.entries(mapping.item).forEach(([subKey, subMapping]) => {
      const subPath = [...path, 'item', subKey];

      if (typeof subMapping === 'string') {
        if (!isArrayItemsObject(sourceItems)) {
          issues.push({
            message: `El array "${fromField}" del evento "${sourceEvent.name}" no define subcampos y no puede mapear "${subKey}"`,
            path: subPath,
          });
        } else if (!(subMapping in sourceItems)) {
          issues.push({
            message: `El subcampo origen "${subMapping}" no existe en los elementos del array "${fromField}"`,
            path: subPath,
          });
        }
      }
    });
  });

  return issues;
};

const validateScenarioConsistency = (scenario: ScenarioContract): ScenarioDslIssue[] => {
  const issues: ScenarioDslIssue[] = [];

  issues.push(
    ...ensureUnique(
      scenario.domains.map((domain) => domain.id),
      (index) => ['domains', index, 'id'],
      'dominios',
    ),
  );

  issues.push(
    ...ensureUnique(
      scenario.events.map((event) => event.name),
      (index) => ['events', index, 'name'],
      'eventos',
    ),
  );

  issues.push(
    ...ensureUnique(
      scenario.listeners.map((listener) => listener.id),
      (index) => ['listeners', index, 'id'],
      'listeners',
    ),
  );

  const domains = new Set(scenario.domains.map((domain) => domain.id));
  const events = new Map<string, { event: ScenarioEvent; index: number }>();

  scenario.events.forEach((event, index) => {
    events.set(event.name, { event, index });
  });

  scenario.listeners.forEach((listener, listenerIndex) => {
    const source = events.get(listener.on.event);

    if (!source) {
      issues.push({
        message: `El listener hace on.event="${listener.on.event}" pero ese evento no está definido`,
        path: ['listeners', listenerIndex, 'on', 'event'],
      });
    }

    listener.actions.forEach((action, actionIndex) => {
      if (!domains.has(action.toDomain)) {
        issues.push({
          message: `La acción emite al dominio "${action.toDomain}" que no está definido`,
          path: ['listeners', listenerIndex, 'actions', actionIndex, 'toDomain'],
        });
      }

      const target = events.get(action.event);

      if (!target) {
        issues.push({
          message: `La acción emite el evento "${action.event}" que no está definido`,
          path: ['listeners', listenerIndex, 'actions', actionIndex, 'event'],
        });
      }

      issues.push(...validateEmitMap(listenerIndex, actionIndex, source?.event, target?.event, action.map));
    });
  });

  return issues;
};

export type ScenarioDslValidationResult =
  | { kind: 'schema-error'; error: z.ZodError<ScenarioContract> }
  | { kind: 'ok'; scenario: ScenarioContract; issues: ScenarioDslIssue[] };

export const inspectScenarioContract = (input: unknown): ScenarioDslValidationResult => {
  const parsed = scenarioContractSchema.safeParse(input);

  if (!parsed.success) {
    return { kind: 'schema-error', error: parsed.error };
  }

  return { kind: 'ok', scenario: parsed.data, issues: validateScenarioConsistency(parsed.data) };
};
