import { dump, JSON_SCHEMA, load } from 'js-yaml';

import {
  buildSchemaId,
  buildSchemaRef,
  getSchemaDisplayName,
  parseSchemaRef,
  type SchemaIdentity,
  type SchemaImport,
} from '../semantic';

const EDITOR_DUMP_OPTIONS = {
  noRefs: true,
  lineWidth: 100,
  quotingType: '"' as const,
};

const EDITOR_SECTION_KEYS = ['use', 'tags', 'traits', 'types', 'relations', 'update', 'remove'];
export type EditorSchemaDraftRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseYamlRecord = (raw: string): EditorSchemaDraftRecord | undefined => {
  try {
    const parsed = load(raw, { schema: JSON_SCHEMA });
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const dumpYaml = (value: Record<string, unknown>) => dump(value, EDITOR_DUMP_OPTIONS).trimEnd();

const normalizeEditorRecord = (record: EditorSchemaDraftRecord): EditorSchemaDraftRecord => {
  const normalized: EditorSchemaDraftRecord = {};

  for (const key of EDITOR_SECTION_KEYS) {
    if (!(key in record)) continue;
    normalized[key] = record[key];
  }

  for (const [key, value] of Object.entries(record)) {
    if (key in normalized || EDITOR_SECTION_KEYS.includes(key)) continue;
    normalized[key] = value;
  }

  return normalized;
};

export const parseEditorSchemaDraftRecord = (raw: string): EditorSchemaDraftRecord | undefined =>
  parseYamlRecord(raw);

export const serializeEditorSchemaDraftRecord = (record: EditorSchemaDraftRecord) =>
  dumpYaml(normalizeEditorRecord(record));

const normalizeImportForEditor = (entry: unknown): SchemaImport | undefined => {
  if (!isRecord(entry) || typeof entry.schema !== 'string') return undefined;
  const parsed = parseSchemaRef(entry.schema);
  return {
    schema: getSchemaDisplayName(parsed),
    alias:
      typeof entry.alias === 'string' && entry.alias.trim().length > 0 ? entry.alias : undefined,
  };
};

export const extractPinnedDependencyVersions = (raw: string) => {
  const pins = new Map<string, string>();
  const matches = raw.matchAll(
    /schema:\s*((?:core|gallery|user)\/[a-z0-9-]+)@([0-9][0-9A-Za-z.\-_]*)/g,
  );
  for (const match of matches) {
    const schemaId = match[1]?.trim();
    const version = match[2]?.trim();
    if (!schemaId || !version) continue;
    pins.set(schemaId, version);
  }
  return pins;
};

export const toEditorSchemaDraftText = (raw: string) => {
  const parsed = parseYamlRecord(raw);
  if (parsed) {
    const editorRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'id' || key === 'owner' || key === 'name' || key === 'version') continue;
      if (key === 'use' && Array.isArray(value)) {
        editorRecord.use = value
          .map((entry) => normalizeImportForEditor(entry))
          .filter((entry): entry is SchemaImport => Boolean(entry));
        continue;
      }
      editorRecord[key] = value;
    }
    return serializeEditorSchemaDraftRecord(editorRecord);
  }

  return raw
    .replace(/^owner:\s*[^\n]*\n?/m, '')
    .replace(/^name:\s*[^\n]*\n?/m, '')
    .replace(/^version:\s*[^\n]*\n?/m, '')
    .trim();
};

const normalizeEditorImport = (entry: unknown): SchemaImport | undefined => {
  if (!isRecord(entry) || typeof entry.schema !== 'string') return undefined;
  const rawSchema = entry.schema.trim();
  if (rawSchema.length === 0) return undefined;
  return {
    schema: rawSchema,
    alias:
      typeof entry.alias === 'string' && entry.alias.trim().length > 0 ? entry.alias : undefined,
  };
};

