import { describe, expect, it } from 'vitest';

import type { SchemaModule } from '../types';
import { buildSchemaVersionCatalog } from './schema-closure';
import { assessSchemaPublishability } from './schema-publish';

describe('schema publish assessment', () => {
  it('assesses publishability against exact pinned dependency versions', () => {
    const baseV1: SchemaModule = {
      owner: 'user',
      name: 'base',
      version: '1.0',
      types: [{ id: 'service', label: 'Service' }],
      relations: [],
    };
    const baseV2: SchemaModule = {
      owner: 'user',
      name: 'base',
      version: '2.0',
      types: [
        {
          id: 'service',
          label: 'Service',
          properties: [{ id: 'region', type: 'string' }],
        },
      ],
      relations: [],
    };
    const previousModule: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      use: [{ schema: 'user/base@1.0', alias: 'base' }],
      types: [{ id: 'feature-service', label: 'Feature Service', extends: 'service' }],
      relations: [],
    };
    const nextModule: SchemaModule = {
      ...previousModule,
      version: '1.1',
      use: [{ schema: 'user/base@2.0', alias: 'base' }],
    };
    const previousRaw = `
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
    const nextRaw = `
owner: user
name: feature
version: "1.1"
use:
  - schema: user/base@2.0
    alias: base
types:
  - id: feature-service
    label: Feature Service
    extends: service
relations: []
`.trim();

    const assessment = assessSchemaPublishability({
      catalog: buildSchemaVersionCatalog([
        { schemaId: 'user/base', version: '1.0', raw: 'base-v1', module: baseV1 },
        { schemaId: 'user/base', version: '2.0', raw: 'base-v2', module: baseV2 },
      ]),
      previous: {
        schemaId: 'user/feature',
        version: '1.0',
        raw: previousRaw,
        module: previousModule,
      },
      next: {
        schemaId: 'user/feature',
        version: '1.1',
        raw: nextRaw,
        module: nextModule,
      },
    });

    expect(assessment.ok).toBe(true);
    expect(assessment.previousDependencyRefs).toEqual(['user/base@1.0']);
    expect(assessment.nextDependencyRefs).toEqual(['user/base@2.0']);
    expect(assessment.backwardCompatible).toBe(true);
    expect(assessment.hasEffectiveChanges).toBe(true);
    expect(assessment.nonBreakingChanges).toContain('Type service added property region');
    expect(assessment.briefSummary[0]).toContain('Added property');
  });

  it('blocks publishability when a dependency ref is unpinned', () => {
    const nextModule: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      use: [{ schema: 'user/base', alias: 'base' }],
      types: [{ id: 'feature-service', label: 'Feature Service', extends: 'service' }],
      relations: [],
    };

    const assessment = assessSchemaPublishability({
      catalog: buildSchemaVersionCatalog([]),
      next: {
        schemaId: 'user/feature',
        version: '1.0',
        raw: `
owner: user
name: feature
version: "1.0"
use:
  - schema: user/base
    alias: base
types:
  - id: feature-service
    label: Feature Service
    extends: service
relations: []
`.trim(),
        module: nextModule,
      },
    });

    expect(assessment.ok).toBe(false);
    expect(assessment.diagnostics[0]?.message).toContain('must be version-pinned');
  });

  it('reports no effective change for identical published versions', () => {
    const version: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      types: [{ id: 'feature-service', label: 'Feature Service' }],
      relations: [],
    };

    const assessment = assessSchemaPublishability({
      catalog: buildSchemaVersionCatalog([]),
      previous: {
        schemaId: 'user/feature',
        version: '1.0',
        raw: `
owner: user
name: feature
version: "1.0"
types:
  - id: feature-service
    label: Feature Service
relations: []
`.trim(),
        module: version,
      },
      next: {
        schemaId: 'user/feature',
        version: '1.1',
        raw: `
owner: user
name: feature
version: "1.1"
types:
  - id: feature-service
    label: Feature Service
relations: []
`.trim(),
        module: {
          ...version,
          version: '1.1',
        },
      },
    });

    expect(assessment.ok).toBe(true);
    expect(assessment.hasEffectiveChanges).toBe(false);
    expect(assessment.recommendedBump).toBe('none');
    expect(assessment.briefSummary).toEqual(['No effective change to publish']);
  });

  it('summarizes initial publish from the authored schema module', () => {
    const base: SchemaModule = {
      owner: 'user',
      name: 'base',
      version: '1.0',
      types: [{ id: 'service', label: 'Service' }],
      relations: [],
    };
    const nextModule: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      use: [{ schema: 'user/base@1.0', alias: 'base' }],
      types: [{ id: 'feature-service', label: 'Feature Service', extends: 'service' }],
      relations: [],
    };

    const assessment = assessSchemaPublishability({
      catalog: buildSchemaVersionCatalog([
        { schemaId: 'user/base', version: '1.0', raw: 'base', module: base },
      ]),
      next: {
        schemaId: 'user/feature',
        version: '1.0',
        raw: `
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
`.trim(),
        module: nextModule,
      },
    });

    expect(assessment.ok).toBe(true);
    expect(assessment.briefSummary).toEqual(['Uses base', 'Defines 1 type']);
  });
});
