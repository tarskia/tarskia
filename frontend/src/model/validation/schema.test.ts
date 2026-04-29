import { describe, expect, it } from 'vitest';

import dataModelRaw from '../../schemas/data-model.yaml?raw';
import { diagnosticsToMessages } from '../diagnostics';
import { getSchemaModuleRef } from '../schema-ref';
import { parseAndValidateSchemaModule, validateSchemaModuleObject } from './schema';

describe('schema validation API', () => {
  it('parses and validates schema raw text', () => {
    const result = parseAndValidateSchemaModule(dataModelRaw);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value && getSchemaModuleRef(result.value)).toBe('core/data-model');
    expect(result.value?.use?.[0]?.schema).toBe('core/software@0.1');
  });

  it('returns validation errors for invalid objects', () => {
    const result = validateSchemaModuleObject({
      owner: 'user',
      name: 'test',
      version: '1.0.0',
      types: [{ label: 'Thing' }],
      relations: [],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('allows entity types without labels', () => {
    const result = validateSchemaModuleObject({
      owner: 'user',
      name: 'test',
      version: '1.0.0',
      types: [{ id: 'thing' }],
      relations: [],
    });

    expect(result.ok).toBe(true);
    expect(result.value?.types[0]?.id).toBe('thing');
    expect(result.value?.types[0]?.label).toBeUndefined();
  });

  it('allows schema and entity type descriptions', () => {
    const result = validateSchemaModuleObject({
      owner: 'user',
      name: 'test',
      version: '1.0.0',
      description: 'Deployable architecture primitives for a product surface.',
      types: [
        {
          id: 'service',
          label: 'Service',
          description: 'Deployable runtime boundary rather than an internal code unit.',
        },
      ],
      relations: [],
    });

    expect(result.ok).toBe(true);
    expect(result.value?.description).toBe(
      'Deployable architecture primitives for a product surface.',
    );
    expect(result.value?.types[0]?.description).toBe(
      'Deployable runtime boundary rather than an internal code unit.',
    );
  });

  it('reports semantic validation errors for duplicate ids and unknown selector aliases', () => {
    const result = validateSchemaModuleObject({
      owner: 'user',
      name: 'bad-semantic',
      version: '1.0.0',
      use: [{ schema: 'core/web-app@0.3', alias: 'web' }],
      types: [
        { id: 'thing', label: 'Thing' },
        { id: 'thing', label: 'Thing 2' },
      ],
      relations: [{ id: 'thing', label: 'thing' }],
      update: {
        'data.types.api-endpoint': {
          set: {
            label: 'Nope',
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    const messages = diagnosticsToMessages(result.diagnostics);
    expect(messages).toContain('Duplicate id in types: thing');
    expect(messages).toContain('Unknown selector alias in update: data');
  });
});
