export type SemanticVersion = string;
export type SchemaOwner = 'core' | 'gallery' | 'user';

export interface SchemaActivation {
  schema: string;
  layer: number;
}

export interface SemanticDocument {
  version: SemanticVersion;
  schemaRefs: SchemaActivation[];
  entities: Entity[];
  relations: Relation[];
  inputs?: DocumentInput[];
  view?: DiagramView;
  metadata?: {
    name?: string;
    description?: string;
    [key: string]: unknown;
  };
}

export interface SemanticSourceDocument extends SemanticDocument {
  imports?: SemanticSourceImport[];
}

export interface SemanticSourceImport {
  slug: string;
  namespace: string;
}

export interface DocumentInput {
  id: string;
  kind: 'git';
  repo: string;
  ref?: string;
  revision?: string;
  role?: 'primary' | 'secondary';
}

export interface DiagramView {
  kind: 'semantic-diagram-view';
  version: 2;
  scopeRootId?: string;
  nodesById?: Record<string, DiagramViewNodeState>;
  layout?: DocumentLayout;
}

export interface DiagramViewNodeState {
  expanded?: boolean;
  hidden?: boolean;
  highlighted?: boolean;
}

export interface DocumentLayout {
  viewport?: ViewportState;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface SchemaModule {
  owner: SchemaOwner;
  name: string;
  version: SemanticVersion;
  description?: string;
  use?: SchemaImport[];
  tags?: TagDef[];
  traits?: TraitDef[];
  types: EntityTypeDef[];
  relations: RelationTypeDef[];
  update?: Record<string, SchemaUpdate>;
  remove?: Record<string, string[]>;
}

export interface SchemaImport {
  schema: string;
  alias?: string;
}

export interface ResolvedSchemaObjectIdentity {
  localId?: string;
  qualifiedId?: string;
  originSchemaId?: string;
}

export interface SchemaUpdate {
  set?: Record<string, unknown>;
  add?: Record<string, unknown>;
  remove?: Record<string, unknown>;
}

export interface TagDef extends ResolvedSchemaObjectIdentity {
  id: string;
  label?: string;
  color?: string;
  description?: string;
}

export interface EntityTypeDef extends ResolvedSchemaObjectIdentity {
  id: string;
  label?: string;
  description?: string;
  extends?: string;
  traits?: string[];
  analysis?: EntityTypeAnalysisConfig;
  defaultTags?: string[];
  naming?: NamingConfig;
  containment?: ContainmentConfig;
  display?: DisplayConfig;
  properties?: PropertySchema[];
}

export type TopLevelBias = 'prefer' | 'neutral' | 'avoid';

export interface EntityTypeAnalysisConfig {
  topLevelBias?: TopLevelBias;
}

export interface NamingConfig {
  // Validation contract only. Rendering fallback behavior for nameless entities
  // is handled by projection (blank cards, "Unnamed <Type>" in list rows).
  required?: boolean;
}

export interface TraitDef extends ResolvedSchemaObjectIdentity {
  id: string;
  label: string;
  extends?: string;
  description?: string;
  relationParticipation?: TraitRelationParticipation[];
  analysis?: TraitAnalysisConfig;
}

export type TraitRelationEndpoint = 'from' | 'to' | 'both';

export interface TraitRelationParticipation {
  relation: string;
  endpoint: TraitRelationEndpoint;
}

export type TraitFlowType = 'source' | 'through' | 'sink';

export interface TraitAnalysisConfig {
  flowType?: TraitFlowType;
  mayTerminate?: boolean;
  expectedRelationIds?: string[];
}

export interface PropertySchema {
  id: string;
  label?: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object';
  values?: string[];
  allowOther?: boolean;
  properties?: PropertySchema[];
  description?: string;
  display?: PropertyDisplay;
}

export interface ContainmentConfig {
  allowedChildTypes?: string[];
  allowedChildTraits?: string[];
}

export interface DisplayConfig {
  primaryTag?: string;
  count?: DisplayCount;
  defaultSize?: {
    width: number;
    height: number;
  };
  content?: DisplayContentConfig;
  style?: {
    hue?: number;
  };
}

export interface DisplayContentConfig {
  kind: 'markdown' | 'image';
  bodyPath?: string;
  srcPath?: string;
  altPath?: string;
  captionPath?: string;
}

export interface DisplayCount {
  childTypes: string[];
  label: string;
  singularLabel?: string;
}

export interface PropertyDisplay {
  showIn?: 'card' | 'hidden';
  valuePath?: string;
  template?: string;
  priority?: number;
}

export type RelationFlowDirection = 'forward' | 'reverse';

export interface RelationDisplayConfig {
  flowDirection?: RelationFlowDirection;
}

export type RelationFulfillment = 'ingress' | 'egress';

export interface RelationFulfillmentConfig {
  from?: RelationFulfillment[];
  to?: RelationFulfillment[];
}

export interface RelationTypeDef extends ResolvedSchemaObjectIdentity {
  id: string;
  label: string;
  shortLabel?: string;
  priority?: number;
  directed?: boolean;
  display?: RelationDisplayConfig;
  defaultTags?: string[];
  analysis?: RelationTypeAnalysisConfig;
  properties?: PropertySchema[];
}

export interface RelationTypeAnalysisConfig {
  fulfills?: RelationFulfillmentConfig;
}

export interface Entity {
  id: string;
  type: string;
  name?: string;
  description?: string;
  tags?: string[];
  removeDefaultTags?: string[];
  replaceDefaultTags?: boolean;
  props?: Record<string, unknown>;
  provenance?: Provenance;
  children?: Entity[];
  parent?: string;
}

export interface Relation {
  id: string;
  type?: string;
  label?: string;
  description?: string;
  state?: 'undecided' | 'none';
  from: string;
  to: string;
  tags?: string[];
  removeDefaultTags?: string[];
  replaceDefaultTags?: boolean;
  props?: Record<string, unknown>;
  provenance?: Provenance;
}

export interface Provenance {
  confidence?: number;
  locations: ProvenanceLocation[];
}

export interface ProvenanceLocation {
  repo?: string;
  commit?: string;
  input?: string;
  path: string;
  symbol?: string;
  note?: string;
}

export type ValidationError = {
  message: string;
  entityId?: string;
  relationId?: string;
};
