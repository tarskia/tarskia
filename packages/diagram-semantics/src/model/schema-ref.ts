import type { SchemaActivation, SchemaModule, SchemaOwner } from './types';

export interface SchemaIdentity {
  owner: SchemaOwner;
  name: string;
}

export interface SchemaRefParts extends SchemaIdentity {
  version?: string;
}

const SCHEMA_REF_PATTERN = /^(core|gallery|user)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:@(.+))?$/;

export const isSchemaOwner = (value: string): value is SchemaOwner =>
  value === 'core' || value === 'gallery' || value === 'user';

export const isSchemaNameSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const buildSchemaId = (identity: SchemaIdentity) => `${identity.owner}/${identity.name}`;

export const buildSchemaRef = (identity: SchemaIdentity, version?: string) =>
  version ? `${buildSchemaId(identity)}@${version}` : buildSchemaId(identity);

export const parseSchemaRef = (value: string): SchemaRefParts => {
  const trimmed = value.trim();
  const match = SCHEMA_REF_PATTERN.exec(trimmed);
  if (match) {
    const [, owner, name, version] = match;
    return {
      owner: (owner ?? 'user') as SchemaOwner,
      name: name ?? 'schema',
      version: version?.trim() || undefined,
    };
  }

  const at = trimmed.lastIndexOf('@');
  const unversioned = at > 0 ? trimmed.slice(0, at) : trimmed;
  const [owner, ...rest] = unversioned.split('/');
  const fallbackOwner = isSchemaOwner(owner) ? owner : 'user';
  const fallbackName = rest.join('/').trim() || (isSchemaOwner(owner) ? 'schema' : owner.trim());
  return {
    owner: fallbackOwner,
    name: fallbackName,
    version:
      at > 0 && at < trimmed.length - 1 ? trimmed.slice(at + 1).trim() || undefined : undefined,
  };
};

export const getSchemaDisplayName = (schema: SchemaIdentity | string) =>
  typeof schema === 'string' ? parseSchemaRef(schema).name : schema.name;

export const getSchemaDisplayId = (schema: SchemaIdentity | string) =>
  typeof schema === 'string' ? buildSchemaId(parseSchemaRef(schema)) : buildSchemaId(schema);

export const toDisplaySchemaRef = (ref: string) => buildSchemaId(parseSchemaRef(ref));

export const normalizeDisplaySchemaId = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  const parsed = parseSchemaRef(trimmed);
  return buildSchemaId(parsed);
};

export const getSchemaIdentity = (
  module: Pick<SchemaModule, 'owner' | 'name'>,
): SchemaIdentity => ({
  owner: module.owner,
  name: module.name,
});

export const getSchemaModuleRef = (
  module: Pick<SchemaModule, 'owner' | 'name' | 'version'>,
  includeVersion = false,
) => buildSchemaRef(getSchemaIdentity(module), includeVersion ? module.version : undefined);

export const getSchemaActivationId = (activation: SchemaActivation) =>
  buildSchemaId(parseSchemaRef(activation.schema));

export const buildSchemaActivation = (schema: string, layer = 0): SchemaActivation => ({
  schema,
  layer,
});

export const DEFAULT_SCHEMA_ACTIVATION_LAYER_BY_SCHEMA_ID: Readonly<Record<string, number>> = {
  'core/code': 1,
  'core/data-model': 1,
};

export const getDefaultSchemaActivationLayer = (schema: string) => {
  const schemaId = buildSchemaId(parseSchemaRef(schema));
  return DEFAULT_SCHEMA_ACTIVATION_LAYER_BY_SCHEMA_ID[schemaId] ?? 0;
};

export const buildDefaultSchemaActivation = (schema: string): SchemaActivation =>
  buildSchemaActivation(schema, getDefaultSchemaActivationLayer(schema));

export const getSchemaActivationKey = (activation: SchemaActivation) =>
  `${getSchemaActivationId(activation)}@${activation.layer}`;

export const serializeSchemaActivationList = (activations: SchemaActivation[]) =>
  activations.map((activation) => getSchemaActivationKey(activation)).join('\n');

export const areSchemaActivationListsEqual = (
  left: SchemaActivation[] | undefined,
  right: SchemaActivation[] | undefined,
) => serializeSchemaActivationList(left ?? []) === serializeSchemaActivationList(right ?? []);

export const buildSchemaActivationMap = (activations: SchemaActivation[]) =>
  new Map(
    activations.map((activation) => [getSchemaActivationId(activation), activation] as const),
  );
