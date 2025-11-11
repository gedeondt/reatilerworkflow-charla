import { z } from '@reatiler/shared/z';

const domainSchema = z
  .object({
    id: z.string().min(1, 'Domain id must be a non-empty string'),
    queue: z.string().min(1, 'Domain queue must be a non-empty string')
  })
  .strict();

export type Domain = z.infer<typeof domainSchema>;

const payloadPrimitiveSchema = z.enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]']);

export type PayloadPrimitive = z.infer<typeof payloadPrimitiveSchema>;

const payloadFlatObjectSchema: z.ZodType<Record<string, PayloadPrimitive>> = z
  .object({})
  .catchall(payloadPrimitiveSchema);

const payloadArrayOfFlatObjectsSchema = z
  .array(payloadFlatObjectSchema)
  .nonempty('Array schemas must include at least one object with primitive fields');

const payloadFieldSchema = z.union([
  payloadPrimitiveSchema,
  payloadFlatObjectSchema,
  payloadArrayOfFlatObjectsSchema
]);

const payloadSchema = z.object({}).catchall(payloadFieldSchema);

export type PayloadSchema = z.infer<typeof payloadSchema>;

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export type ScalarValue = z.infer<typeof scalarValueSchema>;

const scalarMappingSchema = z.union([
  z.string().min(1),
  z
    .object({ from: z.string().min(1) })
    .strict(),
  z
    .object({ const: scalarValueSchema })
    .strict()
]);

export type ScalarMapping = z.infer<typeof scalarMappingSchema>;

const objectMappingSchema = z
  .object({
    objectFrom: z.string().min(1).optional(),
    map: z
      .record(scalarMappingSchema)
      .refine((map) => Object.keys(map).length > 0, 'Object mapping requires at least one field')
  })
  .strict();

export type ObjectMapping = z.infer<typeof objectMappingSchema>;

const arrayObjectMappingSchema = z
  .object({
    arrayFrom: z.string().min(1),
    map: z
      .record(scalarMappingSchema)
      .refine((map) => Object.keys(map).length > 0, 'Array mapping requires at least one field')
  })
  .strict();

export type ArrayObjectMapping = z.infer<typeof arrayObjectMappingSchema>;

const emitFieldMappingSchema = z.union([
  scalarMappingSchema,
  objectMappingSchema,
  arrayObjectMappingSchema
]);

const emitMappingSchema = z.record(emitFieldMappingSchema);

export type EmitMapping = z.infer<typeof emitMappingSchema>;

type EmitFieldMapping = z.infer<typeof emitFieldMappingSchema>;
type PayloadField = z.infer<typeof payloadFieldSchema>;
type PayloadFlatObject = z.infer<typeof payloadFlatObjectSchema>;
type PayloadArrayOfFlatObjects = z.infer<typeof payloadArrayOfFlatObjectsSchema>;

const primitiveTypes = new Set<PayloadPrimitive>(['string', 'number', 'boolean']);
const primitiveArrayTypes = new Set<PayloadPrimitive>(['string[]', 'number[]', 'boolean[]']);

type NormalizedScalarMapping =
  | { kind: 'from'; field: string }
  | { kind: 'const'; value: ScalarValue };

const isScalarMappingValue = (value: EmitFieldMapping): value is ScalarMapping =>
  typeof value === 'string' ||
  (typeof value === 'object' && value !== null && ('from' in value || 'const' in value));

const isObjectMappingValue = (value: EmitFieldMapping): value is ObjectMapping =>
  typeof value === 'object' &&
  value !== null &&
  'map' in value &&
  !('arrayFrom' in value) &&
  !('from' in value) &&
  !('const' in value);

const isArrayObjectMappingValue = (value: EmitFieldMapping): value is ArrayObjectMapping =>
  typeof value === 'object' && value !== null && 'arrayFrom' in value && 'map' in value;

const normalizeScalarMappingValue = (value: ScalarMapping): NormalizedScalarMapping => {
  if (typeof value === 'string') {
    return { kind: 'from', field: value };
  }

  if ('from' in value) {
    return { kind: 'from', field: value.from };
  }

  return { kind: 'const', value: value.const };
};

const lookupPrimitiveFieldType = (
  schema: Record<string, PayloadField | PayloadPrimitive> | undefined,
  field: string
): PayloadPrimitive | null => {
  if (!schema) {
    return null;
  }

  const candidate = schema[field] as PayloadField | PayloadPrimitive | undefined;

  if (typeof candidate === 'string') {
    return candidate as PayloadPrimitive;
  }

  return null;
};

