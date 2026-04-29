import type { Node } from 'reactflow';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
} from '../../rendering/presentation/presentation';

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
  showConnectionHandles?: boolean;
  highlightSourceHandle: boolean;
  highlightTargetHandle: boolean;
}

export interface CanvasEdgeHostControls {
  selected: boolean;
  hideLabel: boolean;
}

export interface ReactFlowHostNodeData {
  view: CanvasNodeView;
  bindings: CanvasInteractionBindings;
  controls: CanvasNodeHostControls;
}

export interface ReactFlowHostRenderState {
  nodes: Node<ReactFlowHostNodeData>[];
  overlayEdges: CanvasOverlayEdgeView[];
}
