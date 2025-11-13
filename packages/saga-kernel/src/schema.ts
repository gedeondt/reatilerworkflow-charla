import { z } from '@reatiler/shared/z';

const payloadScalarTypes = ['string', 'number', 'boolean'] as const;

export type PayloadPrimitive = (typeof payloadScalarTypes)[number];
export type ScalarValue = string | number | boolean;

export type PayloadFlatObjectSchema = Record<string, PayloadPrimitive>;
export type PayloadArraySchema = [PayloadFlatObjectSchema];
export type PayloadSchemaField = PayloadPrimitive | PayloadFlatObjectSchema | PayloadArraySchema;
export type PayloadSchema = Record<string, PayloadSchemaField>;

export type ScalarMapping = string | { from: string } | { const: ScalarValue };
export type ObjectMapping = { objectFrom?: string; map: Record<string, ScalarMapping> };
export type ArrayObjectMapping = { arrayFrom: string; map: Record<string, ScalarMapping> };
export type EmitMapping = Record<string, ScalarMapping | ObjectMapping | ArrayObjectMapping>;

const scalarTypeSet = new Set<PayloadPrimitive>(payloadScalarTypes);

const payloadPrimitiveSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (scalarTypeSet.has(value as PayloadPrimitive)) {
      return;
    }

    if (value.endsWith('[]')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Scalar array types like "${value}" are not supported; use array of objects instead.`,
      });
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsupported payload scalar type "${value}". Allowed values: string, number, boolean.`,
    });
  });

const payloadFlatObjectSchema = z.record(payloadPrimitiveSchema);
const payloadArraySchema = z.tuple([payloadFlatObjectSchema]);

const payloadSchemaField = z.union([
  payloadPrimitiveSchema,
  payloadFlatObjectSchema,
  payloadArraySchema,
]);
const payloadSchemaDefinition = z.record(payloadSchemaField);

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const scalarMappingSchema: z.ZodType<ScalarMapping> = z.union([
  z.string(),
  z.object({ from: z.string() }).strict(),
  z.object({ const: scalarValueSchema }).strict(),
]);

const objectMappingSchema: z.ZodType<ObjectMapping> = z
  .object({
    objectFrom: z.string().optional(),
    map: z.record(scalarMappingSchema),
  })
  .strict();

const arrayObjectMappingSchema: z.ZodType<ArrayObjectMapping> = z
  .object({
    arrayFrom: z.string(),
    map: z.record(scalarMappingSchema),
  })
  .strict();

const emitMappingSchema: z.ZodType<EmitMapping> = z.record(
  z.union([scalarMappingSchema, objectMappingSchema, arrayObjectMappingSchema])
);

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
    status: z.string(),
  })
  .strict();

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    event: z.string(),
    toDomain: z.string().optional(),
    mapping: emitMappingSchema,
  })
  .strict();

const listenerActionSchema = z.discriminatedUnion('type', [setStateActionSchema, emitActionSchema]);

const listenerSchema = z
  .object({
    id: z.string(),
    delayMs: z.number().optional(),
    on: z.object({ event: z.string() }).strict(),
    actions: z.array(listenerActionSchema),
  })
  .strict();

const eventSchema = z
  .object({
    name: z.string(),
    payloadSchema: payloadSchemaDefinition,
  })
  .strict();

const domainSchema = z
  .object({
    id: z.string(),
    queue: z.string(),
    events: z.array(eventSchema).optional(),
    listeners: z.array(listenerSchema).optional(),
  })
  .strict();

type EventRegistryEntry = {
  domainId: string;
  domainIndex: number;
  eventIndex: number;
  payloadSchema: PayloadSchema;
};

type ValidateEmitMappingParams = {
  ctx: z.RefinementCtx;
  path: Array<string | number>;
  mapping: EmitMapping;
  destinationSchema: PayloadSchema;
  sourceSchema: PayloadSchema;
  sourceEventName: string;
  destinationEventName: string;
};

