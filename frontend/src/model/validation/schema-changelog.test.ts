import { describe, expect, it } from 'vitest';

import type { SchemaModule } from '../types';
import { prioritizeSchemaChanges } from './schema-change-priority';
import { buildInitialSchemaSummary, renderSchemaChangelog } from './schema-changelog';
import { classifySchemaDiff } from './schema-compatibility-rules';

describe('schema changelog rendering', () => {
  it('renders initial publish counts from the effective schema', () => {
    const schema: SchemaModule = {
      owner: 'user',
      name: 'test',
      version: '1.0',
      tags: [{ id: 'internal' }],
      traits: [{ id: 'deployable', label: 'Deployable' }],
      types: [{ id: 'service' }, { id: 'database' }],
      relations: [{ id: 'reads', label: 'reads' }],
    };

    expect(buildInitialSchemaSummary(schema)).toEqual([
      'Initial schema: 2 types, 1 trait, 1 relation, 1 tag',
    ]);
  });

  it('renders grouped update summary lines', () => {
    const prioritized = prioritizeSchemaChanges(
      classifySchemaDiff([
        {
          kind: 'object_removed',
          subject: 'type',
          targetId: 'database',
          displayId: 'database',
        },
        {
          kind: 'object_added',
          subject: 'type',
          targetId: 'job',
          displayId: 'job',
        },
        {
          kind: 'object_added',
          subject: 'type',
          targetId: 'worker',
          displayId: 'worker',
        },
      ]),
    );

    const changelog = renderSchemaChangelog(prioritized);

    expect(changelog.briefSummary).toEqual(['Removed type database', 'Added type job and 1 other']);
  });

  it('renders the no-op summary when there are no changes', () => {
    const changelog = renderSchemaChangelog([]);

    expect(changelog.briefSummary).toEqual(['No effective change to publish']);
  });

  it('renders visual relation flow changes as non-breaking relation updates', () => {
    const changelog = renderSchemaChangelog(
      prioritizeSchemaChanges(
        classifySchemaDiff([
          {
            kind: 'relation_flow_direction_changed',
            subject: 'relation',
            targetId: 'reads',
            displayId: 'reads',
            previousDirection: 'forward',
            nextDirection: 'reverse',
          },
        ]),
      ),
    );

    expect(changelog.nonBreakingChanges).toEqual([
      'Relation reads visual flow changed from forward to reverse',
    ]);
    expect(changelog.briefSummary).toEqual(['Updated relation reads']);
  });
});
