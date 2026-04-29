/**
 * Presentation view models adapt semantic data into UI-safe shapes.
 * UI components should consume these instead of importing semantic helpers directly.
 */
export interface DiagnosticView {
  domain: 'schema' | 'diagram';
  phase: 'parse' | 'shape' | 'semantic' | 'resolution' | 'document';
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  hint?: string;
  moduleId?: string;
  selector?: string;
  targetId?: string;
  entityId?: string;
  relationId?: string;
  source?: {
    keyword?: string;
    schemaPath?: string;
    instancePath?: string;
  };
}

export interface TagBadgeView {
  id: string;
  label: string;
  color?: string;
  description?: string;
}

export interface SchemaOptionView {
  id: string;
  label: string;
  ownerLabel?: string;
  version?: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  inUseReason?: string;
  blockedReason?: string;
  statusTitle?: string;
}

export interface PaletteTypeDetailLine {
  label: string;
  value: string;
}

export interface PaletteTypeView {
  id: string;
  displayLabel: string;
  schemaId: string;
  schemaLabel: string;
  hue?: number;
  description?: string;
  detailLines: PaletteTypeDetailLine[];
}

export interface PaletteSchemaTabView {
  id: string;
  label: string;
  count: number;
}

/**
 * Keeps the palette presentational. The shell prepares labels, groupings, and type detail strings.
 */
export interface PaletteViewModel {
  schemaTabs: PaletteSchemaTabView[];
  types: PaletteTypeView[];
}

export interface InspectorPropertyFieldView {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object';
  values?: string[];
  allowOther?: boolean;
}

export interface InspectorPropertyEntryView {
  path: string;
  label: string;
  value: string;
  href?: string;
}

export interface InspectorStructureOptionView {
  id: string;
  label: string;
}

export interface InspectorProvenanceLocationView {
  path: string;
  symbol?: string;
  note?: string;
  permalink?: string;
}

export interface InspectorProvenanceView {
  confidence?: number;
  locations: InspectorProvenanceLocationView[];
}

export interface DiagramProvenanceSourceView {
  repo?: string;
  commit?: string;
}

export interface InspectorEntityViewModel {
  kind: 'entity';
  entityId: string;
  name?: string;
  description?: string;
  displayName: string;
  typeLabel: string;
  typeHue?: number;
  displayedTags: TagBadgeView[];
  explicitTagIds: string[];
  derivedTagLabels: string[];
  availableTagOptions: Array<{ id: string; label: string }>;
  propertyEntries: InspectorPropertyEntryView[];
  propertyFields: InspectorPropertyFieldView[];
  provenance?: InspectorProvenanceView;
  selectedChildCount: number;
  canFocusView: boolean;
  isFocusedEntity: boolean;
  childTypeOptions: InspectorStructureOptionView[];
  siblingTypeOptions: InspectorStructureOptionView[];
  currentParentId?: string;
  currentParentLabel: string;
  moveParentOptions: InspectorStructureOptionView[];
}

export interface InspectorRelationViewModel {
  kind: 'relation';
  relationId: string;
  relationLabel: string;
  description?: string;
  sourceLabel: string;
  targetLabel: string;
  displayedTags: TagBadgeView[];
  propertyEntries: InspectorPropertyEntryView[];
  provenance?: InspectorProvenanceView;
}

export interface InspectorEmptyViewModel {
  kind: 'empty';
}

/**
 * Keeps the inspector presentational. The shell prepares all semantic labels, options, and badges.
 */
export type InspectorViewModel =
  | InspectorEntityViewModel
  | InspectorRelationViewModel
  | InspectorEmptyViewModel;

export interface CanvasTypeOptionView {
  id: string;
  label: string;
}

export interface CanvasEntityOptionView {
  id: string;
  label: string;
}

export interface CanvasRelationOptionView {
  id: string;
  label: string;
}

/**
 * Supplies the semantic decisions needed by the top-level canvas controller so that the controller
 * no longer imports semantic helpers directly.
 */
export interface CanvasSemanticBindings {
  getEntityDisplayName: (entityId: string) => string;
  getEntityTypeLabel: (entityId: string) => string;
  getEntityFocusHue: (entityId: string) => number | undefined;
  listCandidateTypes: (sourceId: string) => CanvasTypeOptionView[];
  listCandidateEntities: (sourceId: string) => CanvasEntityOptionView[];
  listRelationOptions: (edgeId: string) => CanvasRelationOptionView[];
  createRelation: (from: string, to: string) => void;
  createRelatedEntity: (
    sourceId: string,
    typeId: string,
    requestedName?: string,
  ) => string | undefined;
  setRelationType: (
    edgeId: string,
    type?: string,
    label?: string,
    state?: 'undecided' | 'none',
  ) => void;
  applyRelationOption: (edgeId: string, option: { id: string }) => void;
}
