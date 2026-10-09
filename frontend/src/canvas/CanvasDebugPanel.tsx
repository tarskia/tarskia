import type { SemanticIndex } from '@tarskia/diagram-semantics';
import { useEffect, useMemo } from 'react';
import type { GetCurrentCanvasSize } from '../diagram/canvas-size';
import { FlowDebugPanel } from '../ui/FlowDebugPanel';
import type { CanvasViewport } from './camera';
import { resolveCachedEdgeOverlayRenderState } from './components/edges/edge-overlay-state';
import type { buildCanvasRenderState } from './node-presentation';
import type { LayoutResult } from './rendering/layout/layout-pipeline';
import type { CanvasPresentation } from './rendering/presentation/presentation';

export interface CanvasDebugInputs {
  graph: SemanticIndex;
  compiled: LayoutResult;
  hostRenderState: ReturnType<typeof buildCanvasRenderState>;
  decoratedPresentation: CanvasPresentation;
  presentation: CanvasPresentation;
  canvasLayoutVersion: number;
  getCurrentCanvasSize: GetCurrentCanvasSize;
  getCurrentViewport: () => CanvasViewport;
  isTransitionQueued: boolean;
  isTransitionRunning: boolean;
  selectedEdgeId?: string;
}
const formatDebugPoint = (point: { x: number; y: number }) =>
  `${Math.round(point.x)},${Math.round(point.y)}`;

