import { getSchemaModuleRef } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { semanticBootstrap } from './bootstrap';
import { parseTrustedBundledSchemaModule } from './trusted-bundled-assets';

const bundledSchemaRaws = Object.values({
  ...import.meta.glob('../../../packages/diagram-semantics/core-schemas/*.yaml', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
  ...import.meta.glob('../schemas/*.yaml', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
} as Record<string, string>);

describe('semanticBootstrap', () => {
  it('reproduces the built-in schema catalog', () => {
    const expectedModuleRefs = bundledSchemaRaws
      .map((raw) => getSchemaModuleRef(parseTrustedBundledSchemaModule(raw)))
      .sort((left, right) => left.localeCompare(right));

    expect(semanticBootstrap.builtInSchemaCatalogEntries.map((entry) => entry.schemaId)).toEqual(
      expectedModuleRefs,
    );
    expect(semanticBootstrap.schemaModules.map((module) => getSchemaModuleRef(module))).toEqual(
      expectedModuleRefs,
    );
  });
});
