import { describe, expect, it } from 'vitest';

import type { SemanticDocument } from '../semantic';
import { selectDeclarativeDiagramViewState } from '../semantic';
import type { LayoutResult } from './rendering/layout/layout-pipeline';
import {
  buildObservedScopeTransition,
  buildScopeNavigationIntent,
  collectChangedExpandedNodeIds,
  hasOnlyExpandedMapChanged,
  hasOnlyScopeRootChanged,
  resolveExpandedDiffDirection,
  shouldObservePendingStructuralTransition,
} from './useCanvasTransitionController';

const baseDoc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'svc', type: 'service' },
    { id: 'api-group', type: 'group', parent: 'svc' },
    { id: 'workers-group', type: 'group', parent: 'svc' },
    { id: 'api-leaf', type: 'endpoint', parent: 'api-group' },
  ],
  relations: [],
};

const buildViewDoc = (params: {
  expanded?: Record<string, boolean>;
  scopeRootId?: string;
  hidden?: string[];
  highlighted?: string[];
}): SemanticDocument => ({
  ...baseDoc,
  view:
    params.expanded || params.scopeRootId || params.hidden?.length || params.highlighted?.length
      ? {
          kind: 'semantic-diagram-view',
          version: 2,
          scopeRootId: params.scopeRootId,
          nodesById: Object.fromEntries([
            ...Object.keys(params.expanded ?? {}).map((nodeId) => [
              nodeId,
              { expanded: params.expanded?.[nodeId] },
            ]),
            ...(params.hidden ?? []).map((nodeId) => [nodeId, { hidden: true }]),
            ...(params.highlighted ?? []).map((nodeId) => [nodeId, { highlighted: true }]),
          ]),
        }
      : undefined,
});

const buildLayout = (
  visibleNodeIds: string[],
  nodeRects: Record<string, { x: number; y: number; width: number; height: number }> = {},
): LayoutResult =>
  ({
    tree: {
      byId: new Map(
        visibleNodeIds.map((nodeId) => [
          nodeId,
          {
            id: nodeId,
            size: {
              width: nodeRects[nodeId]?.width ?? 0,
              height: nodeRects[nodeId]?.height ?? 0,
            },
          },
        ]),
      ),
    },
    visibleIds: new Set(visibleNodeIds),
    absolutePositions: Object.fromEntries(
      Object.entries(nodeRects).map(([nodeId, rect]) => [nodeId, { x: rect.x, y: rect.y }]),
    ),
    edges: [],
  }) as unknown as LayoutResult;