const formatDebugRect = (rect: { x: number; y: number; width: number; height: number }) =>
  `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;

export default function CanvasDebugPanel({
  graph,
  compiled,
  hostRenderState,
  decoratedPresentation,
  presentation,
  canvasLayoutVersion,
  getCurrentCanvasSize,
  getCurrentViewport,
  isTransitionQueued,
  isTransitionRunning,
  selectedEdgeId,
}: CanvasDebugInputs) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const debugWindow = window as Window & {
      __TARSKIA_EDGE_OVERLAY_DEBUG__?: unknown;
    };
    const overlayRenderState = resolveCachedEdgeOverlayRenderState(
      presentation,
      hostRenderState.overlayEdges,
    );
    const selectedEdgeTrace =
      selectedEdgeId === undefined
        ? null
        : (overlayRenderState.edges.find(
            (edge) =>
              edge.id === selectedEdgeId ||
              edge.relationId === selectedEdgeId ||
              (edge.relationIds ?? []).includes(selectedEdgeId),
          ) ?? null);
    debugWindow.__TARSKIA_EDGE_OVERLAY_DEBUG__ = {
      selectedEdgeId,
      overlayRenderState,
      selectedEdgeTrace,
    };
    return () => {
      delete debugWindow.__TARSKIA_EDGE_OVERLAY_DEBUG__;
    };
  }, [hostRenderState, selectedEdgeId, presentation]);

  const debugSummary = useMemo(() => {
    // Keep debug geometry current without storing canvas dimensions in React state.
    void canvasLayoutVersion;
    const allIds = graph.entities.map((entity) => entity.id);
    const layoutIds = compiled.visibleIds;
    const renderedIds = new Set(hostRenderState.nodes.map((node) => node.id));
    const overlayEdges = decoratedPresentation.overlayEdges.length;
    const missingLayout = allIds.filter((id) => !layoutIds.has(id));
    const missingVisible = missingLayout;
    const missingRendered = allIds.filter((id) => !renderedIds.has(id));

    const topLevelNodes = decoratedPresentation.nodes.filter((node) => !node.parentId);
    const topLevelPositions = topLevelNodes.map((node) => {
      const x = node.rect.x;
      const y = node.rect.y;
      const width = node.rect.width;
      const height = node.rect.height;
      return `${node.id}(${Math.round(x)},${Math.round(y)},${Math.round(width)}x${Math.round(height)})`;
    });

    let topBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const node of topLevelNodes) {
      const x = node.rect.x;
      const y = node.rect.y;
      const width = node.rect.width;
      const height = node.rect.height;
      if (!topBounds) {
        topBounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
      } else {
        topBounds.minX = Math.min(topBounds.minX, x);
        topBounds.minY = Math.min(topBounds.minY, y);
        topBounds.maxX = Math.max(topBounds.maxX, x + width);
        topBounds.maxY = Math.max(topBounds.maxY, y + height);
      }
    }

    const viewRect = (() => {
      const viewport = getCurrentViewport();
      const canvasSize = getCurrentCanvasSize();
      if (!canvasSize || !viewport) return null;
      const minX = -viewport.x / viewport.zoom;
      const minY = -viewport.y / viewport.zoom;
      const maxX = (-viewport.x + canvasSize.width) / viewport.zoom;
      const maxY = (-viewport.y + canvasSize.height) / viewport.zoom;
      return { minX, minY, maxX, maxY };
    })();

    const overflowParents = new Set<string>();
    const rectById = new Map(decoratedPresentation.nodes.map((node) => [node.id, node.rect]));
    for (const node of decoratedPresentation.nodes) {
      if (!node.parentId) continue;
      const parentRect = rectById.get(node.parentId);
      if (!parentRect) continue;
      const x = node.rect.x - parentRect.x;
      const y = node.rect.y - parentRect.y;
      if (
        x < 0 ||
        y < 0 ||
        x + node.rect.width > parentRect.width ||
        y + node.rect.height > parentRect.height
      ) {
        overflowParents.add(node.parentId);
      }
    }

    const transitionActive = isTransitionRunning || isTransitionQueued;
    const overlayRenderState = resolveCachedEdgeOverlayRenderState(
      presentation,
      hostRenderState.overlayEdges,
    );
    const selectedResolvedEdge =
      selectedEdgeId === undefined
        ? null
        : (overlayRenderState.edges.find(
            (edge) =>
              edge.id === selectedEdgeId ||
              edge.relationId === selectedEdgeId ||
              (edge.relationIds ?? []).includes(selectedEdgeId),
          ) ?? null);
    return {
      total: graph.entities.length,
      layout: layoutIds.size,
      visible: layoutIds.size,
      rendered: decoratedPresentation.nodes.length,
      overlayEdges,
      transitionActive,
      missingLayout,
      missingVisible,
      missingRendered,
      topLevelPositions,
      topBounds,
      viewRect,
      overflowParents: Array.from(overflowParents),
      selectedEdgeTrace: selectedResolvedEdge
        ? {
            id: selectedResolvedEdge.id,
            relationId: selectedResolvedEdge.relationId,
            relationIds: selectedResolvedEdge.relationIds,
            kind: selectedResolvedEdge.kind,
            sourceId: selectedResolvedEdge.sourceId,
            targetId: selectedResolvedEdge.targetId,
            scopeId: selectedResolvedEdge.scopeId,
            opacity: selectedResolvedEdge.opacity,
            sourceSide: selectedResolvedEdge.geometry.sourceSide,
            targetSide: selectedResolvedEdge.geometry.targetSide,
            sourcePoint: formatDebugPoint(selectedResolvedEdge.geometry.sourcePoint),
            targetPoint: formatDebugPoint(selectedResolvedEdge.geometry.targetPoint),
            solidOverNodeIds: selectedResolvedEdge.solidOverNodeIds,
            shellOccluderCount: overlayRenderState.shellOccluders.length,
            contentOccluderCount: overlayRenderState.contentOccluders.length,
            blockerOccluderCount: selectedResolvedEdge.blockerOccluders.length,
            blockerOccluders: selectedResolvedEdge.blockerOccluders.map(formatDebugRect),
            passes: {
              solid: true,
              blocked: selectedResolvedEdge.blockerOccluders.length > 0,
            },
          }
        : null,
    };
  }, [
    graph.entities,
    compiled.visibleIds,
    hostRenderState.nodes,
    decoratedPresentation.nodes,
    decoratedPresentation.overlayEdges.length,
    canvasLayoutVersion,

    getCurrentCanvasSize,
    isTransitionQueued,
    isTransitionRunning,
    getCurrentViewport,
    hostRenderState,
    selectedEdgeId,
    presentation,
  ]);

  return <FlowDebugPanel show summary={debugSummary} />;
}