type ObjectMappingValidationParams = {
  ctx: z.RefinementCtx;
  path: Array<string | number>;
  parentField: string;
  mapping: ObjectMapping;
  destinationSchema: PayloadFlatObjectSchema;
  sourceSchema: PayloadSchema;
  sourceEventName: string;
  destinationEventName: string;
};

type ArrayMappingValidationParams = {
  ctx: z.RefinementCtx;
  path: Array<string | number>;
  parentField: string;
  mapping: ArrayObjectMapping;
  destinationSchema: PayloadArraySchema;
  sourceSchema: PayloadSchema;
  sourceEventName: string;
  destinationEventName: string;
};

type ScalarMappingValidationParams = {
  ctx: z.RefinementCtx;
  path: Array<string | number>;
  fieldName: string;
  mapping: ScalarMapping;
  sourceSchema: PayloadSchema | PayloadFlatObjectSchema;
  sourceDescription: string;
  destinationEventName: string;
};

const getScalarMappingField = (mapping: ScalarMapping): string | null => {
  if (typeof mapping === 'string') {
    return mapping;
  }

  if ('from' in mapping) {
    return mapping.from;
  }

  return null;
};

const isObjectMapping = (
  value: ScalarMapping | ObjectMapping | ArrayObjectMapping
): value is ObjectMapping => typeof value === 'object' && value !== null && 'map' in value && !('arrayFrom' in value);

const isArrayMapping = (
  value: ScalarMapping | ObjectMapping | ArrayObjectMapping
): value is ArrayObjectMapping => typeof value === 'object' && value !== null && 'arrayFrom' in value;

const addIssue = (ctx: z.RefinementCtx, path: Array<string | number>, message: string): void => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
};

const validateScalarMapping = ({
  ctx,
  path,
  fieldName,
  mapping,
  sourceSchema,
  sourceDescription,
  destinationEventName,
}: ScalarMappingValidationParams): void => {
  const referencedField = getScalarMappingField(mapping);

  if (!referencedField) {
    return;
  }

  const value = (sourceSchema as Record<string, PayloadSchemaField | PayloadPrimitive>)[referencedField];

  if (value === undefined) {
    addIssue(
      ctx,
      path,
      `Emit mapping for event "${destinationEventName}" references unknown field "${referencedField}" in ${sourceDescription}`,
    );
    return;
  }

  if (typeof value !== 'string') {
    addIssue(
      ctx,
      path,
      `Emit mapping for event "${destinationEventName}" references field "${referencedField}" in ${sourceDescription} but it is not a scalar value`,
    );
  }
};

const validateObjectMapping = ({
  ctx,
  path,
  parentField,
  mapping,
  destinationSchema,
  sourceSchema,
  sourceEventName,
  destinationEventName,
}: ObjectMappingValidationParams): void => {
  const destinationKeys = Object.keys(destinationSchema);
  const mappingKeys = Object.keys(mapping.map);

  destinationKeys
    .filter((key) => !mappingKeys.includes(key))
    .forEach((key) => {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" is missing definition for field "${parentField}.${key}"`,
      );
    });

  mappingKeys
    .filter((key) => !destinationKeys.includes(key))
    .forEach((key) => {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" references unknown field "${parentField}.${key}" in destination payload`,
      );
    });

  let baseSchema: PayloadSchema | PayloadFlatObjectSchema = sourceSchema;
  let sourceDescription = `event "${sourceEventName}" payload`;

  if (mapping.objectFrom) {
    const sourceField = sourceSchema[mapping.objectFrom];

    if (!sourceField) {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" references unknown object "${mapping.objectFrom}" in event "${sourceEventName}" payload`,
      );
      return;
    }

    if (typeof sourceField === 'string' || Array.isArray(sourceField)) {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" references object "${mapping.objectFrom}" in event "${sourceEventName}" payload but it is not an object`,
      );
      return;
    }

    baseSchema = sourceField;
    sourceDescription = `object "${mapping.objectFrom}" in event "${sourceEventName}" payload`;
  }

  destinationKeys.forEach((key) => {
    const fieldMapping = mapping.map[key];

    if (!fieldMapping) {
      return;
    }

    validateScalarMapping({
      ctx,
      path,
      fieldName: key,
      mapping: fieldMapping,
      sourceSchema: baseSchema,
      sourceDescription,
      destinationEventName,
    });
  });
};

