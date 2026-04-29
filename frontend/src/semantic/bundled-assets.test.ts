import { describe, expect, it } from 'vitest';
import { semanticBootstrap } from './bootstrap';
import {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalog,
  diagnosticsToMessages,
  getSchemaModuleRef,
  parseAndValidateSchemaModule,
  parseDocument,
  validateDiagramDoc,
} from './index';

const bundledSchemaFixtures = Object.entries(
  import.meta.glob('../schemas/*.yaml', {
    eager: true,
    import: 'default',
    query: '?raw',
  }) as Record<string, string>,
).map(([filePath, raw]) => ({
  label:
    filePath
      .split('/')
      .pop()
      ?.replace(/\.yaml$/, '') ?? filePath,
  raw,
}));

const bundledSchemaEntries = bundledSchemaFixtures
  .map(({ label, raw }) => {
    const result = parseAndValidateSchemaModule(raw);
    if (!result.ok || !result.value) {
      throw new Error(
        `Expected bundled schema fixture ${label} to validate:\n${diagnosticsToMessages(result.diagnostics).join('\n')}`,
      );
    }
    return {
      schemaId: getSchemaModuleRef(result.value),
      version: result.value.version,
      raw,
      module: result.value,
    };
  })
  .sort((left, right) => left.schemaId.localeCompare(right.schemaId));

describe('bundled semantic assets', () => {
  it('fully validates every bundled schema fixture', () => {
    const schemaIds = bundledSchemaEntries.map((entry) => entry.schemaId);
    expect(schemaIds).toContain('core/base');
    expect(schemaIds).toContain('core/data-model');
    expect(schemaIds).toContain('gallery/clickhouse');
    expect(schemaIds).toEqual([...schemaIds].sort((left, right) => left.localeCompare(right)));
  });

  it('keeps bundled starter diagrams valid against the bundled schema runtime', () => {
    for (const starter of semanticBootstrap.bundledStarters) {
      const doc = parseDocument(starter.raw);
      const runtime = buildSchemaRuntimeFromCatalog({
        catalog: buildSchemaVersionCatalog(bundledSchemaEntries),
        activations: doc.schemaRefs,
      });
      const resolutionErrors = runtime.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      const documentErrors = validateDiagramDoc(
        doc,
        runtime.runtime.resolved.effectiveSchema,
      ).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

      expect(resolutionErrors).toEqual([]);
      expect(documentErrors).toEqual([]);
    }
  });
});
