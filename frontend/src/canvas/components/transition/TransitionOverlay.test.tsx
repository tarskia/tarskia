import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('reactflow', () => ({
  useStore: () => [0, 0, 1],
}));

import { TransitionOverlay } from './TransitionOverlay';

const buildFrameView = (overrides?: {
  showDetailControls?: boolean;
  showChildGroupControls?: boolean;
  zIndex?: number;
}): import('../../rendering/presentation/presentation').CanvasNodeView => ({
  id: 'group-1',
  kind: 'group',
  matched: false,
  rect: { x: 0, y: 0, width: 240, height: 160 },
  zIndex: overrides?.zIndex,
  opacity: 1,
  contentScale: 1,
  content: {
    label: 'Group',
    entityType: 'Service',
    badges: [],
    summaryLabel: '4 steps',
    listMode: false,
    listProps: [],
    listShowType: true,
    childOpacity: 1,
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
    showZoomControls: true,
    canZoomIn: false,
    canZoomOut: true,
    showDetailControls: overrides?.showDetailControls ?? true,
    canExpandDetails: false,
    canCollapseDetails: true,
    showChildGroupControls: overrides?.showChildGroupControls ?? false,
    canExpandChildGroups: false,
    canCollapseChildGroups: true,
  },
  capabilities: {
    hasChildren: true,
  },
});