const resolveEditorImportSchemaId = (
  rawSchema: string,
  previousPins: Map<string, string>,
  fallbackVersionsBySchemaId?: Map<string, string>,
) => {
  if (rawSchema.includes('/')) {
    return buildSchemaId(parseSchemaRef(rawSchema));
  }

  const matches = [
    ...new Set([...previousPins.keys(), ...(fallbackVersionsBySchemaId?.keys() ?? [])]),
  ]
    .filter((schemaRef) => getSchemaDisplayName(parseSchemaRef(schemaRef)) === rawSchema)
    .sort((left, right) => left.localeCompare(right));

  if (matches.length > 0) {
    const coreMatch = matches.find((schemaRef) => parseSchemaRef(schemaRef).owner === 'core');
    if (coreMatch) return coreMatch;
    const firstMatch = matches[0];
    if (firstMatch) return firstMatch;
  }

  return buildSchemaId({ owner: 'user', name: rawSchema });
};

export const buildSchemaDraftFromEditorText = (params: {
  editorText: string;
  identity: SchemaIdentity;
  version: string;
  previousRaw?: string;
  fallbackVersionsBySchemaId?: Map<string, string>;
}) => {
  const { editorText, identity, version, previousRaw = '', fallbackVersionsBySchemaId } = params;
  const parsed = parseYamlRecord(editorText);
  if (!parsed) {
    return `owner: ${identity.owner}\nname: ${identity.name}\nversion: "${version}"\n\n${editorText}`.trimEnd();
  }

  const previousPins = extractPinnedDependencyVersions(previousRaw);
  const nextRecord: Record<string, unknown> = {
    owner: identity.owner,
    name: identity.name,
    version,
  };

  for (const key of EDITOR_SECTION_KEYS) {
    if (!(key in parsed)) continue;
    if (key === 'use') {
      const imports = Array.isArray(parsed.use)
        ? parsed.use
            .map((entry) => normalizeEditorImport(entry))
            .filter((entry): entry is SchemaImport => Boolean(entry))
            .map((entry) => {
              const normalizedSchemaId = resolveEditorImportSchemaId(
                entry.schema,
                previousPins,
                fallbackVersionsBySchemaId,
              );
              const parsedRef = parseSchemaRef(normalizedSchemaId);
              const resolvedVersion =
                parsedRef.version ??
                previousPins.get(normalizedSchemaId) ??
                fallbackVersionsBySchemaId?.get(normalizedSchemaId);
              return {
                schema: buildSchemaRef(parsedRef, resolvedVersion),
                ...(entry.alias ? { alias: entry.alias } : {}),
              };
            })
        : [];
      nextRecord.use = imports;
      continue;
    }
    nextRecord[key] = parsed[key];
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (
      key in nextRecord ||
      key === 'id' ||
      key === 'owner' ||
      key === 'name' ||
      key === 'version'
    ) {
      continue;
    }
    nextRecord[key] = value;
  }

  return dumpYaml(nextRecord);
};

export const buildDefaultEditorSchemaDraftText = (schemaRefs?: string[]) => {
  const refs = schemaRefs ?? [];
  const usedAliases = new Set<string>();
  const buildSuggestedAlias = (schemaRef: string) => {
    const schemaName = getSchemaDisplayName(parseSchemaRef(schemaRef));
    const parts = schemaName
      .split('-')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0);
    const base = parts[0] ?? 'schema';
    let alias = base;
    let suffix = 2;
    while (usedAliases.has(alias)) {
      alias = `${base}${suffix}`;
      suffix += 1;
    }
    usedAliases.add(alias);
    return alias;
  };

  const editorRecord: Record<string, unknown> = {
    use:
      refs.length > 0
        ? refs.map((ref) => ({
            schema: getSchemaDisplayName(parseSchemaRef(ref)),
            alias: buildSuggestedAlias(ref),
          }))
        : [],
    tags: [],
    traits: [],
    types: [],
    relations: [],
    update: {},
    remove: {},
  };
  return serializeEditorSchemaDraftRecord(editorRecord);
};

export const loadStoredEditorSchemaDraftText = (stored: string | null, fallbackRaw: string) => {
  const fallback = toEditorSchemaDraftText(fallbackRaw);
  if (typeof stored !== 'string') return fallback;
  const trimmed = stored.trim();
  if (trimmed.length === 0 || trimmed === 'undefined' || trimmed === 'null') {
    return fallback;
  }
  return stored;
};