const getObjectSchemaFromSource = (
  sourceSchema: PayloadSchema | undefined,
  objectKey: string
): PayloadFlatObject | null => {
  if (!sourceSchema) {
    return null;
  }

  const candidate = sourceSchema[objectKey];

  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as PayloadFlatObject;
  }

  return null;
};

const getArrayObjectSchemaFromSource = (
  sourceSchema: PayloadSchema | undefined,
  arrayKey: string
): PayloadFlatObject | null => {
  if (!sourceSchema) {
    return null;
  }

  const candidate = sourceSchema[arrayKey];

  if (Array.isArray(candidate) && candidate.length > 0) {
    const first = candidate[0];

    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return first as PayloadFlatObject;
    }
  }

  return null;
};

type ScalarValidationOptions = {
  mappingValue: ScalarMapping;
  destinationType: PayloadPrimitive;
  baseSchema: Record<string, PayloadField | PayloadPrimitive> | undefined;
  baseDescription: string;
  path: (string | number)[];
  pushIssue: (message: string, path: (string | number)[]) => void;
  targetEventName: string;
};

const validateScalarMappingDefinition = ({
  mappingValue,
  destinationType,
  baseSchema,
  baseDescription,
  path,
  pushIssue,
  targetEventName
}: ScalarValidationOptions): void => {
  const normalized = normalizeScalarMappingValue(mappingValue);

  if (normalized.kind === 'const') {
    if (!primitiveTypes.has(destinationType)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" cannot assign a constant to non-scalar field with type "${destinationType}"`,
        path
      );
      return;
    }

    const value = normalized.value;

    if (
      (destinationType === 'string' && typeof value !== 'string') ||
      (destinationType === 'number' && typeof value !== 'number') ||
      (destinationType === 'boolean' && typeof value !== 'boolean')
    ) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" assigns a constant incompatible with destination type "${destinationType}"`,
        path
      );
    }

    return;
  }

  if (!baseSchema) {
    return;
  }

  const sourceType = lookupPrimitiveFieldType(baseSchema, normalized.field);

  if (!sourceType) {
    pushIssue(
      `Emit mapping for event "${targetEventName}" references unknown field "${normalized.field}" in ${baseDescription}`,
      path
    );
    return;
  }

  if (sourceType !== destinationType) {
    pushIssue(
      `Emit mapping for event "${targetEventName}" references field "${normalized.field}" in ${baseDescription} with incompatible type "${sourceType}"`,
      path
    );
  }
};

type ObjectValidationOptions = {
  fieldName: string;
  mappingValue: ObjectMapping;
  destinationObjectSchema: PayloadFlatObject;
  sourceSchema: PayloadSchema | undefined;
  pushIssue: (message: string, path: (string | number)[]) => void;
  targetEventName: string;
  sourceEventName: string;
};

const validateObjectMappingDefinition = ({
  fieldName,
  mappingValue,
  destinationObjectSchema,
  sourceSchema,
  pushIssue,
  targetEventName,
  sourceEventName
}: ObjectValidationOptions): void => {
  let baseSchema: Record<string, PayloadField | PayloadPrimitive> | undefined = sourceSchema;
  let baseDescription = `event "${sourceEventName}" payload`;

  if (mappingValue.objectFrom) {
    const objectSchema = getObjectSchemaFromSource(sourceSchema, mappingValue.objectFrom);

    if (!objectSchema) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" references objectFrom "${mappingValue.objectFrom}" which is not a flat object in event "${sourceEventName}"`,
        ['mapping', fieldName, 'objectFrom']
      );
      baseSchema = undefined;
    } else {
      baseSchema = objectSchema;
      baseDescription = `object "${mappingValue.objectFrom}" of event "${sourceEventName}"`;
    }
  }

  const destinationKeys = Object.keys(destinationObjectSchema);

  destinationKeys.forEach((key) => {
    if (!(key in mappingValue.map)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" is missing definition for field "${key}" in object "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
    }
  });

  Object.keys(mappingValue.map).forEach((key) => {
    if (!(key in destinationObjectSchema)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" references unknown field "${key}" in object "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
    }
  });

  Object.entries(mappingValue.map).forEach(([key, value]) => {
    if (!(key in destinationObjectSchema)) {
      return;
    }

    if (!isScalarMappingValue(value)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" must define scalar mappings for object field "${key}" in "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
      return;
    }

    const destinationType = destinationObjectSchema[key];

    validateScalarMappingDefinition({
      mappingValue: value,
      destinationType,
      baseSchema,
      baseDescription,
      path: ['mapping', fieldName, 'map', key],
      pushIssue,
      targetEventName
    });
  });
};

