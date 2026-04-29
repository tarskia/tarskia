import { starterDiagramRaw } from './bundled-diagrams';
import {
  buildRawSchemaSet,
  buildSchemaRuntimeFromCatalog,
  diagnosticsToMessages,
  getSchemaDisplayName,
  getSchemaModuleRef,
  type SchemaActivation,
  type SchemaModule,
  type SchemaVersionCatalog,
  type SchemaVersionCatalogEntry,
  type SemanticDocument,
} from './index';
import {
  parseTrustedBundledDocument,
  parseTrustedBundledSchemaModule,
} from './trusted-bundled-assets';

/**
 * This is the runtime boundary that imports bundled starter/schema raw assets.
 * Other layers consume the prepared bootstrap object instead of importing `?raw` assets directly.
 * Bundled assets are validated in Vitest; boot treats them as trusted and only parses them here.
 */
export interface BuiltInSchemaOption {
  id: string;
  label: string;
  version?: string;
  owner: 'core' | 'gallery';
}

export interface BundledStarter {
  id: string;
  label: string;
  raw: string;
  document: SemanticDocument;
  schemaActivations: SchemaActivation[];
}

export interface SemanticBootstrap {
  primaryStarter: BundledStarter;
  bundledStarters: BundledStarter[];
  schemaModules: SchemaModule[];
  builtInSchemaCatalogEntries: SchemaVersionCatalogEntry[];
  builtInRawSchemaSet: ReturnType<typeof buildRawSchemaSet>;
  builtInSchemaOptions: BuiltInSchemaOption[];
  resolveActivatedSchemaRuntime: (
    schemaVersionCatalog: SchemaVersionCatalog,
    activations?: SchemaActivation[],
  ) => ReturnType<typeof buildSchemaRuntimeFromCatalog>;
  resolveActivatedSchema: (
    schemaVersionCatalog: SchemaVersionCatalog,
    activations?: SchemaActivation[],
  ) => SchemaModule;
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

const builtInRawSchemaSet = buildRawSchemaSet(schemaModules);

const builtInSchemaOptions: BuiltInSchemaOption[] = builtInRawSchemaSet.moduleIds.map(
  (moduleId) => {
    const module = builtInRawSchemaSet.modulesById.get(moduleId);
    return {
      id: moduleId,
      label: module
        ? getSchemaDisplayName(getSchemaModuleRef(module))
        : getSchemaDisplayName(moduleId),
      version: module?.version,
      owner: module?.owner === 'gallery' ? 'gallery' : 'core',
    };
  },
);

const resolveActivatedSchemaRuntime = (
  schemaVersionCatalog: SchemaVersionCatalog,
  activations?: SchemaActivation[],
) => {
  const runtime = buildSchemaRuntimeFromCatalog({
    catalog: schemaVersionCatalog,
    activations,
  });
  if (runtime.diagnostics.length > 0) {
    console.warn(
      `Schema resolution diagnostics:\n${diagnosticsToMessages(runtime.diagnostics).join('\n')}`,
    );
  }
  return runtime;
};

const resolveActivatedSchema = (
  schemaVersionCatalog: SchemaVersionCatalog,
  activations?: SchemaActivation[],
) =>
  resolveActivatedSchemaRuntime(schemaVersionCatalog, activations).runtime.resolved.effectiveSchema;

const bundledStarterFixtures = [
  { id: 'starter', title: 'Starter Diagram', raw: starterDiagramRaw },
] as const;

const bundledStarters: BundledStarter[] = bundledStarterFixtures.map(({ id, title, raw }) => {
  const document = parseTrustedBundledDocument(raw);
  return {
    id,
    label: document.metadata?.name?.trim() || title,
    raw,
    document,
    schemaActivations: [...document.schemaRefs],
  };
});

const primaryStarter = bundledStarters[0];

if (!primaryStarter) {
  throw new Error('Expected at least one bundled starter diagram');
}

export const semanticBootstrap: SemanticBootstrap = {
  primaryStarter,
  bundledStarters,
  schemaModules,
  builtInSchemaCatalogEntries,
  builtInRawSchemaSet,
  builtInSchemaOptions,
  resolveActivatedSchemaRuntime,
  resolveActivatedSchema,
};
