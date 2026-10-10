// @vitest-environment happy-dom
import { compileView, type DiagramView } from '@tarskia/diagram-semantics';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EntityNodeView } from '../canvas/components/nodes/EntityNodeView';
import { GroupNodeView } from '../canvas/components/nodes/GroupNodeView';
import { loadGallery } from '../test/curated-rendering';
import { GalleryInspector } from '../ui/GalleryInspector';
import { buildInspectorViewModel } from '../viewer-core/buildInspectorViewModel';
import { useDiagramActions } from '../viewer-core/useDiagramActions';
import * as bootstrap from './useCanvasBootstrapController';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('toggles entity and group outlines through the inspector, clears hidden highlights, and never requests motion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let nextFrame: FrameRequestCallback | undefined;
  const raf = vi.fn((callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(bootstrap, 'useCanvasBootstrapController').mockReturnValue({
    initialViewportPending: false,
  });
  const { graph } = loadGallery('chatwoot.yaml');
  let engine!: ReturnType<typeof useDiagramEngine>;
  let currentView: DiagramView | undefined;
  let liveActions!: ReturnType<typeof useDiagramActions>;
  const persistViewport = vi.fn();
  const setViewport = vi.fn();
  const viewport = { x: 21, y: -34, zoom: 0.72 };
  const host = document.createElement('div');
  const root = createRoot(host);
  const bindings = {
    onZoomTrigger: () => false,
    onExpandDetails: () => {},
    onCollapseDetails: () => {},
    onExpandChildGroups: () => {},
    onCollapseChildGroups: () => {},
    onEdgeLabelClick: () => {},
  };
  const controls = { selected: true, disableControlActions: false, hideLocalEdgeLabels: false };
  function Harness({ selectedId }: { selectedId?: string }) {
    const [view, setView] = useState<DiagramView | undefined>(graph.content.view);
    currentView = view;
    engine = useDiagramEngine({
      index: graph,
      view,
      skipTransitions: false,
      showDebug: false,
      persistViewport,
      minZoom: 0.01,
      maxZoom: 2,
    });
    const actions = useDiagramActions({
      state: { index: graph, view },
      document: { commitView: setView },
      transition: engine,
    });
    liveActions = actions;
    const entityId = selectedId ?? engine.presentation.nodes[0].id;
    const model = buildInspectorViewModel({
      view,
      selectedEntity: graph.entityIndex.byId.get(entityId),
      entityIndex: graph.entityIndex,
      schema: graph.schema,
    });
    return (
      <>
        <GalleryInspector
          viewModel={model}
          onToggleHighlight={actions.toggleHighlight}
          onClearHighlights={actions.clearHighlights}
        />
        {engine.presentation.nodes.map((node) => (
          <div
            key={node.id}
            className={node.id === entityId ? 'canvas-node selected' : 'canvas-node'}
          >
            {node.kind === 'group' ? (
              <GroupNodeView id={node.id} view={node} bindings={bindings} controls={controls} />
            ) : (
              <EntityNodeView id={node.id} view={node} />
            )}
          </div>
        ))}
      </>
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () =>
      engine.onCanvasInit({
        getViewport: () => viewport,
        setViewport,
        screenToWorldPosition: (p) => p,
      }),
    );
    const geometry = engine.presentation.nodes.map((n) => [n.id, n.rect, n.opacity]);
    const targets = ['entity', 'group']
      .map((kind) => engine.presentation.nodes.find((n) => n.kind === kind)?.id)
      .filter((id): id is string => Boolean(id));
    expect(targets).toHaveLength(2);
    raf.mockClear();
    setViewport.mockClear();
    persistViewport.mockClear();
    const click = async (text: string) => {
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
      expect(button).toBeDefined();
      await act(async () => button.click());
    };
    for (const id of targets) {
      await act(async () => root.render(<Harness selectedId={id} />));
      await click('Highlight');
      expect(currentView?.nodesById?.[id]?.highlighted).toBe(true);
      expect(host.querySelector(`[data-node-id="${id}"]`)?.classList.contains('highlighted')).toBe(
        true,
      );
      expect(host.querySelector('button[aria-pressed="true"]')).not.toBeNull();
      await click('Highlight');
      expect(currentView?.nodesById?.[id]?.highlighted).toBeUndefined();
      await click('Highlight');
    }
    expect(host.querySelectorAll('.highlighted')).toHaveLength(2);
    expect(engine.presentation.nodes.map((n) => [n.id, n.rect, n.opacity])).toEqual(geometry);
    expect(engine.getCurrentViewport()).toEqual(viewport);
    expect(engine.isTransitionRunning).toBe(false);
    expect(engine.isTransitionQueued).toBe(false);
    expect(engine.transitionFrame).toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(setViewport).not.toHaveBeenCalled();
    expect(persistViewport).not.toHaveBeenCalled();
    await click('Clear highlights');
    expect(
      Object.values(currentView?.nodesById ?? {}).some((n) => n.highlighted !== undefined),
    ).toBe(false);
    expect(host.querySelectorAll('.highlighted')).toHaveLength(0);
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent === 'Clear highlights'),
    ).toBe(false);
    expect(compileView(graph, currentView).tree.byId.get(targets[0])?.view.highlighted).toBe(false);
    await act(async () => {
      liveActions.expandAll();
    });
    const moving = engine.transitionFrame!;
    expect(moving).not.toBeNull();
    const scheduled = raf.mock.calls.length;
    await act(async () => {
      liveActions.toggleHighlight(targets[0]);
    });
    expect(engine.transitionFrame?.id).toBe(moving.id);
    expect(engine.transitionFrame?.startedAt).toBe(moving.startedAt);
    expect(raf).toHaveBeenCalledTimes(scheduled);
    const track = engine.transitionFrame?.nodes.find((n) => n.id === targets[0]);
    expect((track?.toView ?? track?.fromView)?.content.highlighted).toBe(true);
    await act(async () => {
      nextFrame?.(performance.now() + 10000);
    });
    expect(engine.isTransitionRunning).toBe(false);
    expect(engine.presentation.nodes.find((n) => n.id === targets[0])?.content.highlighted).toBe(
      true,
    );
  } finally {
    await act(async () => root.unmount());
  }
});