type ArrayValidationOptions = {
  fieldName: string;
  mappingValue: ArrayObjectMapping;
  destinationArraySchema: PayloadArrayOfFlatObjects;
  sourceSchema: PayloadSchema | undefined;
  pushIssue: (message: string, path: (string | number)[]) => void;
  targetEventName: string;
  sourceEventName: string;
};

const validateArrayMappingDefinition = ({
  fieldName,
  mappingValue,
  destinationArraySchema,
  sourceSchema,
  pushIssue,
  targetEventName,
  sourceEventName
}: ArrayValidationOptions): void => {
  const elementSchema = destinationArraySchema[0];
  const sourceElementSchema = getArrayObjectSchemaFromSource(sourceSchema, mappingValue.arrayFrom);

  if (!sourceElementSchema) {
    pushIssue(
      `Emit mapping for event "${targetEventName}" references arrayFrom "${mappingValue.arrayFrom}" which is not an array of flat objects in event "${sourceEventName}"`,
      ['mapping', fieldName, 'arrayFrom']
    );
  }

  const destinationKeys = Object.keys(elementSchema);

  destinationKeys.forEach((key) => {
    if (!(key in mappingValue.map)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" is missing definition for field "${key}" in items of "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
    }
  });

  Object.keys(mappingValue.map).forEach((key) => {
    if (!(key in elementSchema)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" references unknown field "${key}" in items of "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
    }
  });

  Object.entries(mappingValue.map).forEach(([key, value]) => {
    if (!(key in elementSchema)) {
      return;
    }

    if (!isScalarMappingValue(value)) {
      pushIssue(
        `Emit mapping for event "${targetEventName}" must define scalar mappings for field "${key}" in items of "${fieldName}"`,
        ['mapping', fieldName, 'map', key]
      );
      return;
    }

    const destinationType = elementSchema[key];

    validateScalarMappingDefinition({
      mappingValue: value,
      destinationType,
      baseSchema: sourceElementSchema ?? undefined,
      baseDescription: `elements of array "${mappingValue.arrayFrom}" in event "${sourceEventName}"`,
      path: ['mapping', fieldName, 'map', key],
      pushIssue,
      targetEventName
    });
  });
};

type EmitValidationOptions = {
  ctx: z.RefinementCtx;
  basePath: (string | number)[];
  action: Extract<ListenerAction, { type: 'emit' }>;
  sourceEvent: ScenarioEvent | undefined;
  destinationEvent: ScenarioEvent;
  sourceEventName: string;
};

const validateEmitMappingDefinition = ({
  ctx,
  basePath,
  action,
  sourceEvent,
  destinationEvent,
  sourceEventName
}: EmitValidationOptions): void => {
  const sourceSchema = sourceEvent?.payloadSchema;
  const destinationSchema = destinationEvent.payloadSchema;
  const effectiveSourceName = sourceEvent?.name ?? sourceEventName;

  const pushIssue = (message: string, path: (string | number)[]) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: [...basePath, ...path]
    });
  };

  Object.keys(action.mapping).forEach((key) => {
    if (!(key in destinationSchema)) {
      pushIssue(
        `Emit mapping for event "${action.event}" references unknown field "${key}"`,
        ['mapping', key]
      );
    }
  });

  Object.entries(destinationSchema).forEach(([fieldName, fieldSchema]) => {
    const fieldMapping = action.mapping[fieldName];

    if (fieldMapping === undefined) {
      pushIssue(
        `Emit mapping for event "${action.event}" is missing definition for field "${fieldName}"`,
        ['mapping', fieldName]
      );
      return;
    }

    if (typeof fieldSchema === 'string') {
      if (!isScalarMappingValue(fieldMapping)) {
        pushIssue(
          `Emit mapping for event "${action.event}" must define a scalar mapping for field "${fieldName}"`,
          ['mapping', fieldName]
        );
        return;
      }

      validateScalarMappingDefinition({
        mappingValue: fieldMapping,
        destinationType: fieldSchema as PayloadPrimitive,
        baseSchema: sourceSchema,
        baseDescription: `event "${effectiveSourceName}" payload`,
        path: ['mapping', fieldName],
        pushIssue,
        targetEventName: action.event
      });

      return;
    }

    if (Array.isArray(fieldSchema)) {
      if (!isArrayObjectMappingValue(fieldMapping)) {
        pushIssue(
          `Emit mapping for event "${action.event}" must define an array mapping for field "${fieldName}"`,
          ['mapping', fieldName]
        );
        return;
      }

      validateArrayMappingDefinition({
        fieldName,
        mappingValue: fieldMapping,
        destinationArraySchema: fieldSchema as PayloadArrayOfFlatObjects,
        sourceSchema,
        pushIssue,
        targetEventName: action.event,
        sourceEventName: effectiveSourceName
      });

      return;
    }

    if (!isObjectMappingValue(fieldMapping)) {
      pushIssue(
        `Emit mapping for event "${action.event}" must define an object mapping for field "${fieldName}"`,
        ['mapping', fieldName]
      );
      return;
    }

    validateObjectMappingDefinition({
      fieldName,
      mappingValue: fieldMapping,
      destinationObjectSchema: fieldSchema as PayloadFlatObject,
      sourceSchema,
      pushIssue,
      targetEventName: action.event,
      sourceEventName: effectiveSourceName
    });
  });
};

