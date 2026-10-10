// @vitest-environment happy-dom
import {
  buildSemanticIndex,
  getDiagramViewExpandedMap,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasCamera } from '../canvas/camera';
import { loadGallery } from '../test/curated-rendering';
import { useFocusViewController } from '../viewer-core/focus-view';
import { useDiagramActions } from '../viewer-core/useDiagramActions';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  'completed',
  'gesture',
  'superseded',
  'replaced-document',
] as const)('settles pending focus safely after %s', async (interruption) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let now = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const gallery = loadGallery(interruption === 'completed' ? 'chatwoot.yaml' : 'n8n.yaml');
  const target = interruption === 'completed' ? 'rails-control-plane' : 'browser-editor-shell';
  const initial = gallery.render([]);
  let engine!: ReturnType<typeof useDiagramEngine>;
  let focus!: ReturnType<typeof useFocusViewController>;
  let doc!: SemanticDocument;
  let replaceDocument!: (next: SemanticDocument) => void;
  let setDocumentKey!: (key: string) => void;
  const persistViewport = vi.fn();
  const selectEntity = vi.fn(),
    selectEdge = vi.fn();
  function Harness() {
    const [current, updateContent] = useState(initial.doc);
    const [view, commitView] = useState(initial.doc.view);
    const index = useMemo(() => buildSemanticIndex(current, gallery.graph.schema), [current]);
    const [documentKey, updateDocumentKey] = useState('n8n');
    replaceDocument = (next) => {
      updateContent(next);
      commitView(next.view);
    };
    setDocumentKey = updateDocumentKey;
    doc = { ...current, view };
    engine = useDiagramEngine({
      index,
      view,
      initialViewportKey: documentKey,
      persistViewport,
      skipTransitions: false,
      showDebug: false,
      minZoom: 0.01,
      maxZoom: 2,
    });
    const actions = useDiagramActions({
      state: { index, view },
      document: { commitView },
      transition: {
        requestNavigation: engine.requestNavigation,
        flushUserGesture: engine.flushUserGesture,
        setPendingStructuralTransitionIntent: engine.setPendingStructuralTransitionIntent,
      },
    });
    focus = useFocusViewController({
      index,
      sceneTree: engine.compiled.tree,
      expanded: getDiagramViewExpandedMap(view),
      getCurrentCanvasSize: engine.getCurrentCanvasSize,
      canvasLayoutVersion: engine.canvasLayoutVersion,
      showInspector: false,
      commitView,
      flushUserGesture: engine.flushUserGesture,
      triggerEntityZoom: actions.triggerEntityZoom,
      setSelectedEntity: selectEntity,
      setSelectedEdge: selectEdge,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  let viewport = { x: 0, y: 0, zoom: 1 };
  const canvas = document.createElement('div');
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1280,
    bottom: 720,
    width: 1280,
    height: 720,
    toJSON: () => ({}),
  });
  const advance = async (time: number) => {
    await act(async () => {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    });
  };
  const settle = async () => {
    for (let i = 0; i < 120 && frames.size; i++) await advance(now + 50);
  };
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      engine.onCanvasElementChange(canvas);
      engine.onCanvasInit({
        getViewport: () => viewport,
        setViewport: (next: typeof viewport) => {
          viewport = next;
          return Promise.resolve(true);
        },
      } as unknown as CanvasCamera);
    });
    await settle();
    const sourceEntity = engine.compiled.tree.byId.get(target)?.entity;
    expect(sourceEntity).toBeDefined();
    await act(async () => {
      expect(focus.focusViewOnEntity(target)).toBe(true);
    });
    for (let i = 0; i < 40 && !engine.transitionFrame; i++) await advance(now + 50);
    const overlay = engine.transitionFrame;
    if (!overlay) throw new Error('Expected focus expansion animation');
    await advance(overlay.startedAt + overlay.duration * 0.4);
    expect(doc.view?.scopeRootId).toBeUndefined();
    expect(engine.compiled.tree.byId.get(target)?.entity).toBe(sourceEntity);
    expect(engine.motionPhase).not.toBe('idle');
    await act(async () => {
      if (interruption === 'completed') return;
      if (interruption === 'replaced-document') {
        replaceDocument(structuredClone(initial.doc));
        setDocumentKey('replacement');
      } else if (interruption === 'gesture') engine.reportUserGestureStart();
      else engine.requestNavigation({ kind: 'fit-scene', preset: 'layout' });
    });
    if (interruption === 'completed') await settle();
    expect(doc.view?.scopeRootId).toBe(interruption === 'replaced-document' ? undefined : target);
    if (interruption === 'replaced-document') {
      expect(engine.compiled.tree.byId.get(target)?.entity).toBeDefined();
      expect(engine.compiled.tree.byId.get(target)?.entity).not.toBe(sourceEntity);
    }
    if (interruption === 'gesture') await act(async () => engine.reportUserGestureEnd(viewport));
    await settle();
    expect(doc.view?.scopeRootId).toBe(interruption === 'replaced-document' ? undefined : target);
    expect(engine.motionPhase).toBe('idle');
    expect(engine.transitionFrame).toBeNull();
    if (interruption === 'completed') {
      const context = engine.presentation.nodes.filter(
        (node) => node.content.externalContext || node.content.focusBoundary,
      );
      expect(context.length).toBe(5);
      for (const node of context) {
        expect(node.rect.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
        expect(node.rect.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
        expect((node.rect.x + node.rect.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(
          1280,
        );
        expect((node.rect.y + node.rect.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(
          720,
        );
      }
      await act(async () => {
        expect(focus.focusViewOnEntity('channel-providers')).toBe(true);
      });
      await settle();
      expect(doc.view?.scopeRootId).toBe('channel-providers');
      expect(
        engine.presentation.nodes.find((node) => node.id === 'channel-providers')?.content
          .focusBoundary,
      ).toBe(true);
      expect(engine.presentation.overlayEdges.length).toBeGreaterThan(0);
    }
  } finally {
    await act(async () => root.unmount());
  }
});
