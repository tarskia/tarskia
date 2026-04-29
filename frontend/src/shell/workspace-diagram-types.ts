import type { AnimationSettings } from '../diagram/animation-settings';
import type { NavigationIntent, StructuralTransitionIntent } from '../diagram/motion-types';
import type { NodeVisualMode } from '../node-visual-mode';
import type {
  Entity,
  EntityIndex,
  SchemaModule,
  SchemaRuntime,
  SemanticDocument,
} from '../semantic';
import type { CommitDoc } from './types';
import type { SchemaOptionView } from './view-models';

export interface WorkspaceDiagramSearchMatches {
  matchingEntityIds: Set<string>;
  matchingRelationIds: Set<string>;
}

export interface WorkspaceDiagramModel {
  doc: SemanticDocument;
  viewportSessionKey: string;
  schema: SchemaModule;
  schemaRuntime: SchemaRuntime;
  entityIndex: EntityIndex;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  focusRootId?: string;
  searchMatches?: WorkspaceDiagramSearchMatches;
  nodeVisualMode: NodeVisualMode;
  showDebug: boolean;
  animationSettings: AnimationSettings;
  skipTransitions: boolean;
  showInspector: boolean;
  availableSchemas: SchemaOptionView[];
  onToggleSchema: (schemaRef: string) => void;
  canContainEntity: (parent: Entity, childType: string) => boolean;
  resolveDefaultEntityName: (
    typeId: string,
    requestedName: string | undefined,
    existingCount: number,
  ) => string | undefined;
  commitDoc: CommitDoc;
  setSelectedEntity: (id: string | undefined) => void;
  setSelectedEdge: (id: string | undefined) => void;
  traceSelection: (event: string, payload?: Record<string, unknown>) => void;
}

export interface WorkspaceDiagramRuntimeHandle {
  requestNavigation: (intent: NavigationIntent) => void;
  flushUserGesture: () => boolean;
  setPendingStructuralTransitionIntent: (intent: StructuralTransitionIntent | null) => void;
  cancelTransitions: () => void;
  clearTransientState: () => void;
  addEntityFromPalette: (typeId: string) => void;
}
