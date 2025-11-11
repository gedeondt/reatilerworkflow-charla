import { isDeepStrictEqual } from 'node:util';

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
  listenerIndex: number;
  actionIndex: number;
  action: Extract<ListenerAction, { type: 'emit' }>;
  sourceEvent: ScenarioEvent | undefined;
  destinationEvent: ScenarioEvent;
};

const validateEmitMappingDefinition = ({
  ctx,
  listenerIndex,
  actionIndex,
  action,
  sourceEvent,
  destinationEvent
}: EmitValidationOptions): void => {
  const sourceSchema = sourceEvent?.payloadSchema;
  const destinationSchema = destinationEvent.payloadSchema;
  const basePath: (string | number)[] = ['listeners', listenerIndex, 'actions', actionIndex];
  const sourceEventName = sourceEvent?.name ?? action.event;

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
        baseDescription: `event "${sourceEventName}" payload`,
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
        sourceEventName
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
      sourceEventName
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
    toDomain: z.string().min(1, 'Emit action requires a target domain'),
    mapping: emitMappingSchema
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

const scenarioBaseSchema = z
  .object({
    name: z.string().min(1, 'Scenario name must be a non-empty string'),
    version: z.number().int().min(0, 'Scenario version must be a positive integer'),
    domains: z.array(domainSchema).min(1, 'Scenario must declare at least one domain'),
    events: z.array(eventSchema).min(1, 'Scenario must declare at least one event'),
    listeners: z.array(listenerSchema)
  })
  .strict();

type ScenarioDraft = z.infer<typeof scenarioBaseSchema>;

const validateScenario: z.SuperRefinement<ScenarioDraft> = (scenario, ctx) => {
  const domainIds = new Set<string>();

  scenario.domains.forEach((domain, index) => {
    if (domainIds.has(domain.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Domain id "${domain.id}" is declared more than once`,
        path: ['domains', index, 'id']
      });
      return;
    }

    domainIds.add(domain.id);
  });

  const domainById = new Map<string, Domain>(scenario.domains.map((domain) => [domain.id, domain]));

  const eventNames = new Set<string>();
  const eventByName = new Map<string, ScenarioEvent>();

  scenario.events.forEach((event, index) => {
    if (eventNames.has(event.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Event "${event.name}" is declared more than once`,
        path: ['events', index, 'name']
      });
      return;
    }

    eventNames.add(event.name);
    eventByName.set(event.name, event);
  });

  const listenerIds = new Set<string>();

  scenario.listeners.forEach((listener, index) => {
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

        const destinationEvent = eventByName.get(action.event);

        if (destinationEvent) {
          const sourceEvent = eventByName.get(listener.on.event);

          validateEmitMappingDefinition({
            ctx,
            listenerIndex: index,
            actionIndex,
            action,
            sourceEvent,
            destinationEvent
          });
        }
      }
    });
  });
};

export const scenarioSchema = scenarioBaseSchema.superRefine(validateScenario);

export type Scenario = z.infer<typeof scenarioSchema>;

const nestedDomainSchema = domainSchema
  .extend({
    events: z.array(eventSchema).optional(),
    listeners: z.array(listenerSchema).optional()
  })
  .strict();

export type NestedDomain = z.infer<typeof nestedDomainSchema>;

const rawScenarioSchema = z
  .object({
    name: z.string().min(1, 'Scenario name must be a non-empty string'),
    version: z.number().int().min(0, 'Scenario version must be a positive integer'),
    domains: z.array(nestedDomainSchema).min(1, 'Scenario must declare at least one domain'),
    events: z.array(eventSchema).optional(),
    listeners: z.array(listenerSchema).optional()
  })
  .strict();

const createIssue = (message: string, path: (string | number)[]): z.ZodIssue => ({
  code: z.ZodIssueCode.custom,
  message,
  path
});

const formatEventConflictMessage = (eventName: string): string =>
  `Event "${eventName}" is declared more than once with different definitions`;

const addTopLevelEvent = (
  events: ScenarioEvent[],
  eventByName: Map<string, ScenarioEvent>,
  issues: z.ZodIssue[],
  event: ScenarioEvent,
  path: (string | number)[],
) => {
  if (eventByName.has(event.name)) {
    issues.push(createIssue(`Event "${event.name}" is declared more than once`, path));
    return;
  }

  events.push(event);
  eventByName.set(event.name, event);
};

const addNestedEvent = (
  events: ScenarioEvent[],
  eventByName: Map<string, ScenarioEvent>,
  issues: z.ZodIssue[],
  event: ScenarioEvent,
  path: (string | number)[],
) => {
  const existing = eventByName.get(event.name);

  if (!existing) {
    events.push(event);
    eventByName.set(event.name, event);
    return;
  }

  if (!isDeepStrictEqual(existing, event)) {
    issues.push(createIssue(formatEventConflictMessage(event.name), path));
  }
};

const addTopLevelListener = (
  listeners: Listener[],
  listenerById: Map<string, Listener>,
  issues: z.ZodIssue[],
  listener: Listener,
  path: (string | number)[],
) => {
  if (listenerById.has(listener.id)) {
    issues.push(createIssue(`Listener id "${listener.id}" is declared more than once`, path));
    return;
  }

  listeners.push(listener);
  listenerById.set(listener.id, listener);
};

const addNestedListener = (
  listeners: Listener[],
  listenerById: Map<string, Listener>,
  issues: z.ZodIssue[],
  listener: Listener,
  path: (string | number)[],
) => {
  if (listenerById.has(listener.id)) {
    issues.push(
      createIssue(`Listener id "${listener.id}" is declared more than once`, path),
    );
    return;
  }

  listeners.push(listener);
  listenerById.set(listener.id, listener);
};

export type NormalizedScenario = Scenario;

export const normalizeScenario = (raw: unknown): NormalizedScenario => {
  const parsed = rawScenarioSchema.safeParse(raw);

  if (!parsed.success) {
    throw parsed.error;
  }

  const scenario = parsed.data;
  const issues: z.ZodIssue[] = [];

  const domains = scenario.domains.map(({ id, queue }) => ({ id, queue }));

  const events: ScenarioEvent[] = [];
  const eventByName = new Map<string, ScenarioEvent>();

  (scenario.events ?? []).forEach((event, index) => {
    addTopLevelEvent(events, eventByName, issues, event, ['events', index, 'name']);
  });

  scenario.domains.forEach((domain, domainIndex) => {
    domain.events?.forEach((event, eventIndex) => {
      addNestedEvent(
        events,
        eventByName,
        issues,
        event,
        ['domains', domainIndex, 'events', eventIndex, 'name'],
      );
    });
  });

  const listeners: Listener[] = [];
  const listenerById = new Map<string, Listener>();

  (scenario.listeners ?? []).forEach((listener, index) => {
    addTopLevelListener(listeners, listenerById, issues, listener, [
      'listeners',
      index,
      'id',
    ]);
  });

  scenario.domains.forEach((domain, domainIndex) => {
    domain.listeners?.forEach((listener, listenerIndex) => {
      addNestedListener(
        listeners,
        listenerById,
        issues,
        listener,
        ['domains', domainIndex, 'listeners', listenerIndex, 'id'],
      );
    });
  });

  if (issues.length > 0) {
    throw new z.ZodError(issues);
  }

  return scenarioSchema.parse({
    name: scenario.name,
    version: scenario.version,
    domains,
    events,
    listeners
  });
};
