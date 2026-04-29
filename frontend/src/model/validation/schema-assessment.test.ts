import { describe, expect, it } from 'vitest';

import { parseSchema } from '../../util/serialization';
import { diagnosticsToMessages } from '../diagnostics';
import { buildSchemaActivation, getSchemaModuleRef } from '../schema-ref';
import type { SchemaModule, SemanticDocument } from '../types';
import { assessSchemaValidation } from './schema-assessment';
import { buildSchemaVersionCatalog } from './schema-closure';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const makeCatalog = (entries: Array<{ raw: string; module?: SchemaModule }>) =>
  buildSchemaVersionCatalog(
    entries.map(({ raw, module }) => {
      const parsed = module ?? parseSchema(raw);
      return {
        schemaId: getSchemaModuleRef(parsed),
        version: parsed.version,
        raw,
        module: parsed,
      };
    }),
  );

describe('schema assessment pipeline', () => {
  it('stops at the parse stage for invalid yaml', () => {
    const assessment = assessSchemaValidation({
      raw: 'owner: user\nname: test\nversion: "1.0"\ntypes: [\nrelations: []',
    });

    expect(assessment.parse.status).toBe('error');
    expect(assessment.authored.status).toBe('skipped');
    expect(assessment.closure.status).toBe('skipped');
    expect(assessment.materialization.status).toBe('skipped');
    expect(assessment.resolved.status).toBe('skipped');
  });

  it('stops at the authored stage for invalid metamodel input', () => {
    const assessment = assessSchemaValidation({
      raw: `
owner: user
name: test
version: "1.0"
invalid_outer_key: true
types: []
relations: []
`.trim(),
    });

    expect(assessment.parse.status).toBe('ok');
    expect(assessment.authored.status).toBe('error');
    expect(assessment.closure.status).toBe('skipped');
    expect(diagnosticsToMessages(assessment.authored.diagnostics)[0]).toContain('is not allowed');
  });

  it('fails at the dependency-closure stage for cyclic dependency chains', () => {
    const rootRaw = `
owner: user
name: alpha
version: "1.0"
use:
  - schema: user/beta@1.0
    alias: beta
types: []
relations: []
`.trim();
    const betaRaw = `
owner: user
name: beta
version: "1.0"
use:
  - schema: user/alpha@1.0
    alias: alpha
types: []
relations: []
`.trim();

    const assessment = assessSchemaValidation({
      raw: rootRaw,
      versionCatalog: makeCatalog([{ raw: rootRaw }, { raw: betaRaw }]),
    });

    expect(assessment.parse.status).toBe('ok');
    expect(assessment.authored.status).toBe('ok');
    expect(assessment.closure.status).toBe('error');
    expect(assessment.materialization.status).toBe('skipped');
    expect(diagnosticsToMessages(assessment.closure.diagnostics)[0]).toContain(
      'Schema dependency cycle detected',
    );
  });

  it('fails at the materialization stage for stale dependency patch targets', () => {
    const baseRaw = `
owner: user
name: base
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim();
    const featureRaw = `
owner: user
name: feature
version: "1.0"
use:
  - schema: user/base@1.0
    alias: base
types: []
relations: []
update:
  base.types.missing:
    set:
      label: Missing
`.trim();

    const assessment = assessSchemaValidation({
      raw: featureRaw,
      versionCatalog: makeCatalog([{ raw: baseRaw }]),
    });

    expect(assessment.closure.status).toBe('ok');
    expect(assessment.materialization.status).toBe('error');
    expect(assessment.resolved.status).toBe('skipped');
    expect(diagnosticsToMessages(assessment.materialization.diagnostics)).toContain(
      'Update selector target not found: base.types.missing',
    );
  });

  it('fails at the resolved-schema stage for invalid resolved references', () => {
    const assessment = assessSchemaValidation({
      raw: `
owner: user
name: test
version: "1.0"
types:
  - id: service
    label: Service
    display:
      primaryTag: missing
relations: []
`.trim(),
    });

    expect(assessment.materialization.status).toBe('ok');
    expect(assessment.resolved.status).toBe('error');
    expect(
      diagnosticsToMessages(assessment.resolved.diagnostics).some((message) =>
        message.includes('display.primaryTag references unknown tag'),
      ),
    ).toBe(true);
  });

  it('returns diagram validation separately from schema validation', () => {
    const invalidDiagram: SemanticDocument = {
      version: '1',
      schemaRefs: [act('user/test@1.0')],
      entities: [{ id: 'entity-1', type: 'user/test.types.missing', name: 'Broken' }],
      relations: [],
    };

    const assessment = assessSchemaValidation({
      raw: `
owner: user
name: test
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim(),
      diagram: invalidDiagram,
    });

    expect(assessment.ok).toBe(true);
    expect(assessment.resolved.status).toBe('ok');
    expect(assessment.diagram?.status).toBe('error');
    expect(
      diagnosticsToMessages(assessment.diagram?.diagnostics ?? []).some((message) =>
        message.includes('Entity entity-1 uses unknown type user/test.types.missing'),
      ),
    ).toBe(true);
  });

  it('carries a valid schema through all stages', () => {
    const baseRaw = `
owner: user
name: base
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim();
    const featureRaw = `
owner: user
name: feature
version: "1.0"
use:
  - schema: user/base@1.0
    alias: base
types:
  - id: feature-service
    label: Feature Service
    extends: service
relations: []
`.trim();

    const assessment = assessSchemaValidation({
      raw: featureRaw,
      versionCatalog: makeCatalog([{ raw: baseRaw }]),
    });

    expect(assessment.ok).toBe(true);
    expect(assessment.parse.status).toBe('ok');
    expect(assessment.authored.status).toBe('ok');
    expect(assessment.closure.status).toBe('ok');
    expect(assessment.materialization.status).toBe('ok');
    expect(assessment.resolved.status).toBe('ok');
    expect(assessment.runtime?.resolved.resolvedModuleIds).toEqual(['user/base', 'user/feature']);
  });
});
