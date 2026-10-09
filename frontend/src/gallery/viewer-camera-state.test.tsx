// @vitest-environment happy-dom
import type { SemanticDocument } from '@tarskia/diagram-semantics';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as layout from '../canvas/rendering/layout/layout-pipeline';
import { useDiagramRenderingController } from '../canvas/useDiagramRenderingController';
import * as validation from '../model/validation';
import * as schemaClosure from '../model/validation/schema-closure';
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
  const initialCamera = { x: 44, y: 55, zoom: 0.7 };
  const initialDocument = gallery.render([]).doc;
  const loaded = {
    ...initialDocument,
    view: { ...initialDocument.view!, layout: { viewport: initialCamera } },
  } as SemanticDocument;
  const catalog = schemaClosure.buildSchemaVersionCatalog(
    semanticBootstrap.builtInSchemaCatalogEntries,
  );
  const validate = vi.spyOn(validation, 'validateDiagramDoc');
  const buildSchema = vi.spyOn(schemaClosure, 'buildSchemaRuntimeFromCatalog');
  const buildLayout = vi.spyOn(layout, 'buildLayoutResult');
  let camera!: ReturnType<typeof useViewerViewport>;
  let rendered!: ReturnType<typeof useDiagramRenderingController>;
  let runtime!: ReturnType<typeof useDiagramSemanticRuntime>;
  let setDoc!: (doc: SemanticDocument) => void;
  let currentDoc!: SemanticDocument;
  let renderCount = 0;
  function Harness({ source }: { source: SemanticDocument }) {
    const [doc, updateDoc] = useState(source);
    currentDoc = doc;
    setDoc = updateDoc;
    renderCount++;
    camera = useViewerViewport(source);
    runtime = useDiagramSemanticRuntime({
      doc,
      validationDocument: source,
      schemaVersionCatalog: catalog,
    });
    rendered = useDiagramRenderingController({ doc, schema: runtime.schema });
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness source={loaded} />));
    expect(camera.savedViewport).toEqual(initialCamera);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildSchema).toHaveBeenCalledTimes(1);
    const initialLayout = rendered.layout,
      initialGraph = rendered.graph,
      initialIndex = runtime.entityIndex;
    const initialCalls = buildLayout.mock.calls.length,
      initialRenders = renderCount;
    await act(async () => camera.persistViewport({ x: 100, y: 200, zoom: 1.2 }));
    expect(currentDoc).toBe(loaded);
    expect(renderCount).toBe(initialRenders);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildLayout).toHaveBeenCalledTimes(initialCalls);
    await act(async () => root.render(<Harness source={loaded} />));
    expect(camera.savedViewport).toEqual({ x: 100, y: 200, zoom: 1.2 });
    expect(rendered.layout).toBe(initialLayout);
    const expanded = {
      ...loaded,
      view: { ...loaded.view!, nodesById: { 'browser-editor-shell': { expanded: true } } },
    };
    await act(async () => setDoc(expanded));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(buildSchema).toHaveBeenCalledTimes(1);
    expect(runtime.entityIndex).toBe(initialIndex);
    expect(rendered.graph).toBe(initialGraph);
    expect(rendered.layout).not.toBe(initialLayout);
    expect(rendered.layout.tree.byId.size).toBeGreaterThan(initialLayout.tree.byId.size);
    await act(async () => setDoc(loaded));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(rendered.layout.tree.byId.size).toBe(initialLayout.tree.byId.size);
    const next = {
      ...loaded,
      entities: [...loaded.entities],
      view: { ...loaded.view!, layout: { viewport: { x: 8, y: 9, zoom: 0.4 } } },
    };
    await act(async () => {
      setDoc(next);
      root.render(<Harness source={next} />);
    });
    expect(camera.savedViewport).toEqual(next.view.layout.viewport);
    expect(validate).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
