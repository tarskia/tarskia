import type {
  SchemaCompatibilityChangeOperation,
  SchemaCompatibilityChangeSeverity,
} from './schema-compatibility-types';
import type { SchemaDiffEntry } from './schema-diff';

export interface SchemaClassifiedChange {
  severity: SchemaCompatibilityChangeSeverity;
  operation: SchemaCompatibilityChangeOperation;
  diff: SchemaDiffEntry;
}

const classifySchemaDiffEntry = (diff: SchemaDiffEntry): SchemaClassifiedChange => {
  switch (diff.kind) {
    case 'schema_id_changed':
      return { severity: 'breaking', operation: 'change', diff };
    case 'object_added':
      return { severity: 'nonBreaking', operation: 'add', diff };
    case 'object_removed':
      return { severity: 'breaking', operation: 'remove', diff };
    case 'extends_changed':
      return { severity: 'breaking', operation: 'change', diff };
    case 'trait_may_terminate_disabled':
      return { severity: 'breaking', operation: 'narrow', diff };
    case 'trait_may_terminate_enabled':
      return { severity: 'nonBreaking', operation: 'widen', diff };
    case 'constraint_restricted':
    case 'constraint_values_removed':
    case 'type_traits_removed':
    case 'property_allow_other_disabled':
    case 'relation_became_directed':
      return { severity: 'breaking', operation: 'narrow', diff };
    case 'constraint_relaxed':
    case 'constraint_values_added':
    case 'type_traits_added':
    case 'name_required_disabled':
    case 'containment_added':
    case 'containment_removed':
    case 'property_allow_other_enabled':
    case 'relation_became_undirected':
      return { severity: 'nonBreaking', operation: 'widen', diff };
    case 'relation_flow_direction_changed':
      return { severity: 'nonBreaking', operation: 'change', diff };
    case 'name_required_enabled':
    case 'property_type_changed':
      return { severity: 'breaking', operation: 'change', diff };
    case 'property_added':
    case 'property_enum_values_added':
      return { severity: 'nonBreaking', operation: 'add', diff };
    case 'property_removed':
    case 'property_enum_values_removed':
      return { severity: 'breaking', operation: 'remove', diff };
  }
};

export const classifySchemaDiff = (diffs: SchemaDiffEntry[]): SchemaClassifiedChange[] =>
  diffs.map(classifySchemaDiffEntry);