const eventSchema = z
  .object({
    name: z.string().min(1, 'Event name must be a non-empty string'),
    payloadSchema
  })
  .strict();

export type ScenarioEvent = z.infer<typeof eventSchema>;

const emitActionSchema = z
  .object({
    type: z.literal('emit'),
    event: z.string().min(1, 'Emit action requires an event name'),
    toDomain: z.string().min(1).optional(),
    mapping: emitMappingSchema
  })
  .strict();

const setStateActionSchema = z
  .object({
    type: z.literal('set-state'),
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

const domainWithDeclarationsSchema = domainSchema
  .extend({
    events: z.array(eventSchema).optional(),
    listeners: z.array(listenerSchema).optional()
  })
  .strict();

const scenarioStructureSchema = z
  .object({
    name: z.string().min(1, 'Scenario name must be a non-empty string'),
    version: z.number().int().min(0, 'Scenario version must be a positive integer'),
    domains: z
      .array(domainWithDeclarationsSchema)
      .min(1, 'Scenario must declare at least one domain')
  })
  .strict();

type ScenarioDraft = z.infer<typeof scenarioStructureSchema>;

type EventRegistryEntry = { domainId: string; event: ScenarioEvent };

const validateScenario: z.SuperRefinement<ScenarioDraft> = (scenario, ctx) => {
  const domainIds = new Set<string>();
  const eventByName = new Map<string, EventRegistryEntry>();
  const listenerIds = new Set<string>();

  scenario.domains.forEach((domain, domainIndex) => {
    if (domainIds.has(domain.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Domain id "${domain.id}" is declared more than once`,
        path: ['domains', domainIndex, 'id']
      });
    } else {
      domainIds.add(domain.id);
    }

    domain.events?.forEach((event, eventIndex) => {
      const existing = eventByName.get(event.name);

      if (existing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Event "${event.name}" is declared more than once`,
          path: ['domains', domainIndex, 'events', eventIndex, 'name']
        });
        return;
      }

      eventByName.set(event.name, { domainId: domain.id, event });
    });
  });

  if (eventByName.size === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Scenario must declare at least one event within its domains',
      path: ['domains']
    });
  }

  scenario.domains.forEach((domain, domainIndex) => {
    domain.listeners?.forEach((listener, listenerIndex) => {
      const listenerPath: (string | number)[] = [
        'domains',
        domainIndex,
        'listeners',
        listenerIndex
      ];

      if (listenerIds.has(listener.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Listener id "${listener.id}" is declared more than once`,
          path: [...listenerPath, 'id']
        });
      } else {
        listenerIds.add(listener.id);
      }

      const sourceEventEntry = eventByName.get(listener.on.event);

      if (!sourceEventEntry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Listener "${listener.id}" references unknown event "${listener.on.event}"`,
          path: [...listenerPath, 'on', 'event']
        });
      }

      listener.actions.forEach((action, actionIndex) => {
        const actionPath = [...listenerPath, 'actions', actionIndex];

        if (action.type === 'emit') {
          const destinationEntry = eventByName.get(action.event);

          if (!destinationEntry) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Action emit references unknown event "${action.event}"`,
              path: [...actionPath, 'event']
            });
            return;
          }

          if (action.toDomain && action.toDomain !== destinationEntry.domainId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Action emit references domain "${action.toDomain}" but event "${action.event}" belongs to domain "${destinationEntry.domainId}"`,
              path: [...actionPath, 'toDomain']
            });
          }

          validateEmitMappingDefinition({
            ctx,
            basePath: actionPath,
            action,
            sourceEvent: sourceEventEntry?.event,
            destinationEvent: destinationEntry.event,
            sourceEventName: listener.on.event
          });
        }
      });
    });
  });
};

export const scenarioSchema = scenarioStructureSchema.superRefine(validateScenario);

export type Scenario = z.infer<typeof scenarioSchema>;

export function normalizeScenario(raw: unknown): Scenario {
  return scenarioSchema.parse(raw);
}
