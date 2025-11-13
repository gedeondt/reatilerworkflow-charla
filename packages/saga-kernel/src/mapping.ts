import type {
  ArrayObjectMapping,
  EmitMapping,
  ObjectMapping,
  PayloadPrimitive,
  PayloadSchema,
  ScalarMapping,
  ScalarValue
} from './schema.js';

export type MappingWarning = {
  message: string;
  path?: string;
};

export type ApplyEmitMappingOptions = {
  sourcePayload: Record<string, unknown>;
  destinationSchema: PayloadSchema;
  mapping: EmitMapping;
  warn?: (warning: MappingWarning) => void;
};

const primitiveTypes = new Set<PayloadPrimitive>(['string', 'number', 'boolean']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalarMapping = (value: unknown): value is ScalarMapping =>
  typeof value === 'string' ||
  (typeof value === 'object' && value !== null && ('from' in value || 'const' in value));

const isObjectMapping = (value: unknown): value is ObjectMapping =>
  typeof value === 'object' &&
  value !== null &&
  'map' in value &&
  !('arrayFrom' in value) &&
  !('from' in value) &&
  !('const' in value);

const isArrayObjectMapping = (value: unknown): value is ArrayObjectMapping =>
  typeof value === 'object' && value !== null && 'arrayFrom' in value && 'map' in value;

const normalizeScalarMapping = (
  mapping: ScalarMapping
): { kind: 'from'; field: string } | { kind: 'const'; value: ScalarValue } => {
  if (typeof mapping === 'string') {
    return { kind: 'from', field: mapping };
  }

  if ('from' in mapping) {
    return { kind: 'from', field: mapping.from };
  }

  return { kind: 'const', value: mapping.const };
};

const matchesPrimitiveType = (value: unknown, type: PayloadPrimitive): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
};

const mapScalarField = (
  base: Record<string, unknown>,
  mapping: ScalarMapping,
  destinationType: PayloadPrimitive,
  warn: (warning: MappingWarning) => void,
  path: string
): unknown => {
  const normalized = normalizeScalarMapping(mapping);

  if (normalized.kind === 'const') {
    if (!primitiveTypes.has(destinationType)) {
      warn({
        message: `Cannot assign constant to non-scalar field of type "${destinationType}"`,
        path
      });
      return undefined;
    }

    if (!matchesPrimitiveType(normalized.value, destinationType)) {
      warn({
        message: `Constant value is incompatible with type "${destinationType}"`,
        path
      });
      return undefined;
    }

    return normalized.value;
  }

  const value = base[normalized.field];

  if (value === undefined) {
    warn({
      message: `Field "${normalized.field}" is missing in source payload`,
      path
    });
    return undefined;
  }

  if (!matchesPrimitiveType(value, destinationType)) {
    warn({
      message: `Field "${normalized.field}" has incompatible type for destination "${destinationType}"`,
      path
    });
    return undefined;
  }

  return value;
};

const warnExtraMappings = (
  mappingKeys: string[],
  destinationKeys: string[],
  warn: (warning: MappingWarning) => void,
  basePath: string
): void => {
  mappingKeys
    .filter((key) => !destinationKeys.includes(key))
    .forEach((key) => {
      warn({
        message: `Mapping references unknown destination field "${key}"`,
        path: basePath ? `${basePath}.${key}` : key
      });
    });
};

const warnMissingMappings = (
  destinationKeys: string[],
  mappingKeys: string[],
  warn: (warning: MappingWarning) => void,
  basePath: string
): void => {
  destinationKeys
    .filter((key) => !mappingKeys.includes(key))
    .forEach((key) => {
      warn({
        message: `Mapping is missing definition for field "${key}"`,
        path: basePath ? `${basePath}.${key}` : key
      });
    });
};

