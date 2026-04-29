import { describe, expect, it } from 'vitest';

import { prioritizeSchemaChanges } from './schema-change-priority';
import type { SchemaClassifiedChange } from './schema-compatibility-rules';

describe('schema change prioritisation', () => {
  it('sorts breaking removals before other changes', () => {
    const changes: SchemaClassifiedChange[] = [
      {
        severity: 'nonBreaking',
        operation: 'add',
        diff: {
          kind: 'object_added',
          subject: 'type',
          targetId: 'database',
          displayId: 'database',
        },
      },
      {
        severity: 'breaking',
        operation: 'remove',
        diff: {
          kind: 'object_removed',
          subject: 'type',
          targetId: 'service',
          displayId: 'service',
        },
      },
      {
        severity: 'breaking',
        operation: 'change',
        diff: {
          kind: 'extends_changed',
          subject: 'type',
          targetId: 'worker',
          displayId: 'worker',
        },
      },
    ];

    const prioritized = prioritizeSchemaChanges(changes);

    expect(prioritized.map((change) => change.diff.targetId)).toEqual([
      'service',
      'worker',
      'database',
    ]);
  });
});
