import { describe, expect, it } from 'vitest';

import baseRaw from '../../schemas/base.yaml?raw';
import codeRaw from '../../schemas/code.yaml?raw';
import dataModelRaw from '../../schemas/data-model.yaml?raw';
import frontendRaw from '../../schemas/frontend.yaml?raw';
import softwareRaw from '../../schemas/software.yaml?raw';
import webAppRaw from '../../schemas/web-app.yaml?raw';
import { parseSchema } from '../../util/serialization';
import { diagnosticsToMessages } from '../diagnostics';
import { buildRawSchemaSet } from '../schema-runtime';
import { buildSchemaVersionCatalog } from './schema-closure';
import { validateSchemaDraft } from './schema-draft';

const baseRawSchemaSet = buildRawSchemaSet([
  parseSchema(baseRaw),
  parseSchema(softwareRaw),
  parseSchema(webAppRaw),
  parseSchema(codeRaw),
  parseSchema(frontendRaw),
  parseSchema(dataModelRaw),
]);

describe('schema draft validation', () => {
  it('validates a draft module against bundled registry dependencies', () => {
    const result = validateSchemaDraft({
      raw: `
owner: user
name: test-draft
version: 0.1.0
use:
  - schema: core/web-app@0.3
    alias: web
types:
  - id: client
    label: Client
    extends: application
relations: []
update:
  web.types.application:
    add:
      properties:
        - id: tier
          type: enum
          values: [free, paid]
remove: {}
`.trim(),
      baseRawSchemaSet,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.runtime?.resolved.resolvedModuleIds).toContain('core/web-app');
    expect(result.runtime?.resolved.resolvedModuleIds).toContain('user/test-draft');
  });

  it('reports missing dependencies during draft resolution', () => {
    const result = validateSchemaDraft({
      raw: `
owner: user
name: test-draft
version: 0.1.0
use:
  - schema: user/not-installed@1.0.0
    alias: missing
types: []
relations: []
update: {}
remove: {}
`.trim(),
      baseRawSchemaSet,
    });

    expect(result.ok).toBe(false);
    expect(diagnosticsToMessages(result.diagnostics)).toContain(
      'Missing schema dependency: user/not-installed',
    );
  });

  it('resolves exact pinned dependency versions from the version catalog', () => {
    const result = validateSchemaDraft({
      raw: `
owner: user
name: test-draft
version: "1.0"
use:
  - schema: user/base@1.0
    alias: base
types:
  - id: feature
    extends: service
relations: []
update: {}
remove: {}
`.trim(),
      versionCatalog: buildSchemaVersionCatalog([
        {
          schemaId: 'user/base',
          version: '1.0',
          raw: 'base-v1',
          module: {
            owner: 'user',
            name: 'base',
            version: '1.0',
            types: [{ id: 'service', label: 'Service' }],
            relations: [],
          },
        },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.runtime?.resolved.resolvedModuleIds).toContain('user/base');
    expect(result.runtime?.resolved.resolvedModuleIds).toContain('user/test-draft');
  });
});
