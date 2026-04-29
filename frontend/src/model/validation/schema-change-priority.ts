import type { SchemaClassifiedChange } from './schema-compatibility-rules';

export interface SchemaPrioritizedChange extends SchemaClassifiedChange {
  priority: number;
}

export const getSchemaChangePriority = (change: SchemaClassifiedChange): number => {
  if (change.severity === 'breaking' && change.operation === 'remove') return 0;
  if (change.severity === 'breaking') return 1;
  if (change.operation === 'add') return 2;
  if (change.operation === 'widen') return 3;
  return 4;
};

export const prioritizeSchemaChanges = (
  changes: SchemaClassifiedChange[],
): SchemaPrioritizedChange[] =>
  [...changes]
    .map((change) => ({
      ...change,
      priority: getSchemaChangePriority(change),
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.diff.subject !== right.diff.subject) {
        return left.diff.subject.localeCompare(right.diff.subject);
      }
      if (left.diff.displayId !== right.diff.displayId) {
        return left.diff.displayId.localeCompare(right.diff.displayId);
      }
      return left.diff.targetId.localeCompare(right.diff.targetId);
    });
