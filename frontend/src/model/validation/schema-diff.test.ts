import { describe, expect, it } from 'vitest';

import type { SchemaModule } from '../types';
import { extractSchemaDiff } from './schema-diff';

describe('schema diff extraction', () => {
  it('extracts added and removed top-level objects', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      tags: [{ id: 'internal', label: 'Internal' }],
      traits: [{ id: 'deployable', label: 'Deployable' }],
      types: [{ id: 'service', label: 'Service' }],
      relations: [{ id: 'reads', label: 'reads' }],
    };
    const next: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.1',
      tags: [{ id: 'public', label: 'Public' }],
      traits: [{ id: 'auditable', label: 'Auditable' }],
      types: [{ id: 'database', label: 'Database' }],
      relations: [{ id: 'writes', label: 'writes' }],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'object_removed', subject: 'tag', targetId: 'internal' }),
        expect.objectContaining({ kind: 'object_added', subject: 'tag', targetId: 'public' }),
        expect.objectContaining({
          kind: 'object_removed',
          subject: 'trait',
          targetId: 'deployable',
        }),
        expect.objectContaining({ kind: 'object_added', subject: 'trait', targetId: 'auditable' }),
        expect.objectContaining({ kind: 'object_removed', subject: 'type', targetId: 'service' }),
        expect.objectContaining({ kind: 'object_added', subject: 'type', targetId: 'database' }),
        expect.objectContaining({
          kind: 'object_removed',
          subject: 'relation',
          targetId: 'reads',
        }),
        expect.objectContaining({ kind: 'object_added', subject: 'relation', targetId: 'writes' }),
      ]),
    );
  });

  it('extracts property additions and removals', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [{ id: 'service', properties: [{ id: 'region', type: 'string' }] }],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '1.1',
      types: [{ id: 'service', properties: [{ id: 'zone', type: 'string' }] }],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'property_removed',
          targetId: 'service.region',
          propertyId: 'region',
        }),
        expect.objectContaining({
          kind: 'property_added',
          targetId: 'service.zone',
          propertyId: 'zone',
        }),
      ]),
    );
  });

  it('extracts relation property additions and removals', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [],
      relations: [{ id: 'calls', label: 'calls', properties: [{ id: 'method', type: 'string' }] }],
    };
    const next: SchemaModule = {
      ...previous,
      version: '1.1',
      relations: [
        { id: 'calls', label: 'calls', properties: [{ id: 'requestSchema', type: 'string' }] },
      ],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'property_removed',
          targetId: 'calls.method',
          propertyId: 'method',
        }),
        expect.objectContaining({
          kind: 'property_added',
          targetId: 'calls.requestSchema',
          propertyId: 'requestSchema',
        }),
      ]),
    );
  });

  it('extracts narrowing and widening trait participation changes', () => {
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
      types: [{ id: 'service', traits: ['store-client'] }, { id: 'database' }, { id: 'cache' }],
      relations: [
        {
          id: 'reads',
          label: 'reads',
        },
        {
          id: 'writes',
          label: 'writes',
        },
        {
          id: 'read-writes',
          label: 'read-writes',
        },
      ],
    };
    const next: SchemaModule = {
      ...previous,
      version: '1.1',
      traits: [
        {
          id: 'store-client',
          label: 'Store Client',
          relationParticipation: [
            { relation: 'reads', endpoint: 'from' },
            { relation: 'read-writes', endpoint: 'from' },
          ],
        },
      ],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'constraint_values_removed',
          targetId: 'store-client',
          values: ['writes:from'],
        }),
        expect.objectContaining({
          kind: 'constraint_values_added',
          targetId: 'store-client',
          values: ['read-writes:from'],
        }),
      ]),
    );
  });

  it('extracts mayTerminate changes on traits', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      traits: [{ id: 'api-surface', label: 'API Surface' }],
      types: [],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '1.1',
      traits: [{ id: 'api-surface', label: 'API Surface', analysis: { mayTerminate: true } }],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: 'trait_may_terminate_enabled',
        subject: 'trait',
        targetId: 'api-surface',
      }),
    );
  });

  it('extracts inheritance changes', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [{ id: 'service', extends: 'node' }],
      relations: [],
    };
    const next: SchemaModule = {
      ...previous,
      version: '2.0',
      types: [{ id: 'service', extends: 'runtime' }],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: 'extends_changed',
        subject: 'type',
        targetId: 'service',
      }),
    );
  });

  it('extracts visual relation flow changes as relation diffs', () => {
    const previous: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      types: [],
      relations: [{ id: 'reads', label: 'reads' }],
    };
    const next: SchemaModule = {
      ...previous,
      relations: [
        {
          id: 'reads',
          label: 'reads',
          display: {
            flowDirection: 'reverse',
          },
        },
      ],
    };

    const diff = extractSchemaDiff(previous, next);

    expect(diff).toContainEqual(
      expect.objectContaining({
        kind: 'relation_flow_direction_changed',
        subject: 'relation',
        targetId: 'reads',
        previousDirection: 'forward',
        nextDirection: 'reverse',
      }),
    );
  });
});
