import type { ViewportState } from '@tarskia/diagram-semantics';
import type { LayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import type { CanvasRenderSnapshot } from '../canvas/rendering/presentation/presentation';
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

export type StructuralTransitionFocus =
  | { kind: 'single'; rootId: string }
  | { kind: 'local'; rootId: string }
  | { kind: 'global' };

export type MotionSettlementReason = 'completed' | 'superseded' | 'cancelled' | 'gesture';

export interface MotionCallbacks {
  onComplete?: () => void;
  onSettled?: (reason: MotionSettlementReason) => void;
}

export interface StructuralTransitionIntent extends MotionCallbacks {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  allowNonExpansionViewChanges?: boolean;
}

interface NavigationIntentBase {
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
      kind: 'fit-node-set';
      nodeIds: string[];
      preset?: FitNodeSetNavigationPreset;
    })
  | (NavigationIntentBase & {
      kind: 'ensure-visible';
      rect: DiagramCameraRect;
      preset?: EnsureVisibleNavigationPreset;
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

export interface MotionPlan {
  camera?: CameraTrack;
  cameraDuration: number;
  structureDuration: number;
  settleDuration: number;
  sourceSnapshot?: CanvasRenderSnapshot;
  targetSnapshot?: CanvasRenderSnapshot;
}
export interface StructuralChoreographyRequest {
  direction: 'in' | 'out';
  focus: StructuralTransitionFocus | null;
  endLayout: LayoutResult;
  startSnapshot: CanvasRenderSnapshot;
  endSnapshot: CanvasRenderSnapshot;
  currentViewport: ViewportState;
  endPointOfInterestNodeIds: string[];
}
export type MotionPhase = 'idle' | 'animating' | 'settling' | 'userGesture';
