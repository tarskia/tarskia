import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSemanticIndex, compileView, type SemanticDocument } from '@tarskia/diagram-semantics';
import { buildLayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import { buildStaticCanvasPresentation } from '../canvas/rendering/presentation/presentation';
import { buildTransitionFrameState } from '../canvas/rendering/transition/overlay';
import { buildSchemaVersionCatalog } from '../model/validation/schema-closure';
import { semanticBootstrap } from '../semantic/bootstrap';
import { buildDiagramSemanticRuntime } from '../semantic/runtime';
import { loadDiagramDocFromRaw } from '../viewer-core/loadDiagramDocFromRaw';

const directory = path.resolve(import.meta.dirname, '../../../gallery/curated');
export const galleryFiles: { file: string; title: string }[] = JSON.parse(
  readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
);
const catalog = buildSchemaVersionCatalog(semanticBootstrap.builtInSchemaCatalogEntries);

export const loadGallery = (file: string) => {
  const loaded = loadDiagramDocFromRaw({
    raw: readFileSync(path.join(directory, file), 'utf8'),
    streamName: file,
    sourceLabel: file,
  });
  const runtime = buildDiagramSemanticRuntime({
    ...loaded,
    schemaVersionCatalog: catalog,
    fallbackSchema: semanticBootstrap.schemaModules[0],
  });
  const graph = buildSemanticIndex(loaded.doc, runtime.schema);
  const render = (expanded?: string[], scopeRootId?: string) => {
    const doc: SemanticDocument = expanded
      ? {
          ...loaded.doc,
          view: {
            kind: 'semantic-diagram-view',
            version: 3,
            scopeRootId,
            nodesById: Object.fromEntries(
              graph.entities.map((entity) => [
                entity.id,
                { expanded: expanded.includes(entity.id) },
              ]),
            ),
          },
        }
      : loaded.doc;
    const scene = buildLayoutResult({
      graph: buildSemanticIndex(doc, runtime.schema),
      viewState: compileView(graph, doc.view),
    });
    return {
      doc,
      scene,
      presentation: buildStaticCanvasPresentation({ scene }),
    };
  };
  return { graph, render };
};

export type RenderedGallery = ReturnType<ReturnType<typeof loadGallery>['render']>;
export const planGalleryTransition = (from: RenderedGallery, to: RenderedGallery) => ({
  overlay: buildTransitionFrameState({
    id: 1,
    startedAt: 0,
    duration: 1000,
    fromPresentation: from.presentation,
    toPresentation: to.presentation,
  }),
});
