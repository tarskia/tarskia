/**
 * Public semantic surface for non-semantic layers.
 * Shell, UI adapters, and top-level canvas controllers should import semantic behavior from here
 * instead of reaching into model or util internals directly.
 */
export {
  compileSchemaSemantics,
  compileSemanticDiagramDiffUnion,
  diffSemanticDiagramDocuments,
  type EvolveSemanticDiagramDiffUnionParams,
  evolveSemanticDiagramDiffUnion,
  getResolvedRelationSemantics,
  getResolvedTypeSemantics,
  ingestSchemaModule,
  ingestSemanticDiagramDiff,
  ingestSemanticDocument,
  ingestSemanticSourceDocument,
  ingestTrustedSchemaModule,
  ingestTrustedSemanticDocument,
  ingestTrustedSemanticSourceDocument,
  parseAndValidateSchemaModule,
  parseSchemaModule,
  parseSchemaModuleYaml,
  parseSemanticDocument,
  parseSemanticSourceDocument,
  parseTrustedSchemaModule,
  parseTrustedSemanticDocument,
  parseTrustedSemanticSourceDocument,
  relationTypeMatchesEndpoints,
  type SchemaSemantics,
  type SemanticDiagramDiff,
  type SemanticDiagramDiffChange,
  type SemanticDiagramDiffEdge,
  type SemanticDiagramDiffNode,
  type SemanticDiagramDiffSide,
  type SemanticDiagramDiffUnion,
  type SemanticDiagramEntityChangedField,
  type SemanticDiagramEntityDiff,
  type SemanticDiagramRelationChangedField,
  type SemanticDiagramRelationDiff,
  serializeSchemaModule,
  serializeSemanticDiagramDiff,
  serializeSemanticDocument,
  serializeSemanticSourceDocument,
  typeSupportsRelationEndpoint,
  validateSchemaModuleObject,
} from '@tarskia/diagram-semantics';
export * from '../model/diagnostics';
export * from '../model/diagram-changelog';
export * from '../model/diagram-store';
export * from '../model/display-contract';
export * from '../model/document-commands';
export * from '../model/document-mutations';
export * from '../model/entity-display';
export * from '../model/entity-tree';
export * from '../model/history';
export * from '../model/personal-schema-registry';
export * from '../model/schema';
export * from '../model/schema-display';
export * from '../model/schema-editor-session-store';
export * from '../model/schema-ids';
export * from '../model/schema-ref';
export * from '../model/schema-reference';
export * from '../model/schema-runtime';
export * from '../model/schema-selection';
export * from '../model/source-graph';
export * from '../model/tags';
export * from '../model/types';
export * from '../model/validation';
export type {
  SchemaVersionCatalog,
  SchemaVersionCatalogEntry,
} from '../model/validation/schema-closure';
export {
  parseDocument,
  parseSourceDocument,
  serializeDocument,
  serializeSourceDocument,
} from '../util/serialization';
export * from './runtime';
export * from './tree';
export * from './view';
