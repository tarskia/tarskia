import { describe, expect, it } from 'vitest';

import { classifySchemaDiff } from './schema-compatibility-rules';

describe('schema compatibility classification', () => {
  it('treats deletions and narrowing as breaking', () => {
    const classified = classifySchemaDiff([
      {
        kind: 'object_removed',
        subject: 'type',
        targetId: 'service',
        displayId: 'service',
      },
      {
        kind: 'constraint_values_removed',
        subject: 'relation',
        targetId: 'reads',
        displayId: 'reads',
        label: 'Relation reads from types',
        values: ['database'],
      },
    ]);

    expect(classified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'breaking', operation: 'remove' }),
        expect.objectContaining({ severity: 'breaking', operation: 'narrow' }),
      ]),
    );
  });

  it('treats additive changes as non-breaking', () => {
    const classified = classifySchemaDiff([
      {
        kind: 'object_added',
        subject: 'type',
        targetId: 'service',
        displayId: 'service',
      },
      {
        kind: 'property_added',
        subject: 'property',
        targetId: 'service.region',
        displayId: 'Type service.region',
        ownerLabel: 'Type service',
        propertyId: 'region',
      },
    ]);

    expect(classified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'nonBreaking', operation: 'add' }),
        expect.objectContaining({ severity: 'nonBreaking', operation: 'add' }),
      ]),
    );
  });

  it('treats incompatible property type changes as breaking', () => {
    const [classified] = classifySchemaDiff([
      {
        kind: 'property_type_changed',
        subject: 'property',
        targetId: 'service.region',
        displayId: 'Type service.region',
        ownerLabel: 'Type service',
        propertyId: 'region',
        previousType: 'string',
        nextType: 'enum',
      },
    ]);

    expect(classified).toMatchObject({
      severity: 'breaking',
      operation: 'change',
    });
  });

  it('keeps property deletion breaking', () => {
    const [classified] = classifySchemaDiff([
      {
        kind: 'property_removed',
        subject: 'property',
        targetId: 'service.region',
        displayId: 'Type service.region',
        ownerLabel: 'Type service',
        propertyId: 'region',
      },
    ]);

    expect(classified).toMatchObject({
      severity: 'breaking',
      operation: 'remove',
    });
  });

  it('treats visual relation flow changes as non-breaking updates', () => {
    const [classified] = classifySchemaDiff([
      {
        kind: 'relation_flow_direction_changed',
        subject: 'relation',
        targetId: 'reads',
        displayId: 'reads',
        previousDirection: 'forward',
        nextDirection: 'reverse',
      },
    ]);

    expect(classified).toMatchObject({
      severity: 'nonBreaking',
      operation: 'change',
    });
  });
});