const mapObjectField = (
  source: Record<string, unknown>,
  mapping: ObjectMapping,
  destinationSchema: Record<string, PayloadPrimitive>,
  warn: (warning: MappingWarning) => void,
  path: string
): Record<string, unknown> | undefined => {
  const base = mapping.objectFrom ? source[mapping.objectFrom] : source;

  if (mapping.objectFrom && !isRecord(base)) {
    warn({
      message: `Expected object "${mapping.objectFrom}" in source payload`,
      path
    });
    return undefined;
  }

  const baseContainer = isRecord(base) ? base : source;
  const destinationKeys = Object.keys(destinationSchema);
  const mappingKeys = Object.keys(mapping.map);

  warnMissingMappings(destinationKeys, mappingKeys, warn, path);
  warnExtraMappings(mappingKeys, destinationKeys, warn, path);

  const result: Record<string, unknown> = {};

  destinationKeys.forEach((key) => {
    const fieldMapping = mapping.map[key];

    if (!fieldMapping) {
      return;
    }

    if (!isScalarMapping(fieldMapping)) {
      warn({
        message: `Field "${key}" in object mapping must use scalar mapping`,
        path: `${path}.${key}`
      });
      return;
    }

    const value = mapScalarField(
      baseContainer,
      fieldMapping,
      destinationSchema[key],
      warn,
      `${path}.${key}`
    );

    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
};

const mapArrayField = (
  source: Record<string, unknown>,
  mapping: ArrayObjectMapping,
  elementSchema: Record<string, PayloadPrimitive>,
  warn: (warning: MappingWarning) => void,
  path: string
): Array<Record<string, unknown>> | undefined => {
  const rawArray = source[mapping.arrayFrom];

  if (!Array.isArray(rawArray)) {
    warn({
      message: `Expected array "${mapping.arrayFrom}" in source payload`,
      path
    });
    return [];
  }

  const destinationKeys = Object.keys(elementSchema);
  const mappingKeys = Object.keys(mapping.map);

  warnMissingMappings(destinationKeys, mappingKeys, warn, path);
  warnExtraMappings(mappingKeys, destinationKeys, warn, path);

  return rawArray.map((item, index) => {
    if (!isRecord(item)) {
      warn({
        message: `Array item at index ${index} is not an object`,
        path: `${path}[${index}]`
      });
      return {};
    }

    const mappedItem: Record<string, unknown> = {};

    destinationKeys.forEach((key) => {
      const fieldMapping = mapping.map[key];

      if (!fieldMapping) {
        return;
      }

      if (!isScalarMapping(fieldMapping)) {
        warn({
          message: `Field "${key}" in array mapping must use scalar mapping`,
          path: `${path}[${index}].${key}`
        });
        return;
      }

      const value = mapScalarField(
        item,
        fieldMapping,
        elementSchema[key],
        warn,
        `${path}[${index}].${key}`
      );

      if (value !== undefined) {
        mappedItem[key] = value;
      }
    });

    return mappedItem;
  });
};

export const applyEmitMapping = ({
  sourcePayload,
  destinationSchema,
  mapping,
  warn: warnHandler
}: ApplyEmitMappingOptions): Record<string, unknown> => {
  const warn = warnHandler ?? (() => {});
  const result: Record<string, unknown> = {};

  warnExtraMappings(Object.keys(mapping), Object.keys(destinationSchema), warn, '');

  Object.entries(destinationSchema).forEach(([fieldName, fieldSchema]) => {
    const fieldMapping = mapping[fieldName];

    if (fieldMapping === undefined) {
      warn({
        message: `Mapping is missing definition for field "${fieldName}"`,
        path: fieldName
      });
      return;
    }

    if (typeof fieldSchema === 'string') {
      if (!isScalarMapping(fieldMapping)) {
        warn({
          message: `Field "${fieldName}" must use scalar mapping`,
          path: fieldName
        });
        return;
      }

      const value = mapScalarField(
        sourcePayload,
        fieldMapping,
        fieldSchema,
        warn,
        fieldName
      );

      if (value !== undefined) {
        result[fieldName] = value;
      }

      return;
    }

    if (Array.isArray(fieldSchema)) {
      if (!isArrayObjectMapping(fieldMapping)) {
        warn({
          message: `Field "${fieldName}" must use array mapping`,
          path: fieldName
        });
        return;
      }

      const mapped = mapArrayField(
        sourcePayload,
        fieldMapping,
        fieldSchema[0] as Record<string, PayloadPrimitive>,
        warn,
        fieldName
      );

      if (mapped !== undefined) {
        result[fieldName] = mapped;
      }

      return;
    }

    if (!isObjectMapping(fieldMapping)) {
      warn({
        message: `Field "${fieldName}" must use object mapping`,
        path: fieldName
      });
      return;
    }

    const mappedObject = mapObjectField(
      sourcePayload,
      fieldMapping,
      fieldSchema as Record<string, PayloadPrimitive>,
      warn,
      fieldName
    );

    if (mappedObject !== undefined) {
      result[fieldName] = mappedObject;
    }
  });

  return result;
};
