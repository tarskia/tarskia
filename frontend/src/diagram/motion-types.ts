import type { LayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import type { LayoutTree } from '../canvas/rendering/layout/tree-traverser';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
import type { TransitionPlanningAdvisory } from '../canvas/rendering/transition/sequencer';
import type {
  TimedTransitionPlan,
  TimedTransitionSequence,
} from '../canvas/rendering/transition/timed-plan';
import type { ViewportState } from '../model/types';

export type DiagramCameraRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CameraExecutionMode = 'immediate' | 'animated';

export type FitSceneNavigationPreset = 'default' | 'layout' | 'search-reveal';
export type FitNodeSetNavigationPreset = 'default' | 'focus';
export type EnsureVisibleNavigationPreset = 'default' | 'selection';

export interface DiagramCameraPolicy {
  openingMode?: CameraExecutionMode;
}

export type StructuralTransitionFocus =
  | { kind: 'single'; rootId: string }
  | { kind: 'local'; rootId: string }
  | { kind: 'global' };

export interface StructuralTransitionIntent {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  allowNonExpansionViewChanges?: boolean;
  onComplete?: () => void;
}

interface NavigationIntentBase {
  mode?: CameraExecutionMode;
  duration?: number;
  persist?: boolean;
  waitForHostSettle?: boolean;
  deferUntilNextFrame?: boolean;
}

export type NavigationIntent =
  | (NavigationIntentBase & {
      kind: 'initialize-diagram';
    })
  | (NavigationIntentBase & {
      kind: 'fit-scene';
      preset?: FitSceneNavigationPreset;
    })
  | (NavigationIntentBase & {
      kind: 'fit-rect';
      rect: DiagramCameraRect;
      preset?: FitNodeSetNavigationPreset;
    })
  | (NavigationIntentBase & {
      kind: 'fit-node-set';
      nodeIds: string[];
      preset?: FitNodeSetNavigationPreset;
    })
  | (NavigationIntentBase & {
      kind: 'ensure-visible';
      rect: DiagramCameraRect;
      preset?: EnsureVisibleNavigationPreset;
      padding?: number;
    })
  | (NavigationIntentBase & {
      kind: 'restore-saved';
    });

export type NavigationRequestResult =
  | {
      status: 'queued';
      reason: 'deferred-frame' | 'pending-motion' | 'motion-plan';
    }
  | {
      status: 'applied';
      reason: 'synchronous';
    }
  | {
      status: 'noop';
      reason: 'no-target' | 'same-viewport';
    }
  | {
      status: 'unavailable';
      reason: 'missing-canvas';
    };

export interface CameraTrack {
  from: ViewportState;
  to: ViewportState;
}

export interface OverlayMotionTrack {
  incomingSnapshot: CanvasRenderSnapshot;
  planningAdvisory: TransitionPlanningAdvisory;
  timedPlan: TimedTransitionPlan;
  timedSequence: TimedTransitionSequence;
  phaseWindow?: { start: number; end: number };
  sharedNodeGeometry?: 'freeze-from';
}

export interface MotionSegment {
  durationMs: number;
  camera?: CameraTrack;
  overlay?: OverlayMotionTrack;
  hostSnapshot?: CanvasRenderSnapshot;
  waitForHostGeneration?: boolean;
}

export interface MotionPlan {
  segments: MotionSegment[];
  sourceSnapshot?: CanvasRenderSnapshot;
  targetSnapshot?: CanvasRenderSnapshot;
  persistFinalViewport?: boolean;
}

export interface StructuralChoreographyRequest {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  startLayout: LayoutResult;
  endLayout: LayoutResult;
  startSnapshot: CanvasRenderSnapshot;
  endSnapshot: CanvasRenderSnapshot;
  currentViewport: ViewportState;
  endPointOfInterestNodeIds: string[];
  pauseBeforeOverlayMs?: number;
  pauseAfterOverlayMs?: number;
  exitScopeRetainedNodeIds?: string[];
  postOverlayViewportBridgeNodeIds?: string[];
  sharedNodeGeometry?: 'freeze-from';
  collectSubtreeIds: (tree: LayoutTree, rootId: string) => Set<string>;
  planningAdvisory: TransitionPlanningAdvisory;
  persistFinalViewport?: boolean;
}

export type MotionPhase = 'idle' | 'animating' | 'settling' | 'userGesture';
