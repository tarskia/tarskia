import { describe, expect, it } from 'vitest';

import { buildSchemaActivation } from '../schema-ref';
import type { SchemaModule, SemanticDocument } from '../types';
import { buildSchemaVersionCatalog } from './schema-closure';
import { assessSchemaEditorInput } from './schema-editor-assessment';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

describe('schema editor assessment facade', () => {
  it('returns a ready initial publish for a valid schema', () => {
    const assessment = assessSchemaEditorInput({
      raw: `
owner: user
name: draft
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim(),
      versionCatalog: buildSchemaVersionCatalog([]),
      nextSchemaId: 'user/draft',
      nextVersion: '1.0',
    });

    expect(assessment.schema.ok).toBe(true);
    expect(assessment.publish?.ok).toBe(true);
    expect(assessment.canPublish).toBe(true);
    expect(assessment.suggestedPublishedVersion).toBe('1.0');
    expect(assessment.status.kind).toBe('ready');
    expect(assessment.summaryLines).toEqual(['Defines 1 type']);
  });

  it('surfaces schema failures without publish readiness', () => {
    const assessment = assessSchemaEditorInput({
      raw: `
owner: user
name: draft
version: "1.0"
invalid_outer_key: true
types: []
relations: []
`.trim(),
      versionCatalog: buildSchemaVersionCatalog([]),
      nextSchemaId: 'user/draft',
      nextVersion: '1.0',
    });

    expect(assessment.schema.ok).toBe(false);
    expect(assessment.canPublish).toBe(false);
    expect(assessment.status.kind).toBe('invalid_schema');
    expect(assessment.publish?.ok).not.toBe(true);
  });

  it('blocks update publishes with no effective change', () => {
    const previousRaw = `
owner: user
name: feature
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim();

    const assessment = assessSchemaEditorInput({
      raw: `
owner: user
name: draft
version: "1.0"
types:
  - id: service
    label: Service
relations: []
`.trim(),
      versionCatalog: buildSchemaVersionCatalog([]),
      nextSchemaId: 'user/feature',
      nextVersion: '1.0',
      previousPublished: {
        schemaId: 'user/feature',
        version: '1.0',
        raw: previousRaw,
      },
    });

    expect(assessment.publish?.ok).toBe(true);
    expect(assessment.publish?.hasEffectiveChanges).toBe(false);
    expect(assessment.canPublish).toBe(false);
    expect(assessment.status.kind).toBe('no_effective_change');
    expect(assessment.summaryLines).toEqual(['No effective change to publish']);
  });

  it('keeps publish ready when only the current diagram is invalid', () => {
    const base: SchemaModule = {
      owner: 'user',
      name: 'base',
      version: '1.0',
      types: [{ id: 'service', label: 'Service' }],
      relations: [],
    };
    const diagram: SemanticDocument = {
      version: '1',
      schemaRefs: [act('user/feature@1.0')],
      entities: [{ id: 'entity-1', type: 'user/feature.types.missing', name: 'Broken' }],
      relations: [],
    };

    const assessment = assessSchemaEditorInput({
      raw: `
owner: user
name: draft
version: "1.0"
use:
  - schema: user/base@1.0
    alias: base
types:
  - id: feature-service
    label: Feature Service
    extends: service
relations: []
`.trim(),
      versionCatalog: buildSchemaVersionCatalog([
        {
          schemaId: 'user/base',
          version: '1.0',
          raw: 'base-v1',
          module: base,
        },
      ]),
      nextSchemaId: 'user/feature',
      nextVersion: '1.0',
      diagram,
    });

    expect(assessment.schema.ok).toBe(true);
    expect(assessment.schema.diagram?.status).toBe('error');
    expect(assessment.publish?.ok).toBe(true);
    expect(assessment.canPublish).toBe(true);
    expect(assessment.status.kind).toBe('ready');
    expect(assessment.summaryLines).toEqual(['Uses base', 'Defines 1 type']);
  });
});
