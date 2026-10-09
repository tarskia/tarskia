// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../canvas-types';
import { DiagramRenderer } from '../../DiagramRenderer';
import { buildCanvasRenderState } from '../../node-presentation';
import type {
  CanvasNodeView,
  CanvasOverlayEdgeView,
} from '../../rendering/presentation/presentation';
import { resolveEdgeLabelOffset, resolveEdgeLabelTransform } from './edge-label-placement';
import { resolveEdgeOverlayRenderState } from './edge-overlay-state';
import {
  buildClipPathFromOccluders,
  collapseNestedOccluders,
  EDGE_OCCLUDER_SEAM_PADDING,
  expandOccluderRect,
  flattenOccluders,
  splitOccludersByNodeIds,
} from './occluder-geometry';

const bindings = {
  onZoomTrigger: () => false,
  onExpandDetails: () => {},
  onCollapseDetails: () => {},
  onExpandChildGroups: () => {},
  onCollapseChildGroups: () => {},
  onEdgeLabelClick: () => {},
};
const renderMarkup = (element: ReactElement) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    act(() => root.render(element));
    return host.innerHTML;
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
};
const edgeRenderer = ({
  edges,
  nodes,
}: {
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNodeView[];
}) => {
  const host = buildCanvasRenderState({ presentation: { nodes, overlayEdges: edges }, bindings });
  return createElement(DiagramRenderer, { nodes: host.nodes, edges, nodeTypes: {} });
};
const hostEdgeRenderer = ({
  edges,
  nodes,
}: {
  edges: CanvasOverlayEdgeView[];
  nodes: CanvasNode[];
}) => edgeRenderer({ edges, nodes: nodes.map((node) => node.data.view) });

describe('edge label placement', () => {
  it('nudges labels to the side of vertical routed trunks', () => {
    expect(
      resolveEdgeLabelOffset({
        sourcePoint: { x: 40, y: 20 },
        targetPoint: { x: 140, y: 120 },
        sourceSide: 'right',
        targetSide: 'left',
      }),
    ).toEqual({ x: 14, y: 0 });
  });

  it('nudges labels above straight horizontal edges', () => {
    expect(
      resolveEdgeLabelTransform({
        labelAnchor: { x: 90, y: 60 },
        geometry: {
          sourcePoint: { x: 20, y: 60 },
          targetPoint: { x: 160, y: 60 },
          sourceSide: 'right',
          targetSide: 'left',
        },
      }),
    ).toBe('translate(-50%, -50%) translate(90px, 49px)');
  });
});

