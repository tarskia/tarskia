import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneTree } from '../canvas/rendering/tree/scene-tree';
import type { SemanticDocument } from '../semantic';
import { ensureDiagramView } from './diagram-view';
import type { CommitDoc } from './types';

type FocusTransitionTrigger = (
  entityId: string,
  direction: 'in' | 'out',
  options?: { onComplete?: () => void },
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
  const view = ensureDiagramView(previous.view);
  const nodesById = expandTarget
    ? {
        ...(view.nodesById ?? {}),
        [entityId]: {
          ...(view.nodesById?.[entityId] ?? {}),
          expanded: true,
        },
      }
    : view.nodesById;
  return {
    ...previous,
    view: {
      ...view,
      scopeRootId: entityId,
      nodesById,
    },
  };
};

export const buildClearFocusScopeDocument = (previous: SemanticDocument): SemanticDocument => ({
  ...previous,
  view: {
    ...ensureDiagramView(previous.view),
    scopeRootId: undefined,
  },
});

export const canFocusSceneNode = (params: { sceneTree: SceneTree; entityId: string }) => {
  const sceneNode = params.sceneTree.byId.get(params.entityId);
  return Boolean(sceneNode?.hasChildren && sceneNode.layoutMode !== 'list');
};

export function useFocusViewController({
  sceneTree,
  expanded,
  canvasSize,
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
  canvasSize?: { width: number; height: number } | null;
  skipTransitions?: boolean;
  showInspector: boolean;
  commitDoc: CommitDoc;
  flushUserGesture: () => boolean;
  triggerEntityZoom: FocusTransitionTrigger;
  setSelectedEntity: (id: string | undefined) => void;
  setSelectedEdge: (id: string | undefined) => void;
  onClearTransientFocusChrome?: () => void;
}) {
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
      commitDoc(
        (previous) =>
          buildFocusScopeDocument({
            previous,
            entityId,
            expandTarget,
          }),
        { undoable: false },
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
      if (!expanded[entityId]) {
        const queued = triggerEntityZoom(entityId, 'in', {
          onComplete: () => enterFocusScope(entityId),
        });
        if (!queued) {
          enterFocusScope(entityId);
        }
        onClearTransientFocusChrome?.();
        return;
      }
      enterFocusScope(entityId);
    },
    [
      enterFocusScope,
      expanded,
      flushUserGesture,
      onClearTransientFocusChrome,
      skipTransitions,
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
    void pendingFocusWaitTick;
    const pendingFocusRequest = pendingFocusRequestRef.current;
    if (!pendingFocusRequest) {
      return;
    }
    const currentCanvasWidth = canvasSize?.width ?? null;
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
    canvasSize?.width,
    cancelPendingFocusFrame,
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
        previousCanvasWidth: canvasSize?.width ?? null,
        waitFrames: 0,
      };
      setPendingFocusWaitTick((current) => current + 1);
      return true;
    },
    [
      canvasSize?.width,
      clearPendingFocusRequest,
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
    commitDoc(buildClearFocusScopeDocument, { undoable: false });
    onClearTransientFocusChrome?.();
  }, [clearPendingFocusRequest, commitDoc, flushUserGesture, onClearTransientFocusChrome]);

  return {
    clearFocus,
    focusViewOnEntity,
  };
}
