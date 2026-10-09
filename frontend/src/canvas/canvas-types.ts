import type { ComponentType, CSSProperties } from 'react';
import type { CanvasNodeView, CanvasOverlayEdgeView } from './rendering/presentation/presentation';

export interface CanvasInteractionBindings {
  onZoomTrigger: (id: string, direction: 'in' | 'out') => boolean;
  onExpandDetails: (id: string) => void;
  onCollapseDetails: (id: string) => void;
  onExpandChildGroups: (id: string) => void;
  onCollapseChildGroups: (id: string) => void;
  onEdgeLabelClick: (edgeId: string, x: number, y: number) => void;
  onSelectNode?: (id: string) => void;
  onSelectEdge?: (id: string) => void;
}

export interface CanvasNodeHostControls {
  selected: boolean;
  disableControlActions: boolean;
  hideLocalEdgeLabels: boolean;
}

export interface CanvasNodeData {
  view: CanvasNodeView;
  bindings: CanvasInteractionBindings;
  controls: CanvasNodeHostControls;
}

export interface CanvasRenderState {
  nodes: CanvasNode[];
  overlayEdges: CanvasOverlayEdgeView[];
}

export interface CanvasNode<T = CanvasNodeData> {
  id: string;
  type: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  zIndex?: number;
  selected?: boolean;
  selectable?: boolean;
  data: T;
  style?: CSSProperties;
}
export interface CanvasNodeProps<T = CanvasNodeData> {
  id: string;
  data: T;
  selected?: boolean;
}
export type CanvasNodeTypes = Record<string, ComponentType<CanvasNodeProps>>;
export type CanvasMoveHandler = (
  event: Event | null,
  viewport: { x: number; y: number; zoom: number },
) => void;