describe('shared edge geometry and renderer', () => {
  it('resolves overlay pass occluders for a selected edge trace', () => {
    const renderState = resolveEdgeOverlayRenderState({
      edges: [
        {
          id: 'rel-1:source->target',
          relationId: 'rel-1',
          kind: 'routed',
          sourceId: 'source',
          targetId: 'target',
          matched: false,
          geometry: {
            sourcePoint: { x: 0, y: 0 },
            control1: { x: 10, y: 0 },
            control2: { x: 90, y: 100 },
            targetPoint: { x: 100, y: 100 },
            path: 'M 0,0 L 100,100',
            labelAnchor: { x: 50, y: 50 },
            sourceSide: 'right',
            targetSide: 'left',
          },
          path: 'M 0,0 L 100,100',
          labelAnchor: { x: 50, y: 50 },
          opacity: 0.5,
          solidOverNodeIds: ['group-1'],
        },
      ],
      nodes: [
        {
          id: 'group-1',
          kind: 'group',
          matched: false,
          rect: { x: 0, y: 0, width: 120, height: 120 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'Group',
            entityType: 'Service',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'group-1',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: true,
          },
          contentOccluders: [{ x: 18, y: 20, width: 60, height: 18 }],
        },
        {
          id: 'group-2',
          kind: 'group',
          matched: false,
          rect: { x: 140, y: 0, width: 80, height: 120 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'Ghost',
            entityType: 'Service',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'group-2',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: true,
          },
          contentOccluders: [],
        },
      ],
    });

    expect(renderState.shellOccluders).toHaveLength(2);
    expect(renderState.contentOccluders).toHaveLength(1);
    // The unrelated shell at x=140 is outside the path and its 28px hit envelope.
    expect(renderState.edges[0]?.blockerOccluders).toEqual([
      { x: 18, y: 20, width: 60, height: 18 },
    ]);
  });

  it('flattens overlapping blocker occluders into a single non-overlapping mask', () => {
    const renderState = resolveEdgeOverlayRenderState({
      edges: [
        {
          id: 'rel-1:source->target',
          relationId: 'rel-1',
          kind: 'routed',
          sourceId: 'source',
          targetId: 'target',
          matched: false,
          geometry: {
            sourcePoint: { x: 0, y: 80 },
            control1: { x: 40, y: 80 },
            control2: { x: 180, y: 80 },
            targetPoint: { x: 220, y: 80 },
            path: 'M 0,80 L 220,80',
            labelAnchor: { x: 110, y: 80 },
            sourceSide: 'right',
            targetSide: 'left',
          },
          path: 'M 0,80 L 220,80',
          labelAnchor: { x: 110, y: 80 },
          opacity: 1,
          solidOverNodeIds: [],
        },
      ],
      nodes: [
        {
          id: 'parent',
          kind: 'group',
          matched: false,
          rect: { x: 20, y: 20, width: 160, height: 120 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'Parent',
            entityType: 'Service',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'parent',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: true,
          },
          contentOccluders: [],
        },
        {
          id: 'child',
          kind: 'entity',
          matched: false,
          rect: { x: 60, y: 50, width: 80, height: 40 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'Child',
            entityType: 'API',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'child',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: false,
          },
          contentOccluders: [{ x: 8, y: 10, width: 40, height: 14 }],
        },
      ],
    });

    expect(renderState.edges[0]?.blockerOccluders).toEqual([
      expandOccluderRect({ x: 20, y: 20, width: 160, height: 120 }),
    ]);
  });

  it('keeps the outside clip focused on outermost shell occluders', () => {
    const renderState = resolveEdgeOverlayRenderState({
      edges: [
        {
          id: 'rel-1:source->target',
          relationId: 'rel-1',
          kind: 'routed',
          sourceId: 'source',
          targetId: 'target',
          matched: false,
          geometry: {
            sourcePoint: { x: 0, y: 80 },
            control1: { x: 40, y: 80 },
            control2: { x: 160, y: 80 },
            targetPoint: { x: 200, y: 80 },
            path: 'M 0,80 L 200,80',
            labelAnchor: { x: 100, y: 80 },
            sourceSide: 'right',
            targetSide: 'left',
          },
          path: 'M 0,80 L 200,80',
          labelAnchor: { x: 100, y: 80 },
          opacity: 1,
          solidOverNodeIds: [],
        },
      ],
      nodes: [
        {
          id: 'app',
          kind: 'group',
          matched: false,
          rect: { x: 20, y: 20, width: 220, height: 160 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'App',
            entityType: 'Service',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'app',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: true,
          },
          contentOccluders: [],
        },
        {
          id: 'child',
          kind: 'entity',
          matched: false,
          rect: { x: 60, y: 60, width: 80, height: 40 },
          opacity: 1,
          contentScale: 1,
          content: {
            label: 'Child',
            entityType: 'API',
            badges: [],
            listMode: false,
            listProps: [],
            listShowType: true,
          },
          style: {
            background: 'black',
            border: '1px solid white',
            color: 'white',
            selectionRing: 'white',
            selectionGlow: 'transparent',
            selectionFill: 'transparent',
            transparentChrome: false,
            focusShell: false,
          },
          controls: {
            targetId: 'child',
            showZoomControls: false,
            canZoomIn: false,
            canZoomOut: false,
            showDetailControls: false,
            canExpandDetails: false,
            canCollapseDetails: false,
            showChildGroupControls: false,
            canExpandChildGroups: false,
            canCollapseChildGroups: false,
          },
          capabilities: {
            hasChildren: false,
          },
          contentOccluders: [],
        },
      ],
    });

    expect(renderState.shellOccluders).toEqual([
      expandOccluderRect({ x: 20, y: 20, width: 220, height: 160 }),
    ]);
  });

  it('renders solid spans plus dotted blocked spans from a single blocker mask', () => {
    const markup = renderMarkup(
      edgeRenderer({
        edges: [
          {
            id: 'rel-1:source->target',
            relationId: 'rel-1',
            kind: 'routed',
            sourceId: 'source',
            targetId: 'target',
            matched: false,
            geometry: {
              sourcePoint: { x: 0, y: 0 },
              control1: { x: 10, y: 0 },
              control2: { x: 90, y: 100 },
              targetPoint: { x: 100, y: 100 },
              path: 'M 0,0 L 100,100',
              labelAnchor: { x: 50, y: 50 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            path: 'M 0,0 L 100,100',
            labelAnchor: { x: 50, y: 50 },
            opacity: 0.5,
            selected: true,
            solidOverNodeIds: ['group-1'],
          },
        ],
        nodes: [
          {
            id: 'group-1',
            kind: 'group',
            matched: false,
            rect: { x: 0, y: 0, width: 120, height: 120 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'Group',
              entityType: 'Service',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'group-1',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: true,
            },
            contentOccluders: [{ x: 18, y: 20, width: 60, height: 18 }],
          },
          {
            id: 'group-2',
            kind: 'group',
            matched: false,
            rect: { x: 140, y: 0, width: 80, height: 120 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'Ghost',
              entityType: 'Service',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'group-2',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: true,
            },
            contentOccluders: [],
          },
        ],
      }),
    );

    expect(markup).toContain('<clipPath');
    expect(markup).toContain('edge-underlay-path edge-underlay-path-selected');
    expect(markup).toContain('edge-overlay-path edge-overlay-path-selected');
    expect(markup).toContain('class="edge-underlay-path edge-underlay-path-selected"');
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('M 18,20 V 38 H 78 V 20 Z');
    expect(markup).not.toContain('edge-overlay-path-branch edge-overlay-path-branch-selected');
  });

  it('renders local and routed edges in shared world coordinates', () => {
    const markup = renderMarkup(
      edgeRenderer({
        edges: [
          {
            id: 'rel-local',
            relationId: 'rel-local',
            kind: 'local',
            sourceId: 'api-left',
            targetId: 'api-right',
            scopeId: 'group-1',
            label: 'call',
            matched: false,
            geometry: {
              sourcePoint: { x: 60, y: 80 },
              control1: { x: 96, y: 80 },
              control2: { x: 184, y: 120 },
              targetPoint: { x: 220, y: 120 },
              path: 'M 60,80 L 220,120',
              labelAnchor: { x: 140, y: 100 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            path: 'M 60,80 L 220,120',
            labelAnchor: { x: 140, y: 100 },
            opacity: 0.9,
            solidOverNodeIds: ['group-1'],
          },
          {
            id: 'rel-routed',
            relationId: 'rel-routed',
            kind: 'routed',
            sourceId: 'api-right',
            targetId: 'external',
            label: 'sync',
            matched: false,
            geometry: {
              sourcePoint: { x: 220, y: 120 },
              control1: { x: 260, y: 120 },
              control2: { x: 340, y: 88 },
              targetPoint: { x: 380, y: 88 },
              path: 'M 220,120 L 380,88',
              labelAnchor: { x: 300, y: 104 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            path: 'M 220,120 L 380,88',
            labelAnchor: { x: 300, y: 104 },
            opacity: 1,
            solidOverNodeIds: ['group-1'],
          },
        ],
        nodes: [
          {
            id: 'group-1',
            kind: 'group',
            matched: false,
            rect: { x: 20, y: 40, width: 260, height: 160 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'Group',
              entityType: 'Service',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'group-1',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: true,
            },
            contentOccluders: [],
          },
          {
            id: 'api-left',
            kind: 'entity',
            matched: false,
            rect: { x: 40, y: 60, width: 64, height: 40 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'API Left',
              entityType: 'API',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'api-left',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: false,
            },
            contentOccluders: [],
          },
          {
            id: 'api-right',
            kind: 'entity',
            matched: false,
            rect: { x: 196, y: 100, width: 64, height: 40 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'API Right',
              entityType: 'API',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'api-right',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: false,
            },
            contentOccluders: [],
          },
          {
            id: 'external',
            kind: 'entity',
            matched: false,
            rect: { x: 360, y: 68, width: 72, height: 40 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'External',
              entityType: 'Job',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'external',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: false,
            },
            contentOccluders: [],
          },
        ],
      }),
    );

    expect(markup).toContain('M 60,80 L 220,120');
    expect(markup).toContain('M 220,120 L 380,88');
  });

  it('preserves local edge path geometry', () => {
    const markup = renderMarkup(
      edgeRenderer({
        edges: [
          {
            id: 'rel-local',
            relationId: 'rel-local',
            kind: 'local',
            sourceId: 'api-left',
            targetId: 'api-right',
            scopeId: 'group-1',
            label: 'call',
            matched: false,
            geometry: {
              sourcePoint: { x: 0, y: 0 },
              control1: { x: 10, y: 0 },
              control2: { x: 90, y: 100 },
              targetPoint: { x: 100, y: 100 },
              path: 'M 0,0 L 100,100',
              labelAnchor: { x: 50, y: 50 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            path: 'M 0,0 L 100,100',
            labelAnchor: { x: 50, y: 50 },
            opacity: 1,
            hideLabel: true,
            solidOverNodeIds: ['group-1'],
          },
        ],
        nodes: [
          {
            id: 'group-1',
            kind: 'group',
            matched: false,
            rect: { x: 0, y: 0, width: 120, height: 120 },
            opacity: 1,
            contentScale: 1,
            content: {
              label: 'Group',
              entityType: 'Service',
              badges: [],
              listMode: false,
              listProps: [],
              listShowType: true,
            },
            style: {
              background: 'black',
              border: '1px solid white',
              color: 'white',
              selectionRing: 'white',
              selectionGlow: 'transparent',
              selectionFill: 'transparent',
              transparentChrome: false,
              focusShell: false,
            },
            controls: {
              targetId: 'group-1',
              showZoomControls: false,
              canZoomIn: false,
              canZoomOut: false,
              showDetailControls: false,
              canExpandDetails: false,
              canCollapseDetails: false,
              showChildGroupControls: false,
              canExpandChildGroups: false,
              canCollapseChildGroups: false,
            },
            capabilities: {
              hasChildren: true,
            },
            contentOccluders: [],
          },
        ],
      }),
    );

    expect(markup).toContain('M 0,0 L 100,100');
  });
});

describe('diagram edge interaction', () => {
  it('clips edge hit paths to the solid-visible mask so blocked segments stay non-interactive', () => {
    const markup = renderMarkup(
      hostEdgeRenderer({
        edges: [
          {
            id: 'rel-1:source->target',
            relationId: 'rel-1',
            kind: 'routed',
            sourceId: 'source',
            targetId: 'target',
            matched: false,
            geometry: {
              sourcePoint: { x: 0, y: 80 },
              control1: { x: 40, y: 80 },
              control2: { x: 180, y: 80 },
              targetPoint: { x: 220, y: 80 },
              path: 'M 0,80 L 220,80',
              labelAnchor: { x: 110, y: 80 },
              sourceSide: 'right',
              targetSide: 'left',
            },
            path: 'M 0,80 L 220,80',
            labelAnchor: { x: 110, y: 80 },
            opacity: 1,
            solidOverNodeIds: [],
          },
        ],
        nodes: [
          {
            id: 'source',
            data: {
              view: {
                id: 'source',
                kind: 'entity',
                matched: false,
                rect: { x: 0, y: 60, width: 40, height: 40 },
                opacity: 1,
                contentScale: 1,
                content: {
                  label: 'Source',
                  entityType: 'API',
                  badges: [],
                  listMode: false,
                  listProps: [],
                  listShowType: true,
                },
                style: {
                  background: 'black',
                  border: '1px solid white',
                  color: 'white',
                  selectionRing: 'white',
                  selectionGlow: 'transparent',
                  selectionFill: 'transparent',
                  transparentChrome: false,
                  focusShell: false,
                },
                controls: {
                  targetId: 'source',
                  showZoomControls: false,
                  canZoomIn: false,
                  canZoomOut: false,
                  showDetailControls: false,
                  canExpandDetails: false,
                  canCollapseDetails: false,
                  showChildGroupControls: false,
                  canExpandChildGroups: false,
                  canCollapseChildGroups: false,
                },
                capabilities: {
                  hasChildren: false,
                },
                contentOccluders: [],
              },
              controls: {},
            },
          },
          {
            id: 'target',
            data: {
              view: {
                id: 'target',
                kind: 'entity',
                matched: false,
                rect: { x: 220, y: 60, width: 40, height: 40 },
                opacity: 1,
                contentScale: 1,
                content: {
                  label: 'Target',
                  entityType: 'API',
                  badges: [],
                  listMode: false,
                  listProps: [],
                  listShowType: true,
                },
                style: {
                  background: 'black',
                  border: '1px solid white',
                  color: 'white',
                  selectionRing: 'white',
                  selectionGlow: 'transparent',
                  selectionFill: 'transparent',
                  transparentChrome: false,
                  focusShell: false,
                },
                controls: {
                  targetId: 'target',
                  showZoomControls: false,
                  canZoomIn: false,
                  canZoomOut: false,
                  showDetailControls: false,
                  canExpandDetails: false,
                  canCollapseDetails: false,
                  showChildGroupControls: false,
                  canExpandChildGroups: false,
                  canCollapseChildGroups: false,
                },
                capabilities: {
                  hasChildren: false,
                },
                contentOccluders: [],
              },
              controls: {},
            },
          },
          {
            id: 'group-1',
            data: {
              view: {
                id: 'group-1',
                kind: 'group',
                matched: false,
                rect: { x: 40, y: 20, width: 140, height: 120 },
                opacity: 1,
                contentScale: 1,
                content: {
                  label: 'Group',
                  entityType: 'Service',
                  badges: [],
                  listMode: false,
                  listProps: [],
                  listShowType: true,
                },
                style: {
                  background: 'black',
                  border: '1px solid white',
                  color: 'white',
                  selectionRing: 'white',
                  selectionGlow: 'transparent',
                  selectionFill: 'transparent',
                  transparentChrome: false,
                  focusShell: false,
                },
                controls: {
                  targetId: 'group-1',
                  showZoomControls: false,
                  canZoomIn: false,
                  canZoomOut: false,
                  showDetailControls: false,
                  canExpandDetails: false,
                  canCollapseDetails: false,
                  showChildGroupControls: false,
                  canExpandChildGroups: false,
                  canCollapseChildGroups: false,
                },
                capabilities: {
                  hasChildren: true,
                },
                contentOccluders: [{ x: 30, y: 20, width: 40, height: 16 }],
              },
              controls: {},
            },
          },
        ] as never,
      }),
    );

    expect(markup).toContain('class="edge-hit-path"');
    const rendered = document.createElement('div');
    rendered.innerHTML = markup;
    const hitClip = rendered.querySelector('.edge-hit-path')?.getAttribute('clip-path');
    const solidClip = rendered.querySelector('.edge-underlay-path')?.getAttribute('clip-path');
    const blockedClip = rendered.querySelector('.edge-overlay-path')?.getAttribute('clip-path');
    expect(hitClip).toBe(solidClip);
    expect(hitClip).not.toBe(blockedClip);
    const clipId = hitClip!.slice(5, -1);
    expect(
      [...rendered.querySelectorAll('clipPath')]
        .find((clip) => clip.id === clipId)
        ?.getAttribute('data-render-clip'),
    ).toBe('rel-1:source->target:solid');
  });
});

describe('splitOccludersByNodeIds', () => {
  it('splits solid-over ancestor occluders from unrelated ghost occluders', () => {
    const result = splitOccludersByNodeIds({
      nodes: [
        {
          id: 'schema',
          rect: { x: 10, y: 10, width: 200, height: 100 },
        },
        {
          id: 'table',
          rect: { x: 20, y: 20, width: 80, height: 40 },
        },
      ],
      solidOverNodeIds: ['schema'],
    });

    expect(result.branchOccluders).toEqual([{ x: 10, y: 10, width: 200, height: 100 }]);
    expect(result.ghostOccluders).toEqual([{ x: 20, y: 20, width: 80, height: 40 }]);
  });

  it('omits excluded endpoint nodes from both branch and ghost redraw occluders', () => {
    const result = splitOccludersByNodeIds({
      nodes: [
        {
          id: 'source',
          rect: { x: 0, y: 0, width: 100, height: 40 },
        },
        {
          id: 'scope',
          rect: { x: 0, y: 0, width: 220, height: 120 },
        },
        {
          id: 'target',
          rect: { x: 160, y: 0, width: 100, height: 40 },
        },
      ],
      solidOverNodeIds: ['scope'],
      excludedNodeIds: ['source', 'target'],
    });

    expect(result.branchOccluders).toEqual([{ x: 0, y: 0, width: 220, height: 120 }]);
    expect(result.ghostOccluders).toEqual([]);
  });
});

describe('collapseNestedOccluders', () => {
  it('drops fully contained shell occluders so nested cards do not reopen the outside clip', () => {
    expect(
      collapseNestedOccluders([
        { x: 0, y: 0, width: 200, height: 120 },
        { x: 20, y: 20, width: 80, height: 40 },
        { x: 240, y: 0, width: 80, height: 40 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 200, height: 120 },
      { x: 240, y: 0, width: 80, height: 40 },
    ]);
  });
});

describe('flattenOccluders', () => {
  it('preserves the blocker union while removing overlap between sibling blockers', () => {
    expect(
      flattenOccluders([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 100, width: 100, height: 50 },
      { x: 100, y: 50, width: 50, height: 50 },
    ]);
  });
});

describe('expandOccluderRect', () => {
  it('pads occluders symmetrically to avoid edge seams at the node boundary', () => {
    expect(expandOccluderRect({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 10 - EDGE_OCCLUDER_SEAM_PADDING,
      y: 20 - EDGE_OCCLUDER_SEAM_PADDING,
      width: 30 + EDGE_OCCLUDER_SEAM_PADDING * 2,
      height: 40 + EDGE_OCCLUDER_SEAM_PADDING * 2,
    });
  });
});

describe('buildClipPathFromOccluders', () => {
  it('builds a compound clip path that can subtract excluded occluders', () => {
    expect(
      buildClipPathFromOccluders({
        include: [{ x: 0, y: 0, width: 100, height: 100 }],
        exclude: [{ x: 25, y: 25, width: 50, height: 50 }],
      }),
    ).toBe('M 0,0 H 100 V 100 H 0 Z M 25,25 V 75 H 75 V 25 Z');
  });
});
