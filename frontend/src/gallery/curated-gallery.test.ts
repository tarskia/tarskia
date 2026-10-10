import { readFileSync } from 'node:fs';
import { getSchemaActivationId, parseDocument } from '@tarskia/diagram-semantics';
import { expect, test } from 'vitest';
import { buildSchemaVersionCatalog } from '../model/validation/schema-closure';
import { semanticBootstrap } from '../semantic/bootstrap';
import { buildDiagramSemanticRuntime } from '../semantic/runtime';
import { loadDiagramDocFromRaw } from '../viewer-core/loadDiagramDocFromRaw';

const curatedDirectory = new URL('../../../gallery/curated/', import.meta.url);
const manifest: { file: string; title: string }[] = JSON.parse(
  readFileSync(new URL('manifest.json', curatedDirectory), 'utf8'),
);
const schemaVersionCatalog = buildSchemaVersionCatalog(
  semanticBootstrap.builtInSchemaCatalogEntries,
);

test.each(manifest)('$file has no error diagnostics', ({ file, title }) => {
  const raw = readFileSync(new URL(file, curatedDirectory), 'utf8');
  const ids = parseDocument(raw).schemaRefs.map(getSchemaActivationId);
  expect(new Set(ids).size).toBe(ids.length);
  const loaded = loadDiagramDocFromRaw({
    raw,
    streamName: title,
    sourceLabel: file,
  });
  const runtime = buildDiagramSemanticRuntime({
    ...loaded,
    schemaVersionCatalog,
    fallbackSchema: semanticBootstrap.schemaModules[0],
  });
  const errors = runtime.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  expect(errors.map(({ code, message }) => `${code}: ${message}`)).toEqual([]);
});
