import type { CSSProperties } from 'react';
import type { CanvasPresentation } from '../../rendering/presentation/presentation';
import type {
  CanvasEdgeHostControls,
  CanvasInteractionBindings,
  CanvasNodeHostControls,
  ReactFlowHostRenderState,
} from './types';

export interface AdaptPresentationToReactFlowParams {
  presentation: CanvasPresentation;
  bindings: CanvasInteractionBindings;
  nodeControlsById: Map<string, CanvasNodeHostControls>;
  edgeControlsById: Map<string, CanvasEdgeHostControls>;
}

const defaultNodeControls: CanvasNodeHostControls = {
  selected: false,
  disableControlActions: false,
  hideLocalEdgeLabels: false,
  highlightSourceHandle: false,
  highlightTargetHandle: false,
};

const defaultEdgeControls: CanvasEdgeHostControls = {
  selected: false,
  hideLabel: false,
};

const orderSelectedEdgesLast = <T extends { selected?: boolean }>(edges: T[]) =>
  [...edges].sort((left, right) => {
    const leftSelected = left.selected === true ? 1 : 0;
    const rightSelected = right.selected === true ? 1 : 0;
    return leftSelected - rightSelected;
  });

export const adaptPresentationToReactFlow = ({
  presentation,
  bindings,
  nodeControlsById,
  edgeControlsById,
}: AdaptPresentationToReactFlowParams): ReactFlowHostRenderState => {
  const overlayEdges = presentation.overlayEdges.map((edge) => {
    const edgeControls = edgeControlsById.get(edge.id) ?? defaultEdgeControls;
    return {
      ...edge,
      selected: edgeControls.selected,
      hideLabel: edgeControls.hideLabel,
    };
  });

  const nodes = presentation.nodes.map((node) => {
    const controls = nodeControlsById.get(node.id) ?? defaultNodeControls;
    const position = {
      x: node.rect.x,
      y: node.rect.y,
    };
    const baseStyle: CSSProperties = {
      width: node.rect.width,
      height: node.rect.height,
      opacity: node.opacity,
      pointerEvents: node.style.focusShell || node.opacity <= 0.2 ? 'none' : 'auto',
      ['--node-selection-ring' as string]: node.style.selectionRing,
      ['--node-selection-glow' as string]: node.style.selectionGlow,
      ['--node-selection-fill' as string]: node.style.selectionFill,
    };
    const style: CSSProperties = node.style.focusShell
      ? {
          ...baseStyle,
          ['--node-bg' as string]: node.style.background,
          ['--node-border' as string]: node.style.border,
          color: node.style.color,
          boxShadow: 'none',
        }
      : node.style.transparentChrome
        ? {
            ...baseStyle,
            ['--node-bg' as string]: 'transparent',
            ['--node-border' as string]: '1px solid transparent',
            boxShadow: 'none',
          }
        : {
            ...baseStyle,
            ['--node-bg' as string]: node.style.background,
            ['--node-border' as string]: node.style.border,
            color: node.style.color,
          };

    return {
      id: node.id,
      type: node.kind === 'group' ? 'groupNode' : 'entityNode',
      position,
      zIndex: node.zIndex,
      selected: node.style.focusShell ? false : controls.selected,
      hidden: false,
      width: node.rect.width,
      height: node.rect.height,
      selectable: !node.style.focusShell,
      draggable: false,
      connectable: !node.style.focusShell,
      data: {
        view: node,
        bindings,
        controls,
      },
      style,
    };
  });

  return {
    nodes,
    overlayEdges: orderSelectedEdgesLast(overlayEdges),
  };
};
