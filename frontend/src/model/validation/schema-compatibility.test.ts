import { describe, expect, it } from 'vitest';

import baseRaw from '../../schemas/base.yaml?raw';
import softwareRaw from '../../schemas/software.yaml?raw';
import webAppRaw from '../../schemas/web-app.yaml?raw';
import { parseSchema } from '../../util/serialization';
import { buildRawSchemaSet } from '../schema-runtime';
import type { SchemaModule } from '../types';
import {
  assessResolvedSchemaCompatibility,
  assessSchemaModuleCompatibility,
} from './schema-compatibility';

describe('schema compatibility assessment', () => {
  it('treats additive property changes as non-breaking', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [{ id: 'service', label: 'Service' }],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '1.1',
      types: [
        {
          id: 'service',
          label: 'Service',
          properties: [{ id: 'region', type: 'string' }],
        },
      ],
    };

    const assessment = assessResolvedSchemaCompatibility({ previous, next });

    expect(assessment.backwardCompatible).toBe(true);
    expect(assessment.recommendedBump).toBe('minor');
    expect(assessment.nonBreakingChanges).toContain('Type service added property region');
  });

  it('treats property deletion as breaking', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [
        {
          id: 'service',
          label: 'Service',
          properties: [{ id: 'region', type: 'string' }],
        },
      ],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '2.0',
      types: [{ id: 'service', label: 'Service' }],
    };

    const assessment = assessResolvedSchemaCompatibility({ previous, next });

    expect(assessment.backwardCompatible).toBe(false);
    expect(assessment.recommendedBump).toBe('major');
    expect(assessment.breakingChanges).toContain('Type service removed property region');
  });

  it('treats narrowing trait relation participation as breaking', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      traits: [
        {
          id: 'store-client',
          label: 'Store Client',
          relationParticipation: [
            { relation: 'reads', endpoint: 'from' },
            { relation: 'writes', endpoint: 'from' },
          ],
        },
      ],
      types: [
        { id: 'service', label: 'Service', traits: ['store-client'] },
        { id: 'database', label: 'Database' },
      ],
      relations: [
        {
          id: 'reads',
          label: 'reads',
        },
        {
          id: 'writes',
          label: 'writes',
        },
      ],
    };
    const next: SchemaModule = {
      ...previous,
      version: '2.0',
      traits: [
        {
          id: 'store-client',
          label: 'Store Client',
          relationParticipation: [{ relation: 'reads', endpoint: 'from' }],
        },
      ],
    };

    const assessment = assessResolvedSchemaCompatibility({ previous, next });

    expect(assessment.backwardCompatible).toBe(false);
    expect(assessment.breakingChanges).toContain(
      'Trait store-client relation participation no longer allows: writes:from',
    );
  });

  it('treats disabling trait termination as breaking', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      traits: [{ id: 'api-surface', label: 'API Surface', analysis: { mayTerminate: true } }],
      types: [],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '2.0',
      traits: [{ id: 'api-surface', label: 'API Surface', analysis: { mayTerminate: false } }],
    };

    const assessment = assessResolvedSchemaCompatibility({ previous, next });

    expect(assessment.backwardCompatible).toBe(false);
    expect(assessment.breakingChanges).toContain(
      'Trait api-surface may no longer terminate visible flow',
    );
  });

  it('treats relation property deletion as breaking', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [],
      relations: [
        {
          id: 'calls',
          label: 'calls',
          properties: [{ id: 'requestSchema', type: 'string' }],
        },
      ],
    };
    const next: SchemaModule = {
      ...previous,
      version: '2.0',
      relations: [{ id: 'calls', label: 'calls' }],
    };

    const assessment = assessResolvedSchemaCompatibility({ previous, next });

    expect(assessment.backwardCompatible).toBe(false);
    expect(assessment.breakingChanges).toContain('Relation calls removed property requestSchema');
  });

  it('can compare imported schema modules against bundled dependencies', () => {
    const previousModule: SchemaModule = {
      owner: 'user',
      name: 'payments',
      version: '1.0',
      use: [{ schema: 'core/web-app@0.3', alias: 'web' }],
      types: [
        {
          id: 'payments-service',
          label: 'Payments Service',
          extends: 'application',
        },
      ],
      relations: [],
    };
    const nextModule: SchemaModule = {
      ...previousModule,
      version: '1.1',
      types: [
        {
          id: 'payments-service',
          label: 'Payments Service',
          extends: 'application',
          properties: [{ id: 'region', type: 'string' }],
        },
      ],
    };

    const assessment = assessSchemaModuleCompatibility({
      previousModule,
      nextModule,
      baseRawSchemaSet: buildRawSchemaSet([
        parseSchema(baseRaw),
        parseSchema(softwareRaw),
        parseSchema(webAppRaw),
      ]),
    });

    expect(assessment.backwardCompatible).toBe(true);
    expect(assessment.recommendedBump).toBe('minor');
  });
});