describe('useCanvasTransitionController helpers', () => {
  it('collects changed expanded ids visible in either layout', () => {
    expect(
      collectChangedExpandedNodeIds({
        previousExpanded: { svc: true, 'workers-group': true },
        currentExpanded: { svc: true, 'api-group': true },
        previousLayout: buildLayout(['svc', 'workers-group']),
        currentLayout: buildLayout(['svc', 'api-group', 'api-leaf']),
      }),
    ).toEqual(['api-group', 'workers-group']);
  });

  it('classifies pure expand and collapse diffs by direction', () => {
    expect(
      resolveExpandedDiffDirection({
        changedExpandedNodeIds: ['api-group'],
        previousExpanded: { svc: true },
        currentExpanded: { svc: true, 'api-group': true },
      }),
    ).toBe('in');

    expect(
      resolveExpandedDiffDirection({
        changedExpandedNodeIds: ['api-group'],
        previousExpanded: { svc: true, 'api-group': true },
        currentExpanded: { svc: true },
      }),
    ).toBe('out');
  });

  it('rejects mixed expand/collapse diffs', () => {
    expect(
      resolveExpandedDiffDirection({
        changedExpandedNodeIds: ['api-group', 'workers-group'],
        previousExpanded: { svc: true, 'api-group': true },
        currentExpanded: { svc: true, 'workers-group': true },
      }),
    ).toBeNull();
  });

  it('allows pure expanded-map changes and rejects other declarative view changes', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const expandedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true, 'api-group': true } }),
    );
    const scopeViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true, 'api-group': true },
        scopeRootId: 'svc',
      }),
    );
    const hiddenViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        hidden: ['api-group'],
      }),
    );

    expect(
      hasOnlyExpandedMapChanged({
        previousViewState,
        currentViewState: expandedViewState,
      }),
    ).toBe(true);
    expect(
      hasOnlyExpandedMapChanged({
        previousViewState,
        currentViewState: scopeViewState,
      }),
    ).toBe(false);
    expect(
      hasOnlyExpandedMapChanged({
        previousViewState,
        currentViewState: hiddenViewState,
      }),
    ).toBe(false);
  });

  it('allows explicit structural transitions to carry search reveal view cleanup', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
        hidden: ['workers-group'],
      }),
    );
    const revealedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true, 'api-group': true },
      }),
    );

    expect(
      hasOnlyExpandedMapChanged({
        previousViewState,
        currentViewState: revealedViewState,
      }),
    ).toBe(false);
    expect(
      shouldObservePendingStructuralTransition({
        previousViewState,
        currentViewState: revealedViewState,
        pendingStructuralTransitionIntent: {
          direction: 'in',
          focus: { kind: 'global' },
        },
      }),
    ).toBe(false);
    expect(
      shouldObservePendingStructuralTransition({
        previousViewState,
        currentViewState: revealedViewState,
        pendingStructuralTransitionIntent: {
          direction: 'in',
          focus: { kind: 'global' },
          allowNonExpansionViewChanges: true,
        },
      }),
    ).toBe(true);
  });

  it('detects pure scope-root changes without conflating other view updates', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );
    const highlightedFocusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
        highlighted: ['api-group'],
      }),
    );

    expect(
      hasOnlyScopeRootChanged({
        previousViewState,
        currentViewState: focusedViewState,
      }),
    ).toBe(true);
    expect(
      hasOnlyScopeRootChanged({
        previousViewState,
        currentViewState: highlightedFocusedViewState,
      }),
    ).toBe(false);
  });

  it('builds focus navigation from the scoped scene after declarative scope changes', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );
    const unfocusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );

    expect(
      buildScopeNavigationIntent({
        previousViewState,
        currentViewState: focusedViewState,
        currentLayout: buildLayout(['api-group', 'api-leaf']),
      }),
    ).toEqual({
      kind: 'fit-node-set',
      nodeIds: ['api-group', 'api-leaf'],
      preset: 'focus',
      deferUntilNextFrame: true,
    });

    expect(
      buildScopeNavigationIntent({
        previousViewState: focusedViewState,
        currentViewState: unfocusedViewState,
        currentLayout: buildLayout(['svc', 'api-group', 'api-leaf']),
      }),
    ).toEqual({
      kind: 'fit-scene',
      preset: 'layout',
      deferUntilNextFrame: true,
    });
  });

  it('does not navigate into an empty focused scene', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );

    expect(
      buildScopeNavigationIntent({
        previousViewState,
        currentViewState: focusedViewState,
        currentLayout: buildLayout([]),
      }),
    ).toBeNull();
  });

  it('fits the scoped scene even when the previous focus root rect is available', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );

    expect(
      buildScopeNavigationIntent({
        previousViewState,
        currentViewState: focusedViewState,
        previousLayout: buildLayout(['svc', 'api-group'], {
          svc: { x: 120, y: 80, width: 240, height: 180 },
        }),
        currentLayout: buildLayout(['api-group', 'api-leaf']),
      }),
    ).toEqual({
      kind: 'fit-node-set',
      nodeIds: ['api-group', 'api-leaf'],
      preset: 'focus',
      deferUntilNextFrame: true,
    });
  });

  it('builds an enter-focus scope transition with deferred navigation', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );
    const previousLayout = buildLayout(['svc'], {
      svc: { x: 120, y: 80, width: 240, height: 180 },
    });
    const currentLayout = buildLayout(['api-group', 'api-leaf']);

    expect(
      buildObservedScopeTransition({
        previousViewState,
        currentViewState: focusedViewState,
        previousLayout,
        currentLayout,
      }),
    ).toMatchObject({
      direction: 'out',
      fromLayout: previousLayout,
      toLayout: currentLayout,
      navigationIntent: {
        kind: 'fit-node-set',
        nodeIds: ['api-group', 'api-leaf'],
        preset: 'focus',
        deferUntilNextFrame: true,
      },
    });
  });

  it('builds an exit-focus scope transition with deferred scene navigation', () => {
    const focusedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true },
        scopeRootId: 'svc',
      }),
    );
    const nextViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const previousLayout = buildLayout(['api-group', 'api-leaf']);
    const currentLayout = buildLayout(['svc', 'api-group', 'api-leaf']);

    expect(
      buildObservedScopeTransition({
        previousViewState: focusedViewState,
        currentViewState: nextViewState,
        previousLayout,
        currentLayout,
      }),
    ).toMatchObject({
      direction: 'in',
      fromLayout: previousLayout,
      toLayout: currentLayout,
      navigationIntent: {
        kind: 'fit-scene',
        preset: 'layout',
        deferUntilNextFrame: true,
      },
    });
  });

  it('does not treat mixed scope and expansion changes as a pure scope transition', () => {
    const previousViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({ expanded: { svc: true } }),
    );
    const mixedViewState = selectDeclarativeDiagramViewState(
      buildViewDoc({
        expanded: { svc: true, 'api-group': true },
        scopeRootId: 'svc',
      }),
    );

    expect(
      buildObservedScopeTransition({
        previousViewState,
        currentViewState: mixedViewState,
        previousLayout: buildLayout(['svc', 'api-group']),
        currentLayout: buildLayout(['api-group', 'api-leaf']),
      }),
    ).toBeNull();
  });
});
