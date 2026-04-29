import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useShellDiagramActions } from './useShellDiagramActions';

describe('useShellDiagramActions', () => {
  it('centerScene requests a scene fit without mutating layout state', () => {
    const commitDoc = vi.fn();
    const requestNavigation = vi.fn();
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
            version: '1',
            schemaRefs: [],
            entities: [],
            relations: [],
            view: {
              kind: 'semantic-diagram-view',
              version: 2,
            },
          },
          expanded: {},
          entityIndex: {
            entries: [],
            byId: new Map(),
            parentById: new Map(),
            childrenByParent: new Map(),
          },
        },
        document: {
          commitDoc,
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation,
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent: vi.fn(),
          flushUserGesture: vi.fn(() => false),
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.centerScene();

    expect(commitDoc).not.toHaveBeenCalled();
    expect(requestNavigation).toHaveBeenCalledWith({
      kind: 'fit-scene',
      preset: 'layout',
    });
  });

  it('keeps expand-all view changes out of undo history', () => {
    const commitDoc = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    const flushUserGesture = vi.fn(() => true);
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
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
              version: 2,
            },
          },
          expanded: {},
          entityIndex: {
            entries: [],
            byId: new Map(),
            parentById: new Map(),
            childrenByParent: new Map(),
          },
        },
        document: {
          commitDoc,
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation: vi.fn(),
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture,
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
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
    expect(commitDoc).toHaveBeenCalledTimes(1);
    const updater = commitDoc.mock.calls[0]?.[0];
    const options = commitDoc.mock.calls[0]?.[1];
    expect(typeof updater).toBe('function');
    expect(options).toEqual({ undoable: false });
    const updated = updater({
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
        version: 2,
      },
    });
    expect(updated.view?.nodesById?.['service-a']?.expanded).toBe(true);
  });

  it('keeps collapse-all view changes out of undo history', () => {
    const commitDoc = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    const flushUserGesture = vi.fn(() => true);
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
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
              version: 2,
              nodesById: {
                'service-a': {
                  expanded: true,
                },
              },
            },
          },
          expanded: {
            'service-a': true,
          },
          entityIndex: {
            entries: [],
            byId: new Map(),
            parentById: new Map(),
            childrenByParent: new Map(),
          },
        },
        document: {
          commitDoc,
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation: vi.fn(),
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture,
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
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
    expect(commitDoc).toHaveBeenCalledTimes(1);
  });

  it('does not commit expand-all view state when everything is already expanded', () => {
    const commitDoc = vi.fn();
    const setPendingStructuralTransitionIntent = vi.fn();
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
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
              version: 2,
              nodesById: {
                'service-a': {
                  expanded: true,
                },
              },
            },
          },
          expanded: {
            'service-a': true,
          },
          entityIndex: {
            entries: [],
            byId: new Map(),
            parentById: new Map(),
            childrenByParent: new Map(),
          },
        },
        document: {
          commitDoc,
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation: vi.fn(),
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
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
    expect(commitDoc).not.toHaveBeenCalled();
  });

  it('expands a collapsed parent after adding a child entity', () => {
    let currentDoc = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'service-a',
          type: 'service',
          children: [],
        },
      ],
      relations: [],
      view: {
        kind: 'semantic-diagram-view' as const,
        version: 2 as const,
      },
    };
    const commitDoc = vi.fn(
      (
        updater: typeof currentDoc | ((previous: typeof currentDoc) => typeof currentDoc),
        _options?: unknown,
      ) => {
        currentDoc = typeof updater === 'function' ? updater(currentDoc) : updater;
      },
    );
    const setPendingStructuralTransitionIntent = vi.fn();
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
            ...currentDoc,
          },
          expanded: {},
          entityIndex: {
            entries: [],
            byId: new Map([
              [
                'service-a',
                {
                  id: 'service-a',
                  type: 'service',
                  children: [],
                },
              ],
            ]),
            parentById: new Map(),
            childrenByParent: new Map([['service-a', []]]),
          },
        },
        document: {
          commitDoc,
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation: vi.fn(),
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
        },
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    if (!captured) {
      throw new Error('Expected shell actions to render');
    }

    captured.addEntity('endpoint', 'service-a');

    expect(setPendingStructuralTransitionIntent).toHaveBeenCalledWith({
      direction: 'in',
      focus: { kind: 'single', rootId: 'service-a' },
    });
    expect(commitDoc).toHaveBeenCalledTimes(2);

    const addOptions = commitDoc.mock.calls[0]?.[1];
    const expandUpdater = commitDoc.mock.calls[1]?.[0];
    const expandOptions = commitDoc.mock.calls[1]?.[1];

    expect(addOptions).toBeUndefined();
    expect(typeof expandUpdater).toBe('function');
    expect(expandOptions).toEqual({ undoable: false });

    const expandedDoc = (expandUpdater as (previous: typeof currentDoc) => typeof currentDoc)({
      ...currentDoc,
    });
    expect(
      (expandedDoc.view as { nodesById?: Record<string, { expanded?: boolean }> } | undefined)
        ?.nodesById?.['service-a']?.expanded,
    ).toBe(true);
  });

  it('carries completion callbacks through single-node zoom transitions', () => {
    const setPendingStructuralTransitionIntent = vi.fn();
    const onComplete = vi.fn();
    let captured: ReturnType<typeof useShellDiagramActions> | null = null;

    function Harness() {
      captured = useShellDiagramActions({
        state: {
          doc: {
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
              version: 2,
            },
          },
          expanded: {},
          entityIndex: {
            entries: [],
            byId: new Map(),
            parentById: new Map(),
            childrenByParent: new Map(),
          },
        },
        document: {
          commitDoc: vi.fn(),
          ensureDiagramView: (view) =>
            view ?? {
              kind: 'semantic-diagram-view',
              version: 2,
            },
        },
        transition: {
          requestNavigation: vi.fn(),
          cancelTransitions: vi.fn(),
          setPendingStructuralTransitionIntent,
          flushUserGesture: vi.fn(() => false),
        },
        selection: {
          setSelectedEntity: vi.fn(),
          setSelectedEdge: vi.fn(),
        },
        rules: {
          canContainEntity: () => true,
          resolveDefaultEntityName: () => undefined,
        },
        sceneQueries: {
          structure: {
            descendantsOf: () => [],
            siblingsOf: () => [],
            ancestorPathOf: () => [],
          } as never,
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
