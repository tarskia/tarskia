import { dump } from 'js-yaml';

import {
  buildSchemaId,
  getSchemaDisplayName,
  parseSchemaRef,
  type SchemaModule,
  type SchemaVersionCatalog,
} from '../semantic';
import {
  extractPinnedDependencyVersions,
  parseEditorSchemaDraftRecord,
} from './schema-editor-draft';

export type SchemaDependencySectionKey = 'tags' | 'traits' | 'types' | 'relations';

export interface SchemaDependencyObjectReference {
  section: SchemaDependencySectionKey;
  id: string;
  label: string;
  selectorPath: string;
  previewText: string;
}

export interface SchemaDependencyReference {
  schemaRef: string;
  schemaLabel: string;
  version: string;
  alias?: string;
  objects: SchemaDependencyObjectReference[];
}

const DUMP_OPTIONS = {
  noRefs: true,
  lineWidth: 100,
  quotingType: '"' as const,
};

const dumpObjectPreview = (section: SchemaDependencySectionKey, value: unknown) =>
  dump({ [section]: [value] }, DUMP_OPTIONS).trimEnd();

const resolveDraftImportSchemaId = (
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

const getSectionObjects = (
  module: SchemaModule,
  section: SchemaDependencySectionKey,
  alias: string | undefined,
) => {
  const items = module[section] ?? [];
  return items.map((item) => {
    const id = item.id;
    return {
      section,
      id,
      label: item.label ?? id,
      selectorPath: alias ? `${alias}.${section}.${id}` : `${section}.${id}`,
      previewText: dumpObjectPreview(section, item),
    };
  });
};

export const buildSchemaDependencyReferences = (params: {
  draftText: string;
  previousRaw?: string;
  fallbackVersionsBySchemaId?: Map<string, string>;
  versionCatalog: SchemaVersionCatalog;
}): SchemaDependencyReference[] => {
  const { draftText, previousRaw = '', fallbackVersionsBySchemaId, versionCatalog } = params;
  const draftRecord = parseEditorSchemaDraftRecord(draftText);
  if (!draftRecord || !Array.isArray(draftRecord.use)) {
    return [];
  }

  const previousPins = extractPinnedDependencyVersions(previousRaw);

  return draftRecord.use
    .flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        Array.isArray(entry) ||
        typeof entry.schema !== 'string'
      ) {
        return [];
      }
      const schemaRef = resolveDraftImportSchemaId(
        entry.schema,
        previousPins,
        fallbackVersionsBySchemaId,
      );
      const parsedRef = parseSchemaRef(schemaRef);
      const version =
        parsedRef.version ??
        previousPins.get(schemaRef) ??
        fallbackVersionsBySchemaId?.get(schemaRef);
      if (!version) return [];
      const catalogEntry = versionCatalog.entriesByRef.get(`${schemaRef}@${version}`);
      if (!catalogEntry) return [];
      const alias =
        typeof entry.alias === 'string' && entry.alias.trim().length > 0
          ? entry.alias.trim()
          : undefined;
      return [
        {
          schemaRef,
          schemaLabel: getSchemaDisplayName(schemaRef),
          version,
          alias,
          objects: (['tags', 'traits', 'types', 'relations'] as const).flatMap((section) =>
            getSectionObjects(catalogEntry.module, section, alias),
          ),
        },
      ];
    })
    .sort((left, right) => left.schemaLabel.localeCompare(right.schemaLabel));
};
