import { getSchemaModuleRef, type SchemaModule } from '@tarskia/diagram-semantics';
import type { SchemaVersionCatalogEntry } from '../model/validation/schema-closure';
import { parseTrustedBundledSchemaModule } from './trusted-bundled-assets';

/** Bundled schemas are validated in Vitest and parsed once at the viewer boundary. */
export interface SemanticBootstrap {
  schemaModules: SchemaModule[];
  builtInSchemaCatalogEntries: SchemaVersionCatalogEntry[];
}

const bundledSchemaRawModules = import.meta.glob('../schemas/*.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const builtInSchemaFixtures = Object.entries(bundledSchemaRawModules)
  .map(([filePath, raw]) => {
    const module = parseTrustedBundledSchemaModule(raw);
    return {
      filePath,
      raw,
      module,
      schemaId: getSchemaModuleRef(module),
    };
  })
  .sort((left, right) => left.schemaId.localeCompare(right.schemaId));

const schemaModules = builtInSchemaFixtures.map(({ module }) => module);

const builtInSchemaCatalogEntries = builtInSchemaFixtures.map(({ raw, module, schemaId }) => ({
  schemaId,
  version: module.version,
  raw,
  module,
}));

export const semanticBootstrap: SemanticBootstrap = {
  schemaModules,
  builtInSchemaCatalogEntries,
};
