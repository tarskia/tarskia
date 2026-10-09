import {
  applyDiagramViewOperation,
  buildEntityTree,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneTree } from '../canvas/rendering/tree/scene-tree';
import type { GetCurrentCanvasSize } from '../diagram/canvas-size';
import type { MotionCallbacks } from '../diagram/motion-types';
import type { CommitDoc } from './types';

type FocusTransitionTrigger = (
  entityId: string,
  direction: 'in' | 'out',
  options?: MotionCallbacks & { expandSingleChildChain?: boolean },
) => boolean;

const scheduleFocusFrame = (callback: FrameRequestCallback) => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(
    () => callback(typeof performance === 'undefined' ? Date.now() : performance.now()),
    0,
  ) as unknown as number;
};

const cancelFocusFrame = (frameId: number) => {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameId);
    return;
  }
  globalThis.clearTimeout(frameId as unknown as ReturnType<typeof globalThis.setTimeout>);
};

const CANVAS_RESIZE_EPSILON = 0.5;
const FOCUS_CANVAS_RESIZE_FALLBACK_FRAMES = 30;

interface PendingFocusRequest {
  entityId: string;
  previousCanvasWidth: number | null;
  waitFrames: number;
}

export const shouldRunPendingFocusAfterInspectorClose = (params: {
  showInspector: boolean;
  previousCanvasWidth: number | null;
  currentCanvasWidth: number | null;
  waitFrames: number;
}) => {
  const { showInspector, previousCanvasWidth, currentCanvasWidth, waitFrames } = params;
  if (showInspector) {
    return false;
  }
  if (previousCanvasWidth === null) {
    return true;
  }
  if (
    currentCanvasWidth !== null &&
    currentCanvasWidth > previousCanvasWidth + CANVAS_RESIZE_EPSILON
  ) {
    return true;
  }
  return waitFrames >= FOCUS_CANVAS_RESIZE_FALLBACK_FRAMES;
};

export const buildFocusScopeDocument = (params: {
  previous: SemanticDocument;
  entityId: string;
  expandTarget: boolean;
}): SemanticDocument => {
  const { previous, entityId, expandTarget } = params;
  const view = applyDiagramViewOperation(buildEntityTree(previous), previous.view, {
    kind: 'enter-focus',
    entityId,
    expandTarget,
  });
  return view === previous.view ? previous : { ...previous, view };
};

export const buildClearFocusScopeDocument = (previous: SemanticDocument): SemanticDocument => {
  const view = applyDiagramViewOperation(buildEntityTree(previous), previous.view, {
    kind: 'clear-focus',
  });
  return view === previous.view ? previous : { ...previous, view };
};

export const canFocusSceneNode = (params: { sceneTree: SceneTree; entityId: string }) => {
  const sceneNode = params.sceneTree.byId.get(params.entityId);
  // List containers also support focus; capability must not depend on expanded layout.
  return Boolean(sceneNode?.hasChildren);
};

