import {
  buildSemanticIndex,
  type DiagramView,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useDiagramActions } from './useDiagramActions';

const stateForDoc = (doc: SemanticDocument) => ({
  index: buildSemanticIndex(doc, {
    owner: 'test',
    name: 'actions',
    version: '1',
    types: [],
    relations: [],
  }),
  view: doc.view,
});
const applyViewUpdate = (
  update: (view: DiagramView | undefined) => DiagramView | undefined,
  doc: SemanticDocument,
) => ({ ...doc, view: update(doc.view) });

describe('useDiagramActions', () => {
  it('centerScene requests a scene fit without mutating layout state', () => {
    const commitView = vi.fn();
    const requestNavigation = vi.fn();
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
          },
        }),
        document: {
          commitView,
        },
        transition: {
          requestNavigation,
          setPendingStructuralTransitionIntent: vi.fn(),
          flushUserGesture: vi.fn(() => false),
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.centerScene();

    expect(commitView).not.toHaveBeenCalled();
    expect(requestNavigation).toHaveBeenCalledWith({
      kind: 'fit-scene',
      preset: 'layout',
    });
  });

  it('expands all viewer details', () => {
    const commitView = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    const flushUserGesture = vi.fn(() => true);
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [
            {
              id: 'service-a',
              type: 'service',
              children: [{ id: 'endpoint-a', type: 'endpoint' }],
            },
          ],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
          },
        }),
        document: {
          commitView,
        },
        transition: {
          requestNavigation: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture,
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.expandAll();

    expect(flushUserGesture).toHaveBeenCalledTimes(1);
    expect(setPendingStructuralTransitionIntent).toHaveBeenCalledWith({
      direction: 'in',
      focus: { kind: 'global' },
    });
    expect(commitView).toHaveBeenCalledTimes(1);
    const updater = commitView.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    const updated = applyViewUpdate(updater, {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'service-a',
          type: 'service',
          children: [{ id: 'endpoint-a', type: 'endpoint' }],
        },
      ],
      relations: [],
      view: {
        kind: 'semantic-diagram-view',
        version: 3,
      },
    });
    expect(updated.view?.nodesById?.['service-a']?.expanded).toBe(true);
  });

  it('collapses all viewer details', () => {
    const commitView = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    const flushUserGesture = vi.fn(() => true);
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [
            {
              id: 'service-a',
              type: 'service',
              children: [{ id: 'endpoint-a', type: 'endpoint' }],
            },
          ],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
            nodesById: {
              'service-a': {
                expanded: true,
              },
            },
          },
        }),
        document: {
          commitView,
        },
        transition: {
          requestNavigation: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture,
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.collapseAll();

    expect(flushUserGesture).toHaveBeenCalledTimes(1);
    expect(setPendingStructuralTransitionIntent).toHaveBeenCalledWith({
      direction: 'out',
      focus: { kind: 'global' },
    });
    expect(commitView).toHaveBeenCalledTimes(1);
  });

  it('does not commit expand-all view state when everything is already expanded', () => {
    const commitView = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [
            {
              id: 'service-a',
              type: 'service',
              children: [{ id: 'endpoint-a', type: 'endpoint' }],
            },
          ],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
            nodesById: {
              'service-a': {
                expanded: true,
              },
            },
          },
        }),
        document: {
          commitView,
        },
        transition: {
          requestNavigation: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.expandAll();

    expect(setPendingStructuralTransitionIntent).not.toHaveBeenCalled();
    expect(commitView).not.toHaveBeenCalled();
  });

  it('expands through a single-child chain when requested by focus zoom', () => {
    const commitView = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [
            {
              id: 'service-a',
              type: 'service',
              children: [
                {
                  id: 'wrapper-a',
                  type: 'group',
                  children: [
                    {
                      id: 'group-a',
                      type: 'group',
                      children: [
                        { id: 'endpoint-a', type: 'endpoint' },
                        { id: 'endpoint-b', type: 'endpoint' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
          },
        }),
        document: {
          commitView,
        },
        transition: {
          requestNavigation: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    expect(captured.triggerEntityZoom('service-a', 'in', { expandSingleChildChain: true })).toBe(
      true,
    );

    expect(setPendingStructuralTransitionIntent).toHaveBeenCalledWith({
      direction: 'in',
      focus: { kind: 'single', rootId: 'service-a' },
    });
    const updater = commitView.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    const updated = applyViewUpdate(updater, {
      version: '1',
      schemaRefs: [],
      entities: [],
      relations: [],
      view: {
        kind: 'semantic-diagram-view',
        version: 3,
      },
    });
    expect(updated.view?.nodesById?.['service-a']?.expanded).toBe(true);
    expect(updated.view?.nodesById?.['wrapper-a']?.expanded).toBe(true);
    expect(updated.view?.nodesById?.['group-a']?.expanded).toBe(true);
    expect(updated.view?.nodesById?.['endpoint-a']?.expanded).toBeUndefined();
  });

  it('carries completion callbacks through single-node zoom transitions', () => {
    const setPendingStructuralTransitionIntent = vi.fn();
    const onComplete = vi.fn();
    let captured: ReturnType<typeof useDiagramActions> | null = null;

    function Harness() {
      captured = useDiagramActions({
        state: stateForDoc({
          version: '1',
          schemaRefs: [],
          entities: [
            {
              id: 'service-a',
              type: 'service',
              children: [{ id: 'endpoint-a', type: 'endpoint' }],
            },
          ],
          relations: [],
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
          },
        }),
        document: {
          commitView: vi.fn(),
        },
        transition: {
          requestNavigation: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    expect(captured.triggerEntityZoom('service-a', 'in', { onComplete })).toBe(true);

    expect(setPendingStructuralTransitionIntent).toHaveBeenCalledWith({
      direction: 'in',
      focus: { kind: 'single', rootId: 'service-a' },
      onComplete,
    });
  });
});
