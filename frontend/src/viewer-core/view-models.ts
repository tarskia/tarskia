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

export interface InspectorPropertyEntryView {
  path: string;
  label: string;
  value: string;
  href?: string;
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
  propertyEntries: InspectorPropertyEntryView[];
  provenance?: InspectorProvenanceView;
  selectedChildCount: number;
  canFocusView: boolean;
  isFocusedEntity: boolean;
  highlighted?: boolean;
  hasHighlights?: boolean;
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

/**
 * Supplies the semantic decisions needed by the top-level canvas controller so that the controller
 * no longer imports semantic helpers directly.
 */
export interface CanvasSemanticBindings {
  getEntityDisplayName: (entityId: string) => string;
  getEntityTypeLabel: (entityId: string) => string;
  getEntityFocusHue: (entityId: string) => number | undefined;
}
