import type { DragEventHandler, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  type Node,
  type NodeTypes,
  type OnMove,
  type OnMoveStart,
  type OnNodesChange,
  type ReactFlowInstance,
} from 'reactflow';

import type { NodeVisualMode } from '../node-visual-mode';
import type {
  CanvasEntityOptionView,
  CanvasRelationOptionView,
  CanvasTypeOptionView,
} from '../shell/view-models';
import { type DebugSummary, FlowDebugPanel } from '../ui/FlowDebugPanel';
import { CanvasFocusShellOverlay } from './CanvasFocusShellOverlay';
import {
  EdgeOverlay,
  type EdgeOverlayDraftConnection,
  type EdgeOverlayInteractionBindings,
} from './components/edges/EdgeOverlay';
import { TransitionOverlay } from './components/transition/TransitionOverlay';
import type { ReactFlowHostNodeData } from './host/reactflow/types';
import { scheduleHotReloadSafeUnmount } from './hot-reload-unmount';
import type { CanvasOverlayEdgeView } from './rendering/presentation/presentation';
import type {
  TransitionOverlayFrame,
  TransitionOverlayState,
} from './rendering/transition/overlay';

const EMPTY_FLOW_EDGES: never[] = [];

export interface EdgeSearchState {
  sourceId: string;
  x: number;
  y: number;
  query: string;
}

export interface EdgeMenuState {
  edgeId: string;
  x: number;
  y: number;
  query: string;
}

export interface DiagramCanvasProps {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  onCanvasElementChange?: (element: HTMLDivElement | null) => void;
  defaultViewport?: { x: number; y: number; zoom: number };
  hidden?: boolean;
  leftOcclusion?: number;
  onLeftOcclusionChange?: (leftOcclusion: number) => void;
  readOnly?: boolean;
  nodeVisualMode: NodeVisualMode;
  hideHostVisuals: boolean;
  onDrop: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  nodes: Node[];
  overlayEdges: CanvasOverlayEdgeView[];
  overlayInteractionBindings?: EdgeOverlayInteractionBindings;
  draftConnection?: EdgeOverlayDraftConnection | null;
  transitionOverlay?: TransitionOverlayState;
  transitionOverlayFrame?: TransitionOverlayFrame;
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange;
  onNodeClick: (_event: unknown, node: Node) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  onInit: (instance: ReactFlowInstance) => void;
  onUnmount?: () => void;
  onNodesDelete: (nodes: Node[]) => void;
  onPaneClick: () => void;
  onMoveStart: OnMoveStart;
  onMove: OnMove;
  onMoveEnd: OnMove;
  minZoom: number;
  maxZoom: number;
  showDebug: boolean;
  debugSummary: DebugSummary | null;
  edgeSearch: EdgeSearchState | null;
  edgeSearchInputRef: MutableRefObject<HTMLInputElement | null>;
  setEdgeSearch: (value: SetStateAction<EdgeSearchState | null>) => void;
  filteredTypes: CanvasTypeOptionView[];
  filteredEntities: CanvasEntityOptionView[];
  onCreateFromType: (typeId: string) => void;
  onLinkEntity: (targetId: string) => void;
  edgeMenu: EdgeMenuState | null;
  edgeMenuInputRef: MutableRefObject<HTMLInputElement | null>;
  setEdgeMenu: (value: SetStateAction<EdgeMenuState | null>) => void;
  filteredEdgeOptions: CanvasRelationOptionView[];
  onSetRelationType: (
    edgeId: string,
    type?: string,
    label?: string,
    state?: 'undecided' | 'none',
  ) => void;
  onApplyRelationOption: (edgeId: string, option: { id: string }) => void;
  onSelectFocusShell?: (id: string) => void;
  focusShells?: Array<{
    id: string;
    depth: number;
    displayName: string;
    typeLabel: string;
    hue?: number;
    isRoot?: boolean;
    frame: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  }>;
}

