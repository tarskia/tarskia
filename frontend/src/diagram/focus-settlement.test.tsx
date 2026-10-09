// @vitest-environment happy-dom
import { getDiagramViewExpandedMap, type SemanticDocument } from '@tarskia/diagram-semantics';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactFlowInstance } from 'reactflow';
import { afterEach, expect, it, vi } from 'vitest';
import { loadGallery } from '../test/curated-rendering';
import { useFocusViewController } from '../viewer-core/focus-view';
import { useDiagramActions } from '../viewer-core/useDiagramActions';
import { useDiagramEngine } from './useDiagramEngine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
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
  const gallery = loadGallery('n8n.yaml');
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
    const [current, commitDoc] = useState(initial.doc);
    const [documentKey, updateDocumentKey] = useState('n8n');
    replaceDocument = commitDoc;
    setDocumentKey = updateDocumentKey;
    doc = current;
    engine = useDiagramEngine({
      doc: current,
      schema: gallery.graph.schema,
      initialViewportKey: documentKey,
      persistViewport,
      skipTransitions: false,
      showDebug: false,
      minZoom: 0.01,
      maxZoom: 2,
    });
    const actions = useDiagramActions({
      state: { doc: current },
      document: { commitDoc },
      transition: {
        requestNavigation: engine.requestNavigation,
        flushUserGesture: engine.flushUserGesture,
        setPendingStructuralTransitionIntent: engine.setPendingStructuralTransitionIntent,
      },
    });
    focus = useFocusViewController({
      sceneTree: engine.compiled.tree,
      expanded: getDiagramViewExpandedMap(current.view),
      getCurrentCanvasSize: engine.getCurrentCanvasSize,
      canvasLayoutVersion: engine.canvasLayoutVersion,
      showInspector: false,
      commitDoc,
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
    const generation = engine.requiredHostGeneration;
    if (generation !== null) await act(async () => engine.notifyDisplayHostSettled(generation));
  };
  const settle = async () => {
    for (let i = 0; i < 120 && (frames.size || engine.requiredHostGeneration !== null); i++)
      await advance(now + 50);
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
      } as unknown as ReactFlowInstance);
    });
    await settle();
    const sourceEntity = engine.compiled.tree.byId.get('browser-editor-shell')?.entity;
    expect(sourceEntity).toBeDefined();
    await act(async () => {
      expect(focus.focusViewOnEntity('browser-editor-shell')).toBe(true);
    });
    for (let i = 0; i < 40 && !engine.transitionOverlay; i++) await advance(now + 50);
    const overlay = engine.transitionOverlay;
    if (!overlay) throw new Error('Expected focus expansion animation');
    await advance(overlay.startedAt + overlay.duration * 0.4);
    expect(doc.view?.scopeRootId).toBeUndefined();
    expect(engine.compiled.tree.byId.get('browser-editor-shell')?.entity).toBe(sourceEntity);
    expect(engine.motionPhase).not.toBe('idle');
    await act(async () => {
      if (interruption === 'replaced-document') {
        replaceDocument(structuredClone(initial.doc));
        setDocumentKey('replacement');
      } else if (interruption === 'gesture') engine.reportUserGestureStart();
      else
        engine.requestNavigation({ kind: 'fit-scene', preset: 'layout', waitForHostSettle: false });
    });
    expect(doc.view?.scopeRootId).toBe(
      interruption === 'replaced-document' ? undefined : 'browser-editor-shell',
    );
    if (interruption === 'replaced-document') {
      expect(engine.compiled.tree.byId.get('browser-editor-shell')?.entity).toBeDefined();
      expect(engine.compiled.tree.byId.get('browser-editor-shell')?.entity).not.toBe(sourceEntity);
    }
    if (interruption === 'gesture') await act(async () => engine.reportUserGestureEnd(viewport));
    await settle();
    expect(doc.view?.scopeRootId).toBe(
      interruption === 'replaced-document' ? undefined : 'browser-editor-shell',
    );
    expect(engine.motionPhase).toBe('idle');
    expect(engine.transitionOverlay).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
