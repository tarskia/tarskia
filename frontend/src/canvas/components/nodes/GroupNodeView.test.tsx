import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CanvasInteractionBindings, CanvasNodeHostControls } from '../../host/reactflow/types';
import type { CanvasNodeView } from '../../rendering/presentation/presentation';
import { GroupNodeView } from './GroupNodeView';

const noopBindings: CanvasInteractionBindings = {
  onZoomTrigger: () => false,
  onExpandDetails: () => {},
  onCollapseDetails: () => {},
  onExpandChildGroups: () => {},
  onCollapseChildGroups: () => {},
  onEdgeLabelClick: () => {},
};

const baseControls: CanvasNodeHostControls = {
  selected: false,
  disableControlActions: false,
  hideLocalEdgeLabels: false,
  highlightSourceHandle: false,
  highlightTargetHandle: false,
};

const buildGroupView = (): CanvasNodeView => ({
  id: 'group-a',
  kind: 'group',
  matched: false,
  rect: { x: 0, y: 0, width: 320, height: 220 },
  opacity: 1,
  contentScale: 1,
  content: {
    label: 'Group A',
    entityType: 'Group',
    badges: ['alpha', 'beta'],
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
    targetId: 'group-a',
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
});

describe('GroupNodeView', () => {
  it('does not render compatibility local edge geometry in the settled group node markup', () => {
    const markup = renderToStaticMarkup(
      <GroupNodeView
        id="group-a"
        view={buildGroupView()}
        bindings={noopBindings}
        controls={baseControls}
      />,
    );

    expect(markup).not.toContain('group-edge-layer');
    expect(markup).not.toContain('group-edge-path');
    expect(markup).not.toContain('group-edge-label');
    expect(markup).not.toContain('M 24,40 L 216,140');
    expect(markup).not.toContain('node-props');
    expect(markup).not.toContain('alpha');
    expect(markup).not.toContain('beta');
  });
});
