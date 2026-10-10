import {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalog,
  getSchemaModuleRef,
  parseAndValidateSchemaModule,
  type SchemaVersionCatalogEntry,
} from '@tarskia/diagram-semantics';
import { load } from 'js-yaml';
import { semanticBootstrap } from '../semantic/bootstrap';
import { loadDiagramDocFromRaw } from '../viewer-core/loadDiagramDocFromRaw';

export interface LocalDiagram {
  raw: string;
  title: string;
  filename: string;
  schemaEntries: SchemaVersionCatalogEntry[];
}
export const LOCAL_FILE_LIMIT = 50 * 1024 * 1024;
export async function openLocalDiagram(
  files: readonly Pick<File, 'name' | 'size' | 'text'>[],
): Promise<LocalDiagram> {
  for (const file of files) {
    if (file.size > LOCAL_FILE_LIMIT) throw new Error(`${file.name} is larger than 50 MB.`);
  }
  const diagrams: { raw: string; filename: string }[] = [];
  const schemaEntries: SchemaVersionCatalogEntry[] = [];
  for (const file of files) {
    let raw: string;
    let root: unknown;
    try {
      raw = await file.text();
      root = load(raw);
    } catch {
      throw new Error(`${file.name} couldn't be read as a Tarskia diagram.`);
    }
    if (
      root &&
      typeof root === 'object' &&
      'owner' in root &&
      'name' in root &&
      'version' in root
    ) {
      const result = parseAndValidateSchemaModule(raw);
      if (!result.ok)
        throw new Error(
          `${file.name} isn't a valid schema: ${result.diagnostics[0]?.message ?? 'Invalid schema'}`,
        );
      const module = result.value;
      const schemaId = getSchemaModuleRef(module);
      if (module.owner !== 'repo' && module.owner !== 'user')
        throw new Error(`${file.name} can't replace the built-in schema ${schemaId}.`);
      schemaEntries.push({ schemaId, version: module.version, raw, module });
    } else diagrams.push({ raw, filename: file.name });
  }
  if (diagrams.length === 0) throw new Error('None of these files is a Tarskia diagram.');
  if (diagrams.length > 1)
    throw new Error('Open one diagram at a time. You can add its schema files with it.');
  const { raw, filename } = diagrams[0];
  const loaded = loadDiagramDocFromRaw({
    raw,
    streamName: filename.replace(/\.ya?ml$/i, ''),
    sourceLabel: filename,
  });
  if (!loaded.readable) throw new Error(`${filename} couldn't be read as a Tarskia diagram.`);
  const catalog = buildSchemaVersionCatalog([
    ...semanticBootstrap.builtInSchemaCatalogEntries,
    ...schemaEntries,
  ]);
  const resolved = buildSchemaRuntimeFromCatalog({ catalog, activations: loaded.doc.schemaRefs });
  const missingDependencies = resolved.diagnostics.filter(
    (d) => d.code === 'schema.resolution.missing_dependency',
  );
  // The runtime also emits an unversioned diagnostic; prefer the closure's pinned reference.
  const missing =
    missingDependencies.find((d) => d.message.includes('@')) ?? missingDependencies[0];
  if (missing) {
    const ref = missing.message.replace('Missing schema dependency: ', '');
    throw new Error(
      `This diagram needs the schema ${ref}. Open the diagram together with its schema file, which tarskia build writes to the --schema-out path.`,
    );
  }
  return {
    raw,
    filename,
    title: loaded.doc.metadata?.name ?? filename.replace(/\.ya?ml$/i, ''),
    schemaEntries,
  };
}
