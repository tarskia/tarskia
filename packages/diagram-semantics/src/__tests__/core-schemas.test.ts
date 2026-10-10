import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalog,
  getSchemaModuleRef,
  parseAndValidateSchemaModule,
  parseDocument,
  validateDiagramDoc,
} from '../index';

const folder = new URL('../../core-schemas/', import.meta.url);
const entries = readdirSync(folder)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => {
    const raw = readFileSync(new URL(name, folder), 'utf8');
    const parsed = parseAndValidateSchemaModule(raw);
    if (!parsed.ok)
      throw new Error(`Invalid canonical schema ${name}: ${JSON.stringify(parsed.diagnostics)}`);
    return {
      schemaId: getSchemaModuleRef(parsed.value),
      version: parsed.value.version,
      raw,
      module: parsed.value,
    };
  });
describe('canonical core schemas', () => {
  it('merges both worker group types and viewer external API properties in one validated catalog', () => {
    expect(entries).toHaveLength(8);
    const doc = parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/frontend@0.3
    layer: 0
  - schema: core/kubernetes@0.3
    layer: 0
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: frontend-group
    type: core/frontend.types.group
    name: Frontend group
  - id: kubernetes-group
    type: core/kubernetes.types.group
    name: Kubernetes group
  - id: external-api
    type: core/web-app.types.external-api
    name: Named external API
    props:
      specificity: named-provider
relations: []
`);
    const resolved = buildSchemaRuntimeFromCatalog({
      catalog: buildSchemaVersionCatalog(entries),
      activations: doc.schemaRefs,
    });
    expect(resolved.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      validateDiagramDoc(doc, resolved.runtime.resolved.effectiveSchema).diagnostics.filter(
        (d) => d.severity === 'error',
      ),
    ).toEqual([]);
  });
});
