import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { type Diagnostic, schemaDiagnostic } from '../model/diagnostics';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});

const validatorCache = new WeakMap<object, ValidateFunction>();

const toDotPath = (instancePath: string) => {
  if (!instancePath) return '$';
  const segments = instancePath.split('/').filter((segment) => segment.length > 0);
  let out = '$';
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      out += `[${segment}]`;
      continue;
    }
    out += `.${segment}`;
  }
  return out;
};

const withProperty = (basePath: string, propertyName: unknown) => {
  if (typeof propertyName !== 'string' || propertyName.length === 0) return basePath;
  if (/^\d+$/.test(propertyName)) return `${basePath}[${propertyName}]`;
  return `${basePath}.${propertyName}`;
};

const formatErrorMessage = (error: ErrorObject): string => {
  const basePath = toDotPath(error.instancePath ?? '');
  switch (error.keyword) {
    case 'additionalProperties':
      return `${withProperty(basePath, error.params.additionalProperty)}: is not allowed`;
    case 'required':
      return `${withProperty(basePath, error.params.missingProperty)}: is required`;
    case 'minimum':
      return `${basePath}: expected >= ${error.params.limit}`;
    case 'exclusiveMinimum':
      return `${basePath}: expected > ${error.params.limit}`;
    case 'maximum':
      return `${basePath}: expected <= ${error.params.limit}`;
    case 'exclusiveMaximum':
      return `${basePath}: expected < ${error.params.limit}`;
    case 'type':
      return `${basePath}: expected ${error.params.type}`;
    case 'enum':
      return `${basePath}: expected one of ${JSON.stringify(error.params.allowedValues)}`;
    case 'pattern':
      return `${basePath}: expected to match pattern ${error.params.pattern}`;
    case 'minLength':
      return `${basePath}: expected length >= ${error.params.limit}`;
    case 'maxLength':
      return `${basePath}: expected length <= ${error.params.limit}`;
    case 'minItems':
      return `${basePath}: expected at least ${error.params.limit} item(s)`;
    case 'maxItems':
      return `${basePath}: expected at most ${error.params.limit} item(s)`;
    case 'uniqueItems':
      return `${basePath}: expected unique items`;
    case 'minProperties':
      return `${basePath}: expected at least ${error.params.limit} propert${error.params.limit === 1 ? 'y' : 'ies'}`;
    default:
      return `${basePath}: ${error.message ?? `failed ${error.keyword}`}`;
  }
};

const getValidator = (schema: object) => {
  const cached = validatorCache.get(schema);
  if (cached) return cached;
  const schemaId =
    '$id' in schema && typeof schema.$id === 'string' && schema.$id.trim().length > 0
      ? schema.$id
      : undefined;
  if (schemaId) {
    const existing = ajv.getSchema(schemaId);
    if (existing) {
      validatorCache.set(schema, existing);
      return existing;
    }
  }
  const validate = ajv.compile(schema);
  validatorCache.set(schema, validate);
  return validate;
};

export function validateWithSchema(value: unknown, schema: object): Diagnostic[] {
  const validate = getValidator(schema);
  const valid = validate(value);
  if (valid) return [];
  return (validate.errors ?? []).map((error) =>
    schemaDiagnostic({
      phase: 'shape',
      severity: 'error',
      code: `schema.shape.${error.keyword}`,
      message: formatErrorMessage(error),
      path: toDotPath(error.instancePath ?? ''),
      source: {
        keyword: error.keyword,
        schemaPath: error.schemaPath,
        instancePath: error.instancePath,
      },
    }),
  );
}