export function DiagramCanvas({
  canvasRef,
  onCanvasElementChange,
  defaultViewport,
  hidden = false,
  leftOcclusion = 0,
  onLeftOcclusionChange,
  readOnly = false,
  nodeVisualMode,
  hideHostVisuals,
  onDrop,
  onDragOver,
  nodes,
  overlayEdges,
  overlayInteractionBindings,
  draftConnection,
  transitionOverlay,
  transitionOverlayFrame,
  nodeTypes,
  onNodesChange,
  onNodeClick,
  onNodeContextMenu,
  onInit,
  onUnmount,
  onNodesDelete,
  onPaneClick,
  onMoveStart,
  onMove,
  onMoveEnd,
  minZoom,
  maxZoom,
  showDebug,
  debugSummary,
  edgeSearch,
  edgeSearchInputRef,
  setEdgeSearch,
  filteredTypes,
  filteredEntities,
  onCreateFromType,
  onLinkEntity,
  edgeMenu,
  edgeMenuInputRef,
  setEdgeMenu,
  filteredEdgeOptions,
  onSetRelationType,
  onApplyRelationOption,
  onSelectFocusShell,
  focusShells,
}: DiagramCanvasProps) {
  const overlayNodes = nodes as Node<ReactFlowHostNodeData>[];
  const unmountEffectGenerationRef = useRef(0);

  const handleCanvasElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      canvasRef.current = element;
      onCanvasElementChange?.(element);
    },
    [canvasRef, onCanvasElementChange],
  );

  useLayoutEffect(() => {
    onLeftOcclusionChange?.(leftOcclusion);
  }, [leftOcclusion, onLeftOcclusionChange]);

  useEffect(() => {
    const effectGeneration = unmountEffectGenerationRef.current + 1;
    unmountEffectGenerationRef.current = effectGeneration;

    return () => {
      // Fast Refresh tears down effects before re-running them, but ReactFlow does not reliably
      // re-fire onInit in that path. Defer the cleanup and cancel it if a replacement effect
      // installs immediately so dev reloads do not strand the motion manager in "canvas unmounted".
      scheduleHotReloadSafeUnmount({
        onUnmount,
        effectGeneration,
        getCurrentEffectGeneration: () => unmountEffectGenerationRef.current,
      });
    };
  }, [onUnmount]);

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: The canvas root intentionally accepts drag-and-drop interactions. */
    <div
      ref={handleCanvasElementRef}
      className={`canvas h-full w-full canvas-visual-${nodeVisualMode}${hideHostVisuals ? ' canvas-host-hidden' : ''}${hidden ? ' invisible' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {focusShells && focusShells.length > 0 ? (
        <CanvasFocusShellOverlay
          shells={focusShells}
          leftOcclusion={leftOcclusion}
          onSelectShell={onSelectFocusShell}
        />
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={EMPTY_FLOW_EDGES}
        nodeTypes={nodeTypes}
        defaultViewport={defaultViewport}
        onlyRenderVisibleElements={false}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onInit={onInit}
        onNodesDelete={onNodesDelete}
        onPaneClick={onPaneClick}
        onMoveStart={onMoveStart}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        nodesDraggable={false}
        nodesConnectable={!readOnly}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        minZoom={minZoom}
        maxZoom={maxZoom}
        preventScrolling
        zoomOnPinch
        zoomOnScroll
        noWheelClassName="nowheel"
      >
        <FlowDebugPanel show={showDebug} summary={debugSummary} />
        <Background gap={20} size={1.2} color="rgba(255,255,255,0.12)" />
        <EdgeOverlay
          edges={overlayEdges}
          nodes={overlayNodes}
          bindings={overlayInteractionBindings}
          draftConnection={draftConnection}
          readOnly={readOnly}
        />
        {transitionOverlay ? (
          <TransitionOverlay
            state={transitionOverlay}
            frame={transitionOverlayFrame}
            nodeVisualMode={nodeVisualMode}
          />
        ) : null}
      </ReactFlow>
      {edgeSearch && (
        <div className="edge-search" style={{ left: edgeSearch.x, top: edgeSearch.y }}>
          <input
            ref={edgeSearchInputRef}
            placeholder="Search or create…"
            value={edgeSearch.query}
            onChange={(event) =>
              setEdgeSearch((prev) => (prev ? { ...prev, query: event.target.value } : prev))
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEdgeSearch(null);
              }
            }}
          />
          <div className="edge-search-list">
            <div className="edge-search-section">Create new</div>
            {filteredTypes.length === 0 && (
              <div className="edge-search-empty">No matching types</div>
            )}
            {filteredTypes.map((type) => (
              <button
                key={`type-${type.id}`}
                type="button"
                onClick={() => onCreateFromType(type.id)}
              >
                {edgeSearch.query.trim().length > 0
                  ? `Create “${edgeSearch.query.trim()}” as ${type.label}`
                  : `Create ${type.label}`}
              </button>
            ))}
            <div className="edge-search-section">Existing</div>
            {filteredEntities.length === 0 && <div className="edge-search-empty">No matches</div>}
            {filteredEntities.map((entity) => (
              <button
                key={`entity-${entity.id}`}
                type="button"
                onClick={() => onLinkEntity(entity.id)}
              >
                {entity.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {edgeMenu && (
        <div className="edge-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }}>
          <input
            ref={edgeMenuInputRef}
            placeholder="Filter relations…"
            value={edgeMenu.query}
            onChange={(event) =>
              setEdgeMenu((prev) => (prev ? { ...prev, query: event.target.value } : prev))
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEdgeMenu(null);
              }
            }}
          />
          <div className="edge-menu-list">
            <button
              type="button"
              onClick={() => {
                onSetRelationType(edgeMenu.edgeId, undefined, undefined, 'none');
                setEdgeMenu(null);
              }}
            >
              none
            </button>
            <button
              type="button"
              onClick={() => {
                onSetRelationType(edgeMenu.edgeId, 'other', edgeMenu.query.trim() || 'other');
                setEdgeMenu(null);
              }}
            >
              other{edgeMenu.query.trim().length > 0 ? `: “${edgeMenu.query.trim()}”` : ''}
            </button>
            {filteredEdgeOptions.length === 0 && (
              <div className="edge-search-empty">No matching relations</div>
            )}
            {filteredEdgeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onApplyRelationOption(edgeMenu.edgeId, option);
                  setEdgeMenu(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
