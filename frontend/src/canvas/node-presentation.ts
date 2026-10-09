import type { CSSProperties } from 'react';
import type { CanvasInteractionBindings, CanvasRenderState } from './canvas-types';
import type { CanvasPresentation } from './rendering/presentation/presentation';

export interface BuildCanvasRenderStateParams {
  presentation: CanvasPresentation;
  bindings: CanvasInteractionBindings;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  disableControlActions?: boolean;
  hideEdgeLabels?: boolean;
}

const orderSelectedEdgesLast = <T extends { selected?: boolean }>(edges: T[]) =>
  [...edges].sort((left, right) => {
    const leftSelected = left.selected === true ? 1 : 0;
    const rightSelected = right.selected === true ? 1 : 0;
    return leftSelected - rightSelected;
  });

export const buildCanvasRenderState = ({
  presentation,
  bindings,
  selectedEntityId,
  selectedEdgeId,
  disableControlActions = false,
  hideEdgeLabels = false,
}: BuildCanvasRenderStateParams): CanvasRenderState => {
  const overlayEdges = presentation.overlayEdges.map((edge) => ({
    ...edge,
    selected:
      selectedEdgeId !== undefined &&
      (edge.relationIds ?? [edge.relationId]).includes(selectedEdgeId),
    hideLabel: edge.kind === 'routed' && hideEdgeLabels,
  }));

  const nodes = presentation.nodes.map((node) => {
    const controls = {
      selected: node.id === selectedEntityId,
      disableControlActions,
      hideLocalEdgeLabels: hideEdgeLabels,
    };
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
      width: node.rect.width,
      height: node.rect.height,
      selectable: !node.style.focusShell,
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
