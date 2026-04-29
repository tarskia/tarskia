import { describe, expect, it } from 'vitest';

import type { SchemaModule } from '../types';
import { summarizeSchemaModule } from './schema-summary';

describe('schema summary', () => {
  it('summarizes imports and local definitions for a new schema', () => {
    const module: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      use: [
        { schema: 'core/web-app@0.3', alias: 'web' },
        { schema: 'core/data-model@0.3', alias: 'data' },
      ],
      types: [{ id: 'note', label: 'Note' }],
      relations: [{ id: 'reads', label: 'Reads' }],
    };

    const summary = summarizeSchemaModule(module);

    expect(summary.summaryLines).toEqual([
      'Uses data-model and web-app',
      'Defines 1 type and 1 relation',
    ]);
  });

  it('summarizes updates and removals without pretending to explain their full effect', () => {
    const module: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      use: [{ schema: 'core/web-app@0.3', alias: 'web' }],
      types: [],
      relations: [],
      update: {
        'web.types.service': {},
        'web.relations.calls': {},
      },
      remove: {
        web: ['relations.legacy-calls'],
      },
    };

    const summary = summarizeSchemaModule(module);

    expect(summary.summaryLines).toEqual([
      'Uses web-app',
      'Updates 2 imported objects',
      'Removes 1 imported object',
    ]);
  });

  it('returns a stable empty summary for a valid but empty module', () => {
    const module: SchemaModule = {
      owner: 'user',
      name: 'feature',
      version: '1.0',
      types: [],
      relations: [],
    };

    const summary = summarizeSchemaModule(module);

    expect(summary.summaryLines).toEqual(['No schema elements defined yet']);
  });
});
