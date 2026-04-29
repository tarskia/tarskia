import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneTree } from '../canvas/rendering/tree/scene-tree';
import { isBootstrapCanvasSizeUsable } from '../diagram/useCanvasBootstrapController';
import type { SemanticDocument } from '../semantic';
import {
  buildClearFocusScopeDocument,
  buildFocusScopeDocument,
  shouldRunPendingFocusAfterInspectorClose,
  useFocusViewController,
} from './focus-view';
import { shouldDelayWorkspaceCanvasMount } from './WorkspaceDiagramPane';

const buildFocusSceneTree = (params?: {
  hasChildren?: boolean;
  layoutMode?: 'graph' | 'list';
}): SceneTree =>
  ({
    byId: new Map([
      [
        'svc',
        {
          id: 'svc',
          hasChildren: params?.hasChildren ?? true,
          layoutMode: params?.layoutMode ?? 'graph',
          children: [],
        },
      ],
    ]),
  }) as unknown as SceneTree;

const buildDoc = (): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities: [{ id: 'svc', type: 'service' }],
  relations: [],
  view: {
    kind: 'semantic-diagram-view',
    version: 2,
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderFocusController = (
  params: Partial<Parameters<typeof useFocusViewController>[0]> = {},
) => {
  let controller: ReturnType<typeof useFocusViewController> | null = null;
  const baseArgs: Parameters<typeof useFocusViewController>[0] = {
    sceneTree: buildFocusSceneTree(),
    expanded: { svc: true },
    canvasSize: { width: 800, height: 600 },
    showInspector: false,
    commitDoc: vi.fn(),
    flushUserGesture: vi.fn(() => false),
    triggerEntityZoom: vi.fn(() => false),
    setSelectedEntity: vi.fn(),
    setSelectedEdge: vi.fn(),
    ...params,
  };

  function Harness() {
    controller = useFocusViewController(baseArgs);
    return null;
  }

  renderToStaticMarkup(<Harness />);
  if (!controller) {
    throw new Error('Expected focus controller to render');
  }
  return {
    args: baseArgs,
    controller,
  };
};

describe('shouldDelayWorkspaceCanvasMount', () => {
  it('delays mounting for contentful diagrams until an initial viewport is available', () => {
    expect(
      shouldDelayWorkspaceCanvasMount({
        hasContent: true,
      }),
    ).toBe(true);
  });

  it('mounts immediately when the bootstrap viewport is ready', () => {
    expect(
      shouldDelayWorkspaceCanvasMount({
        hasContent: true,
        defaultViewport: { x: 120, y: 80, zoom: 0.9 },
      }),
    ).toBe(false);
  });

  it('keeps delaying until bootstrap resolves the opening viewport', () => {
    expect(
      shouldDelayWorkspaceCanvasMount({
        hasContent: true,
      }),
    ).toBe(true);
  });

  it('does not delay blank diagrams that have nothing to fit yet', () => {
    expect(
      shouldDelayWorkspaceCanvasMount({
        hasContent: false,
      }),
    ).toBe(false);
  });

  it('rejects degenerate canvas measurements during bootstrap', () => {
    expect(isBootstrapCanvasSizeUsable({ width: 567, height: 2 })).toBe(false);
    expect(isBootstrapCanvasSizeUsable({ width: 567, height: 400 })).toBe(true);
  });

  it('builds immediate focus view updates with explicit expansion when transitions are skipped', () => {
    const updated = buildFocusScopeDocument({
      previous: {
        version: '1',
        schemaRefs: [],
        entities: [{ id: 'svc', type: 'service' }],
        relations: [],
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          nodesById: {
            svc: { hidden: true },
          },
        },
      },
      entityId: 'svc',
      expandTarget: true,
    });

    expect(updated.view?.scopeRootId).toBe('svc');
    expect(updated.view?.nodesById?.svc).toEqual({
      hidden: true,
      expanded: true,
    });
  });

  it('builds focus scope updates without changing explicit expansion state', () => {
    const updated = buildFocusScopeDocument({
      previous: {
        version: '1',
        schemaRefs: [],
        entities: [{ id: 'svc', type: 'service' }],
        relations: [],
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
        },
      },
      entityId: 'svc',
      expandTarget: false,
    });

    expect(updated.view?.scopeRootId).toBe('svc');
    expect(updated.view?.nodesById).toBeUndefined();
  });

  it('clears focus scope through the shared focus helper', () => {
    const updated = buildClearFocusScopeDocument({
      ...buildDoc(),
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        scopeRootId: 'svc',
      },
    });

    expect(updated.view?.scopeRootId).toBeUndefined();
  });

  it('queues focus until selected inspector chrome has been cleared', () => {
    const { args, controller } = renderFocusController({
      showInspector: true,
    });

    expect(controller.focusViewOnEntity('svc')).toBe(true);

    expect(args.setSelectedEntity).toHaveBeenCalledWith(undefined);
    expect(args.setSelectedEdge).toHaveBeenCalledWith(undefined);
    expect(args.commitDoc).not.toHaveBeenCalled();
    expect(args.triggerEntityZoom).not.toHaveBeenCalled();
  });

  it('waits for inspector close and canvas resize before running pending focus', () => {
    expect(
      shouldRunPendingFocusAfterInspectorClose({
        showInspector: true,
        previousCanvasWidth: 800,
        currentCanvasWidth: 1220,
        waitFrames: 30,
      }),
    ).toBe(false);
    expect(
      shouldRunPendingFocusAfterInspectorClose({
        showInspector: false,
        previousCanvasWidth: 800,
        currentCanvasWidth: 800,
        waitFrames: 1,
      }),
    ).toBe(false);
    expect(
      shouldRunPendingFocusAfterInspectorClose({
        showInspector: false,
        previousCanvasWidth: 800,
        currentCanvasWidth: 1220,
        waitFrames: 1,
      }),
    ).toBe(true);
    expect(
      shouldRunPendingFocusAfterInspectorClose({
        showInspector: false,
        previousCanvasWidth: 800,
        currentCanvasWidth: 800,
        waitFrames: 30,
      }),
    ).toBe(true);
  });

  it('expands a collapsed target before entering focus scope', () => {
    const { args, controller } = renderFocusController({
      expanded: {},
      triggerEntityZoom: vi.fn(() => true),
    });

    expect(controller.focusViewOnEntity('svc')).toBe(true);

    expect(args.triggerEntityZoom).toHaveBeenCalledTimes(1);
    const zoomOptions = vi.mocked(args.triggerEntityZoom).mock.calls[0]?.[2];
    expect(zoomOptions?.onComplete).toEqual(expect.any(Function));
    expect(args.commitDoc).not.toHaveBeenCalled();

    zoomOptions?.onComplete?.();

    const scopeUpdater = vi.mocked(args.commitDoc).mock.calls[0]?.[0];
    expect(typeof scopeUpdater).toBe('function');
    const scopedDoc = (scopeUpdater as (previous: SemanticDocument) => SemanticDocument)(
      buildDoc(),
    );
    expect(scopedDoc.view?.scopeRootId).toBe('svc');
    expect(scopedDoc.view?.nodesById).toBeUndefined();
  });

  it('commits expansion and scope together when transitions are skipped', () => {
    const { args, controller } = renderFocusController({
      expanded: {},
      skipTransitions: true,
    });

    expect(controller.focusViewOnEntity('svc')).toBe(true);

    expect(args.triggerEntityZoom).not.toHaveBeenCalled();
    const scopeUpdater = vi.mocked(args.commitDoc).mock.calls[0]?.[0];
    expect(typeof scopeUpdater).toBe('function');
    const scopedDoc = (scopeUpdater as (previous: SemanticDocument) => SemanticDocument)(
      buildDoc(),
    );
    expect(scopedDoc.view?.scopeRootId).toBe('svc');
    expect(scopedDoc.view?.nodesById?.svc?.expanded).toBe(true);
  });
});