const validateArrayMapping = ({
  ctx,
  path,
  parentField,
  mapping,
  destinationSchema,
  sourceSchema,
  sourceEventName,
  destinationEventName,
}: ArrayMappingValidationParams): void => {
  const destinationElementSchema = destinationSchema[0];
  const sourceArraySchema = sourceSchema[mapping.arrayFrom];

  if (!sourceArraySchema) {
    addIssue(
      ctx,
      path,
      `Emit mapping for event "${destinationEventName}" references unknown array "${mapping.arrayFrom}" in event "${sourceEventName}" payload`,
    );
    return;
  }

  if (!Array.isArray(sourceArraySchema)) {
    addIssue(
      ctx,
      path,
      `Emit mapping for event "${destinationEventName}" references array "${mapping.arrayFrom}" in event "${sourceEventName}" payload but it is not an array of objects`,
    );
    return;
  }

  const sourceDescription = `array "${mapping.arrayFrom}" items in event "${sourceEventName}" payload`;

  validateObjectMapping({
    ctx,
    path,
    parentField,
    mapping: { objectFrom: undefined, map: mapping.map },
    destinationSchema: destinationElementSchema,
    sourceSchema: sourceArraySchema[0],
    sourceEventName,
    destinationEventName,
  });
};

const validateEmitMapping = ({
  ctx,
  path,
  mapping,
  destinationSchema,
  sourceSchema,
  sourceEventName,
  destinationEventName,
}: ValidateEmitMappingParams): void => {
  const destinationKeys = Object.keys(destinationSchema);
  const mappingKeys = Object.keys(mapping);

  destinationKeys
    .filter((key) => !mappingKeys.includes(key))
    .forEach((key) => {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" is missing definition for field "${key}"`,
      );
    });

  mappingKeys
    .filter((key) => !destinationKeys.includes(key))
    .forEach((key) => {
      addIssue(
        ctx,
        path,
        `Emit mapping for event "${destinationEventName}" references unknown destination field "${key}"`,
      );
    });

  destinationKeys.forEach((fieldName) => {
    const fieldSchema = destinationSchema[fieldName];
    const fieldMapping = mapping[fieldName];
    const fieldPath = [...path, fieldName];

    if (fieldSchema === undefined || fieldMapping === undefined) {
      return;
    }

    if (typeof fieldSchema === 'string') {
      if (typeof fieldMapping === 'object' && 'map' in fieldMapping) {
        addIssue(ctx, fieldPath, `Field "${fieldName}" must use scalar mapping`);
        return;
      }

      if (typeof fieldMapping === 'object' && 'arrayFrom' in fieldMapping) {
        addIssue(ctx, fieldPath, `Field "${fieldName}" must use scalar mapping`);
        return;
      }

      validateScalarMapping({
        ctx,
        path: fieldPath,
        fieldName,
        mapping: fieldMapping,
        sourceSchema,
        sourceDescription: `event "${sourceEventName}" payload`,
        destinationEventName,
      });
      return;
    }

    if (Array.isArray(fieldSchema)) {
      if (!isArrayMapping(fieldMapping)) {
        addIssue(ctx, fieldPath, `Field "${fieldName}" must use array mapping`);
        return;
      }

      validateArrayMapping({
        ctx,
        path: fieldPath,
        parentField: fieldName,
        mapping: fieldMapping,
        destinationSchema: fieldSchema,
        sourceSchema,
        sourceEventName,
        destinationEventName,
      });
      return;
    }

    if (!isObjectMapping(fieldMapping)) {
      addIssue(ctx, fieldPath, `Field "${fieldName}" must use object mapping`);
      return;
    }

    validateObjectMapping({
      ctx,
      path: fieldPath,
      parentField: fieldName,
      mapping: fieldMapping,
      destinationSchema: fieldSchema,
      sourceSchema,
      sourceEventName,
      destinationEventName,
    });
  });
};

