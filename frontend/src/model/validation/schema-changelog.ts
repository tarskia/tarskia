import type { SchemaModule } from '../types';
import type { SchemaPrioritizedChange } from './schema-change-priority';
import type {
  SchemaCompatibilityChange,
  SchemaCompatibilityChangeOperation,
  SchemaCompatibilityChangeSubject,
} from './schema-compatibility-types';

export interface SchemaChangelog {
  changes: SchemaCompatibilityChange[];
  breakingChanges: string[];
  nonBreakingChanges: string[];
  briefSummary: string[];
}

const formatCompatibilityChangeMessage = (change: SchemaPrioritizedChange): string => {
  const { diff } = change;
  switch (diff.kind) {
    case 'schema_id_changed':
      return `Schema id changed from ${diff.previousId} to ${diff.nextId}`;
    case 'object_added':
      return `Added ${diff.subject} ${diff.displayId}`;
    case 'object_removed':
      return `Removed ${diff.subject} ${diff.displayId}`;
    case 'extends_changed':
      return `${diff.subject === 'trait' ? 'Trait' : 'Type'} ${diff.displayId} changed inheritance`;
    case 'trait_may_terminate_enabled':
      return `Trait ${diff.displayId} may now terminate visible flow`;
    case 'trait_may_terminate_disabled':
      return `Trait ${diff.displayId} may no longer terminate visible flow`;
    case 'constraint_restricted':
      return `${diff.label} became more restrictive`;
    case 'constraint_relaxed':
      return `${diff.label} became less restrictive`;
    case 'constraint_values_removed':
      return `${diff.label} no longer allows: ${diff.values.join(', ')}`;
    case 'constraint_values_added':
      return `${diff.label} now also allows: ${diff.values.join(', ')}`;
    case 'type_traits_removed':
      return `Type ${diff.displayId} lost traits: ${diff.values.join(', ')}`;
    case 'type_traits_added':
      return `Type ${diff.displayId} gained traits: ${diff.values.join(', ')}`;
    case 'name_required_enabled':
      return `Type ${diff.displayId} now requires a name`;
    case 'name_required_disabled':
      return `Type ${diff.displayId} no longer requires a name`;
    case 'containment_added':
      return `Type ${diff.displayId} gained containment rules`;
    case 'containment_removed':
      return `Type ${diff.displayId} removed containment restrictions`;
    case 'relation_became_directed':
      return `Relation ${diff.displayId} is now directed`;
    case 'relation_became_undirected':
      return `Relation ${diff.displayId} is now undirected`;
    case 'relation_flow_direction_changed':
      return `Relation ${diff.displayId} visual flow changed from ${diff.previousDirection} to ${diff.nextDirection}`;
    case 'property_added':
      return `${diff.ownerLabel} added property ${diff.propertyId}`;
    case 'property_removed':
      return `${diff.ownerLabel} removed property ${diff.propertyId}`;
    case 'property_type_changed':
      return `${diff.ownerLabel} changed property ${diff.propertyId} type from ${diff.previousType} to ${diff.nextType}`;
    case 'property_allow_other_disabled':
      return `${diff.ownerLabel} property ${diff.propertyId} no longer allows other values`;
    case 'property_allow_other_enabled':
      return `${diff.ownerLabel} property ${diff.propertyId} now allows other values`;
    case 'property_enum_values_removed':
      return `${diff.ownerLabel} property ${diff.propertyId} removed enum values: ${diff.values.join(', ')}`;
    case 'property_enum_values_added':
      return `${diff.ownerLabel} property ${diff.propertyId} added enum values: ${diff.values.join(', ')}`;
  }
};

const subjectLabel = (subject: SchemaCompatibilityChangeSubject) => {
  if (subject === 'property') return 'property';
  if (subject === 'relation') return 'relation';
  if (subject === 'schema') return 'schema';
  if (subject === 'tag') return 'tag';
  if (subject === 'trait') return 'trait';
  return 'type';
};

const verbLabel = (operation: SchemaCompatibilityChangeOperation) => {
  if (operation === 'add') return 'Added';
  if (operation === 'remove') return 'Removed';
  if (operation === 'narrow') return 'Narrowed';
  if (operation === 'widen') return 'Expanded';
  return 'Updated';
};

export const buildInitialSchemaSummary = (schema: SchemaModule): string[] => [
  `Initial schema: ${schema.types.length} type${schema.types.length === 1 ? '' : 's'}, ${
    (schema.traits ?? []).length
  } trait${(schema.traits ?? []).length === 1 ? '' : 's'}, ${schema.relations.length} relation${
    schema.relations.length === 1 ? '' : 's'
  }, ${(schema.tags ?? []).length} tag${(schema.tags ?? []).length === 1 ? '' : 's'}`,
];

export const renderSchemaChangelog = (
  prioritizedChanges: SchemaPrioritizedChange[],
): SchemaChangelog => {
  const changes = prioritizedChanges
    .map((change) => ({
      severity: change.severity,
      subject: change.diff.subject,
      operation: change.operation,
      targetId: change.diff.targetId,
      displayId: change.diff.displayId,
      message: formatCompatibilityChangeMessage(change),
      priority: change.priority,
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.message.localeCompare(right.message);
    });

  const breakingChanges = changes
    .filter((change) => change.severity === 'breaking')
    .map((change) => change.message);
  const nonBreakingChanges = changes
    .filter((change) => change.severity === 'nonBreaking')
    .map((change) => change.message);

  if (changes.length === 0) {
    return {
      changes,
      breakingChanges,
      nonBreakingChanges,
      briefSummary: ['No effective change to publish'],
    };
  }

  const grouped = new Map<
    string,
    {
      subject: SchemaCompatibilityChangeSubject;
      operation: SchemaCompatibilityChangeOperation;
      priority: number;
      displayIds: string[];
    }
  >();
  for (const change of changes) {
    const key = `${change.severity}|${change.operation}|${change.subject}`;
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.displayIds.includes(change.displayId)) {
        existing.displayIds.push(change.displayId);
      }
      continue;
    }
    grouped.set(key, {
      subject: change.subject,
      operation: change.operation,
      priority: change.priority,
      displayIds: [change.displayId],
    });
  }

  return {
    changes,
    breakingChanges,
    nonBreakingChanges,
    briefSummary: [...grouped.values()]
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return left.subject.localeCompare(right.subject);
      })
      .slice(0, 3)
      .map((group) => {
        const ids = [...group.displayIds].sort((left, right) => left.localeCompare(right));
        const first = ids[0] ?? subjectLabel(group.subject);
        const rest = ids.length - 1;
        return `${verbLabel(group.operation)} ${subjectLabel(group.subject)} ${first}${
          rest > 0 ? ` and ${rest} other${rest === 1 ? '' : 's'}` : ''
        }`;
      }),
  };
};