export function useFocusViewController({
  sceneTree,
  getCurrentCanvasSize,
  canvasLayoutVersion = 0,
  skipTransitions = false,
  showInspector,
  commitDoc,
  flushUserGesture,
  triggerEntityZoom,
  setSelectedEntity,
  setSelectedEdge,
  onClearTransientFocusChrome,
}: {
  sceneTree: SceneTree;
  expanded: Record<string, boolean>;
  getCurrentCanvasSize?: GetCurrentCanvasSize;
  canvasLayoutVersion?: number;
  skipTransitions?: boolean;
  showInspector: boolean;
  commitDoc: CommitDoc;
  flushUserGesture: () => boolean;
  triggerEntityZoom: FocusTransitionTrigger;
  setSelectedEntity: (id: string | undefined) => void;
  setSelectedEdge: (id: string | undefined) => void;
  onClearTransientFocusChrome?: () => void;
}) {
  const latestSceneTreeRef = useRef(sceneTree);
  latestSceneTreeRef.current = sceneTree;
  const [pendingFocusWaitTick, setPendingFocusWaitTick] = useState(0);
  const pendingFocusRequestRef = useRef<PendingFocusRequest | null>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);

  const cancelPendingFocusFrame = useCallback(() => {
    if (pendingFocusFrameRef.current === null) {
      return;
    }
    cancelFocusFrame(pendingFocusFrameRef.current);
    pendingFocusFrameRef.current = null;
  }, []);

  const clearPendingFocusRequest = useCallback(() => {
    pendingFocusRequestRef.current = null;
    cancelPendingFocusFrame();
  }, [cancelPendingFocusFrame]);

  useEffect(() => clearPendingFocusRequest, [clearPendingFocusRequest]);

  const enterFocusScope = useCallback(
    (entityId: string, expandTarget = false) => {
      commitDoc((previous) =>
        buildFocusScopeDocument({
          previous,
          entityId,
          expandTarget,
        }),
      );
      onClearTransientFocusChrome?.();
    },
    [commitDoc, onClearTransientFocusChrome],
  );

  const runFocusViewOnEntity = useCallback(
    (entityId: string) => {
      flushUserGesture();
      if (skipTransitions) {
        enterFocusScope(entityId, true);
        return;
      }
      const sourceEntity = sceneTree.byId.get(entityId)?.entity;
      const queued = triggerEntityZoom(entityId, 'in', {
        expandSingleChildChain: true,
        onSettled: () => {
          // A cancelled plan from a replaced document must not focus its old entity.
          if (latestSceneTreeRef.current.byId.get(entityId)?.entity === sourceEntity) {
            enterFocusScope(entityId);
          }
        },
      });
      if (queued) {
        onClearTransientFocusChrome?.();
        return;
      }
      enterFocusScope(entityId);
    },
    [
      enterFocusScope,
      flushUserGesture,
      onClearTransientFocusChrome,
      skipTransitions,
      sceneTree,
      triggerEntityZoom,
    ],
  );

  const requestPendingFocusRecheck = useCallback(() => {
    cancelPendingFocusFrame();
    pendingFocusFrameRef.current = scheduleFocusFrame(() => {
      pendingFocusFrameRef.current = null;
      const pendingFocusRequest = pendingFocusRequestRef.current;
      if (!pendingFocusRequest) {
        return;
      }
      pendingFocusRequest.waitFrames += 1;
      setPendingFocusWaitTick((current) => current + 1);
    });
  }, [cancelPendingFocusFrame]);

  useEffect(() => {
    // The version is a resize signal; current dimensions are read from the getter below.
    void canvasLayoutVersion;
    void pendingFocusWaitTick;
    const pendingFocusRequest = pendingFocusRequestRef.current;
    if (!pendingFocusRequest) {
      return;
    }
    const currentCanvasWidth = getCurrentCanvasSize?.()?.width ?? null;
    const readyToFocus = shouldRunPendingFocusAfterInspectorClose({
      showInspector,
      previousCanvasWidth: pendingFocusRequest.previousCanvasWidth,
      currentCanvasWidth,
      waitFrames: pendingFocusRequest.waitFrames,
    });
    if (!readyToFocus) {
      requestPendingFocusRecheck();
      return;
    }
    cancelPendingFocusFrame();
    pendingFocusRequestRef.current = null;
    pendingFocusFrameRef.current = scheduleFocusFrame(() => {
      pendingFocusFrameRef.current = null;
      runFocusViewOnEntity(pendingFocusRequest.entityId);
    });
  }, [
    canvasLayoutVersion,
    cancelPendingFocusFrame,
    getCurrentCanvasSize,
    pendingFocusWaitTick,
    requestPendingFocusRecheck,
    runFocusViewOnEntity,
    showInspector,
  ]);

  const focusViewOnEntity = useCallback(
    (entityId: string) => {
      if (!canFocusSceneNode({ sceneTree, entityId })) {
        return false;
      }
      clearPendingFocusRequest();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      onClearTransientFocusChrome?.();
      if (!showInspector) {
        runFocusViewOnEntity(entityId);
        return true;
      }
      pendingFocusRequestRef.current = {
        entityId,
        previousCanvasWidth: getCurrentCanvasSize?.()?.width ?? null,
        waitFrames: 0,
      };
      setPendingFocusWaitTick((current) => current + 1);
      return true;
    },
    [
      clearPendingFocusRequest,
      getCurrentCanvasSize,
      onClearTransientFocusChrome,
      runFocusViewOnEntity,
      sceneTree,
      setSelectedEdge,
      setSelectedEntity,
      showInspector,
    ],
  );

  const clearFocus = useCallback(() => {
    clearPendingFocusRequest();
    flushUserGesture();
    commitDoc(buildClearFocusScopeDocument);
    onClearTransientFocusChrome?.();
  }, [clearPendingFocusRequest, commitDoc, flushUserGesture, onClearTransientFocusChrome]);

  return {
    clearFocus,
    focusViewOnEntity,
  };
}
