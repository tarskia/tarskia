import { describe, expect, it } from 'vitest';
import { semanticBootstrap } from './bootstrap';
import { starterDiagramRaw } from './bundled-diagrams';
import { getSchemaModuleRef, parseDocument } from './index';
import { parseTrustedBundledSchemaModule } from './trusted-bundled-assets';

const bundledSchemaRaws = Object.values(
  import.meta.glob('../schemas/*.yaml', {
    eager: true,
    import: 'default',
    query: '?raw',
  }) as Record<string, string>,
);

describe('semanticBootstrap', () => {
  it('reproduces the privileged starter contract', () => {
    expect(semanticBootstrap.primaryStarter).toEqual({
      id: 'starter',
      label: 'Starter Diagram',
      raw: starterDiagramRaw,
      document: parseDocument(starterDiagramRaw),
      schemaActivations: parseDocument(starterDiagramRaw).schemaRefs,
    });
  });

  it('reproduces the built-in schema catalog, raw set, and options', () => {
    const expectedModuleRefs = bundledSchemaRaws
      .map((raw) => getSchemaModuleRef(parseTrustedBundledSchemaModule(raw)))
      .sort((left, right) => left.localeCompare(right));

    expect(semanticBootstrap.builtInSchemaCatalogEntries.map((entry) => entry.schemaId)).toEqual(
      expectedModuleRefs,
    );
    expect(semanticBootstrap.builtInRawSchemaSet.moduleIds).toEqual(expectedModuleRefs);
    expect(semanticBootstrap.builtInSchemaOptions.map((option) => option.id)).toEqual(
      expectedModuleRefs,
    );
  });

  it('exposes the bundled starter diagram', () => {
    expect(semanticBootstrap.bundledStarters.map((entry) => entry.id)).toEqual(['starter']);
    expect(semanticBootstrap.bundledStarters[0]).toEqual({
      id: 'starter',
      label: 'Starter Diagram',
      raw: starterDiagramRaw,
      document: parseDocument(starterDiagramRaw),
      schemaActivations: parseDocument(starterDiagramRaw).schemaRefs,
    });
  });
});
