import { describe, expect, it } from 'vitest';

import { getSchemaModuleRef } from '../model/schema-ref';
import { buildSchemaVersionCatalog, parseAndValidateSchemaModule } from '../model/validation';
import webAppRaw from '../schemas/web-app.yaml?raw';
import { buildSchemaDependencyReferences } from './schema-dependency-reference';

const parsedWebApp = parseAndValidateSchemaModule(webAppRaw);

if (!parsedWebApp.ok || !parsedWebApp.value) {
  throw new Error('Expected web-app schema fixture to parse for dependency reference tests.');
}

const webAppModule = parsedWebApp.value;

describe('buildSchemaDependencyReferences', () => {
  it('builds browsable dependency objects from the current draft imports', () => {
    const catalog = buildSchemaVersionCatalog([
      {
        schemaId: getSchemaModuleRef(webAppModule),
        version: webAppModule.version,
        raw: webAppRaw,
        module: webAppModule,
      },
    ]);

    const references = buildSchemaDependencyReferences({
      draftText: 'use:\n  - schema: web-app\n    alias: web\n',
      fallbackVersionsBySchemaId: new Map([['core/web-app', '0.3']]),
      versionCatalog: catalog,
    });

    expect(references).toHaveLength(1);
    expect(references[0]?.schemaRef).toBe('core/web-app');
    expect(references[0]?.schemaLabel).toBe('web-app');
    expect(references[0]?.version).toBe('0.3');
    expect(references[0]?.alias).toBe('web');
    expect(
      references[0]?.objects.some(
        (object) =>
          object.section === 'types' &&
          object.id === 'api-endpoint' &&
          object.selectorPath === 'web.types.api-endpoint',
      ),
    ).toBe(true);
  });

  it('returns no dependency references for an invalid draft', () => {
    const references = buildSchemaDependencyReferences({
      draftText: 'use: [',
      versionCatalog: buildSchemaVersionCatalog([]),
    });

    expect(references).toEqual([]);
  });
});
