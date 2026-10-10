// @vitest-environment happy-dom

import * as semantics from '@tarskia/diagram-semantics';
import * as schemaClosure from '@tarskia/diagram-semantics';
import {
  applyDiagramViewOperation,
  type DiagramView,
  type DiagramViewOperation,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as layout from '../canvas/rendering/layout/layout-pipeline';
import { useDiagramRenderingController } from '../canvas/useDiagramRenderingController';
import * as validation from '../model/validation';
import { semanticBootstrap } from '../semantic/bootstrap';
import { useDiagramSemanticRuntime } from '../semantic/runtime';
import { loadGallery } from '../test/curated-rendering';
import { useViewerViewport } from './useViewerViewport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps camera persistence and view changes off semantic validation, restoring each loaded camera', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const gallery = loadGallery('n8n.yaml');
  const initialCamera = { rect: { x: 44, y: 55, width: 1440, height: 900 } };
  const initialDocument = gallery.render([]).doc;
  const loaded = {
    ...initialDocument,
    view: { ...initialDocument.view!, camera: initialCamera },
  } as SemanticDocument;
  const catalog = schemaClosure.buildSchemaVersionCatalog(
    semanticBootstrap.builtInSchemaCatalogEntries,
  );
  const validate = vi.spyOn(validation, 'validateDiagramDoc');
  const buildSchema = vi.spyOn(schemaClosure, 'buildSchemaRuntimeFromCatalog');
  const buildLayout = vi.spyOn(layout, 'buildLayoutResult');
  const buildIndex = vi.spyOn(semantics, 'buildSemanticIndex');
  let camera!: ReturnType<typeof useViewerViewport>;
  let rendered!: ReturnType<typeof useDiagramRenderingController>;
  let runtime!: ReturnType<typeof useDiagramSemanticRuntime>;
  let setView!: (view: DiagramView | undefined) => void;
  let currentView: DiagramView | undefined;
  let renderCount = 0;
  function Harness({ source }: { source: SemanticDocument }) {
    const content = useMemo(() => {
      const { view: _view, ...content } = source;
      return content;
    }, [source]);
    const [view, updateView] = useState(source.view);
    currentView = view;
    setView = updateView;
    renderCount++;
    camera = useViewerViewport(source);
    runtime = useDiagramSemanticRuntime({
      doc: content,
      validationDocument: source,
      schemaVersionCatalog: catalog,
    });
    rendered = useDiagramRenderingController({ index: runtime.index, view });
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness source={loaded} />));
    expect(camera.savedCamera).toEqual(initialCamera);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildSchema).toHaveBeenCalledTimes(1);
    const initialLayout = rendered.layout,
      initialGraph = rendered.graph,
      initialIndex = runtime.index;
    const initialIndexCalls = buildIndex.mock.calls.length;
    const initialCalls = buildLayout.mock.calls.length,
      initialRenders = renderCount;
    await act(async () => camera.persistViewport({ x: 100, y: 200, zoom: 1.2 }));
    expect(currentView).toBe(loaded.view);
    expect(renderCount).toBe(initialRenders);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildLayout).toHaveBeenCalledTimes(initialCalls);
    await act(async () => root.render(<Harness source={loaded} />));
    expect(camera.savedCamera).toEqual(initialCamera);
    expect(rendered.layout).toBe(initialLayout);
    const expanded = {
      ...loaded,
      view: { ...loaded.view!, nodesById: { 'browser-editor-shell': { expanded: true } } },
    };
    await act(async () => setView(expanded.view));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildSchema).toHaveBeenCalledTimes(1);
    expect(runtime.index).toBe(initialIndex);
    expect(rendered.graph).toBe(initialGraph);
    expect(rendered.layout).not.toBe(initialLayout);
    expect(rendered.layout.tree.byId.size).toBeGreaterThan(initialLayout.tree.byId.size);
    await act(async () => setView(loaded.view));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(rendered.layout.tree.byId.size).toBe(initialLayout.tree.byId.size);
    expect(buildIndex).toHaveBeenCalledTimes(initialIndexCalls);
    const searchTarget = runtime.index.tree.byId.get('browser-editor-shell')?.children[0]?.id;
    if (!searchTarget) throw new Error('Expected a nested gallery entity for search reveal');
    const operations: DiagramViewOperation[] = [
      { kind: 'enter-focus', entityId: 'browser-editor-shell', expandTarget: true },
      { kind: 'clear-focus' },
      { kind: 'collapse-all' },
      {
        kind: 'search-reveal',
        entityIds: new Set([searchTarget]),
      },
    ];
    for (const operation of operations) {
      const nextView = applyDiagramViewOperation(runtime.index.tree, currentView, operation);
      expect(nextView).not.toBe(currentView);
      await act(async () => setView(nextView));
      expect(runtime.index).toBe(initialIndex);
      expect(buildIndex).toHaveBeenCalledTimes(initialIndexCalls);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(buildSchema).toHaveBeenCalledTimes(1);
    }
    const next = {
      ...loaded,
      entities: [...loaded.entities],
      view: {
        ...loaded.view!,
        camera: { rect: { x: 8, y: 9, width: 1440 / 0.4, height: 900 / 0.4 } },
      },
    };
    await act(async () => {
      setView(next.view);
      root.render(<Harness source={next} />);
    });
    expect(camera.savedCamera).toEqual(next.view.camera);
    expect(validate).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
