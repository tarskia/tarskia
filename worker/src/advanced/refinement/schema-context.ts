import type { SchemaActivation, SchemaModule, SchemaSemantics } from '../../semantic';
import type { SchemaFlowCatalog } from '../schema-flow-catalog';
import type { SchemaRefCandidate } from '../types';

export interface NodeRefinementSchemaContext {
  inputFingerprint?: string;
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
  schema: SchemaModule;
  semantics: SchemaSemantics;
  schemaFlowCatalog: SchemaFlowCatalog;
}

export const MAX_NODE_REFINEMENT_REPAIR_ATTEMPTS = 2;

export const MAX_REFINED_EDGES_PER_INHERITED_EDGE = 3;

export const DEFAULT_NODE_REFINEMENT_MAX_DEPTH = 8;

export const MAX_SURROUNDING_CONTEXT_CHILDREN = 6;

export const MAX_SURROUNDING_CONTEXT_NEARBY_CONCEPTS = 8;

export const MAX_SYNTHETIC_TYPED_GROUP_CHILDREN = 6;

export const UNREFINED_INHERITED_EDGE_DIAGNOSTIC_CODE =
  'diagram.node_refinement.unrefined_inherited_edge';

export const CALLS_RELATION_TYPE_ID = 'core/software.relations.calls';

export const READ_WRITE_RELATION_TYPE_IDS = new Set([
  'core/software.relations.reads',
  'core/software.relations.writes',
  'core/software.relations.read-writes',
]);