describe('TransitionOverlay', () => {
  it('renders control rows from the sampled frame view controls', () => {
    const markup = renderToStaticMarkup(
      <TransitionOverlay
        state={{
          id: 1,
          startedAt: 0,
          duration: 100,
          phaseWindow: { start: 0, end: 1 },
          nodes: [],
          edges: [],
          overlayEdges: [],
        }}
        frame={{
          progress: 0.5,
          nodes: [
            {
              id: 'group-1',
              kind: 'group',
              view: buildFrameView({
                showDetailControls: true,
                showChildGroupControls: true,
              }),
              rect: { x: 0, y: 0, width: 240, height: 160 },
              opacity: 1,
              contentScale: 1,
              childOpacity: 1,
            },
          ],
          edges: [],
          overlayEdges: [],
        }}
        nodeVisualMode="default"
      />,
    );

    expect(markup).toContain('Expand all');
    expect(markup).toContain('Collapse once');
  });

  it('omits control rows that are absent from the sampled frame view', () => {
    const markup = renderToStaticMarkup(
      <TransitionOverlay
        state={{
          id: 1,
          startedAt: 0,
          duration: 100,
          phaseWindow: { start: 0, end: 1 },
          nodes: [],
          edges: [],
          overlayEdges: [],
        }}
        frame={{
          progress: 0.5,
          nodes: [
            {
              id: 'group-1',
              kind: 'group',
              view: buildFrameView({
                showDetailControls: false,
                showChildGroupControls: false,
              }),
              rect: { x: 0, y: 0, width: 240, height: 160 },
              opacity: 1,
              contentScale: 1,
              childOpacity: 1,
            },
          ],
          edges: [],
          overlayEdges: [],
        }}
        nodeVisualMode="default"
      />,
    );

    expect(markup).not.toContain('Expand all');
    expect(markup).not.toContain('Expand once');
  });

  it('applies frame z-index to transition node shells', () => {
    const markup = renderToStaticMarkup(
      <TransitionOverlay
        state={{
          id: 1,
          startedAt: 0,
          duration: 100,
          phaseWindow: { start: 0, end: 1 },
          nodes: [],
          edges: [],
          overlayEdges: [],
        }}
        frame={{
          progress: 0.25,
          nodes: [
            {
              id: 'child',
              kind: 'group',
              view: buildFrameView({ zIndex: 1 }),
              rect: { x: 20, y: 20, width: 120, height: 64 },
              zIndex: 8,
              opacity: 1,
              contentScale: 1,
              childOpacity: 1,
            },
            {
              id: 'parent',
              kind: 'group',
              view: buildFrameView({ zIndex: 4 }),
              rect: { x: 0, y: 0, width: 220, height: 140 },
              zIndex: 4,
              opacity: 0.5,
              contentScale: 1,
              childOpacity: 1,
            },
          ],
          edges: [],
          overlayEdges: [],
        }}
        nodeVisualMode="default"
      />,
    );

    expect(markup).toContain('z-index:8');
    expect(markup).toContain('z-index:4');
  });

  it('renders the settled overlay edge passes during transitions', () => {
    const markup = renderToStaticMarkup(
      <TransitionOverlay
        state={{
          id: 1,
          startedAt: 0,
          duration: 100,
          phaseWindow: { start: 0, end: 1 },
          nodes: [],
          edges: [],
          overlayEdges: [
            {
              id: 'rel-1:source->target',
              relationId: 'rel-1',
              sourceId: 'source',
              targetId: 'target',
              solidOverNodeIds: ['group-1'],
              fromGeometry: {
                sourcePoint: { x: 0, y: 0 },
                control1: { x: 10, y: 0 },
                control2: { x: 90, y: 100 },
                targetPoint: { x: 100, y: 100 },
                path: 'M 0,0 L 100,100',
                labelAnchor: { x: 50, y: 50 },
                sourceSide: 'right',
                targetSide: 'left',
              },
              toGeometry: {
                sourcePoint: { x: 0, y: 0 },
                control1: { x: 10, y: 0 },
                control2: { x: 90, y: 100 },
                targetPoint: { x: 100, y: 100 },
                path: 'M 0,0 L 100,100',
                labelAnchor: { x: 50, y: 50 },
                sourceSide: 'right',
                targetSide: 'left',
              },
              lockedSides: {
                sourceSide: 'right',
                targetSide: 'left',
              },
              fromOpacity: 1,
              toOpacity: 1,
            },
          ],
        }}
        frame={{
          progress: 0.5,
          nodes: [
            {
              id: 'group-1',
              kind: 'group',
              view: buildFrameView(),
              rect: { x: 0, y: 0, width: 240, height: 160 },
              opacity: 1,
              contentScale: 1,
              childOpacity: 1,
            },
          ],
          edges: [],
          overlayEdges: [
            {
              id: 'rel-1:source->target',
              relationId: 'rel-1',
              kind: 'routed',
              sourceId: 'source',
              targetId: 'target',
              matched: false,
              opacity: 1,
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
              solidOverNodeIds: ['group-1'],
            },
          ],
        }}
        nodeVisualMode="default"
      />,
    );

    expect(markup).toContain('<clipPath');
    expect(markup).toContain('edge-underlay-path');
    expect(markup).toContain('fill="none"');
    expect(markup).not.toContain('edge-overlay-path-branch');
  });

  it('keeps edge labels hidden for most of the transition and fades them in near the end', () => {
    const state = {
      id: 1,
      startedAt: 0,
      duration: 100,
      phaseWindow: { start: 0, end: 1 },
      nodes: [],
      edges: [
        {
          id: 'rel-1:source->target',
          relationId: 'rel-1',
          kind: 'routed' as const,
          sourceId: 'source',
          targetId: 'target',
          matched: false,
          fromGeometry: {
            sourcePoint: { x: 0, y: 0 },
            control1: { x: 10, y: 0 },
            control2: { x: 90, y: 100 },
            targetPoint: { x: 100, y: 100 },
            path: 'M 0,0 L 100,100',
            labelAnchor: { x: 50, y: 50 },
            sourceSide: 'right' as const,
            targetSide: 'left' as const,
          },
          toGeometry: {
            sourcePoint: { x: 0, y: 0 },
            control1: { x: 10, y: 0 },
            control2: { x: 90, y: 100 },
            targetPoint: { x: 100, y: 100 },
            path: 'M 0,0 L 100,100',
            labelAnchor: { x: 50, y: 50 },
            sourceSide: 'right' as const,
            targetSide: 'left' as const,
          },
          lockedSides: {
            sourceSide: 'right' as const,
            targetSide: 'left' as const,
          },
          solidOverNodeIds: [],
          fromOpacity: 1,
          toOpacity: 1,
          labelTrack: {
            id: 'rel-1:label',
            relationId: 'rel-1',
            label: 'reads',
            fromAnchor: { x: 50, y: 50 },
            toAnchor: { x: 50, y: 50 },
            fromOpacity: 1,
            toOpacity: 1,
          },
        },
      ],
      overlayEdges: [],
    };
    const nodes = [
      {
        id: 'source',
        kind: 'entity' as const,
        view: buildFrameView(),
        rect: { x: 0, y: 0, width: 100, height: 80 },
        opacity: 1,
        contentScale: 1,
        childOpacity: 1,
      },
      {
        id: 'target',
        kind: 'entity' as const,
        view: buildFrameView(),
        rect: { x: 180, y: 0, width: 100, height: 80 },
        opacity: 1,
        contentScale: 1,
        childOpacity: 1,
      },
    ];
    const edges = [
      {
        id: 'rel-1:source->target',
        relationId: 'rel-1',
        kind: 'routed' as const,
        sourceId: 'source',
        targetId: 'target',
        label: 'reads',
        matched: false,
        opacity: 1,
        solidOverNodeIds: [],
        geometry: {
          sourcePoint: { x: 0, y: 0 },
          control1: { x: 10, y: 0 },
          control2: { x: 90, y: 100 },
          targetPoint: { x: 100, y: 100 },
          path: 'M 0,0 L 100,100',
          labelAnchor: { x: 50, y: 50 },
          sourceSide: 'right' as const,
          targetSide: 'left' as const,
        },
        labelAnchor: { x: 50, y: 50 },
      },
    ];

    const hiddenMarkup = renderToStaticMarkup(
      <TransitionOverlay
        state={state}
        frame={{
          progress: 0.5,
          nodes,
          edges,
          overlayEdges: [],
        }}
        nodeVisualMode="default"
      />,
    );
    const visibleMarkup = renderToStaticMarkup(
      <TransitionOverlay
        state={state}
        frame={{
          progress: 0.96,
          nodes,
          edges,
          overlayEdges: [],
        }}
        nodeVisualMode="default"
      />,
    );

    expect(hiddenMarkup).not.toContain('reads');
    expect(visibleMarkup).toContain('reads');
  });
});