export const scenarioSchema = z
  .object({
    name: z.string(),
    version: z.number(),
    domains: z.array(domainSchema).min(1),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const domainIds = new Map<string, number>();
    const events = new Map<string, EventRegistryEntry>();

    scenario.domains.forEach((domain, domainIndex) => {
      if (domainIds.has(domain.id)) {
        addIssue(ctx, ['domains', domainIndex, 'id'], `Domain id "${domain.id}" is declared more than once`);
      } else {
        domainIds.set(domain.id, domainIndex);
      }

      domain.events?.forEach((event, eventIndex) => {
        if (events.has(event.name)) {
          addIssue(
            ctx,
            ['domains', domainIndex, 'events', eventIndex, 'name'],
            `Event "${event.name}" is declared more than once`,
          );
        } else {
          events.set(event.name, {
            domainId: domain.id,
            domainIndex,
            eventIndex,
            payloadSchema: event.payloadSchema as PayloadSchema,
          });
        }
      });
    });

    scenario.domains.forEach((domain, domainIndex) => {
      domain.listeners?.forEach((listener, listenerIndex) => {
        const listenerPath: Array<string | number> = ['domains', domainIndex, 'listeners', listenerIndex];
        const sourceEvent = events.get(listener.on.event);

        if (!sourceEvent) {
          addIssue(
            ctx,
            [...listenerPath, 'on', 'event'],
            `Listener "${listener.id}" references unknown event "${listener.on.event}"`,
          );
        }

        listener.actions.forEach((action, actionIndex) => {
          if (action.type !== 'emit') {
            return;
          }

          const actionPath = [...listenerPath, 'actions', actionIndex];
          const destinationEvent = events.get(action.event);

          if (!destinationEvent) {
            addIssue(ctx, [...actionPath, 'event'], `Action emit references unknown event "${action.event}"`);
            return;
          }

          if (action.toDomain && action.toDomain !== destinationEvent.domainId) {
            addIssue(
              ctx,
              [...actionPath, 'toDomain'],
              `Action emit references domain "${action.toDomain}" but event "${action.event}" belongs to domain "${destinationEvent.domainId}"`,
            );
          }

          if (!sourceEvent) {
            return;
          }

          validateEmitMapping({
            ctx,
            path: [...actionPath, 'mapping'],
            mapping: action.mapping,
            sourceSchema: sourceEvent.payloadSchema ?? {},
            destinationSchema: destinationEvent.payloadSchema ?? {},
            sourceEventName: listener.on.event,
            destinationEventName: action.event,
          });
        });
      });
    });
  });

type RawScenarioEvent = z.infer<typeof eventSchema>;
type RawDomain = z.infer<typeof domainSchema>;
type RawScenario = z.infer<typeof scenarioSchema>;

export type ListenerAction = z.infer<typeof listenerActionSchema>;
export type SetStateAction = Extract<ListenerAction, { type: 'set-state' }>;
export type EmitAction = Extract<ListenerAction, { type: 'emit' }>;
export type Listener = z.infer<typeof listenerSchema>;
export type ScenarioEvent = Omit<RawScenarioEvent, 'payloadSchema'> & { payloadSchema: PayloadSchema };
export type Domain = Omit<RawDomain, 'events' | 'listeners'> & {
  events?: ScenarioEvent[];
  listeners?: Listener[];
};
export type Scenario = Omit<RawScenario, 'domains'> & { domains: Domain[] };

export function normalizeScenario(raw: unknown): Scenario {
  const parsed = scenarioSchema.parse(raw);
  return parsed as Scenario;
}
