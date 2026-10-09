import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSemanticIndex, compileView, type SemanticDocument } from '@tarskia/diagram-semantics';
import { buildLayoutResult } from '../canvas/rendering/layout/layout-pipeline';
import { buildStaticCanvasPresentation } from '../canvas/rendering/presentation/presentation';
import { buildTransitionOverlayState } from '../canvas/rendering/transition/overlay';
import { buildTransitionPlanningAdvisory } from '../canvas/rendering/transition/sequencer';
import {
  buildTimedTransitionPlan,
  buildTimedTransitionSequence,
} from '../canvas/rendering/transition/timed-plan';
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
            version: 2,
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
    return { doc, scene, presentation: buildStaticCanvasPresentation({ scene }) };
  };
  return { graph, render };
};

export type RenderedGallery = ReturnType<ReturnType<typeof loadGallery>['render']>;
export const planGalleryTransition = (
  from: RenderedGallery,
  to: RenderedGallery,
  direction: 'in' | 'out',
) => {
  const planningAdvisory = buildTransitionPlanningAdvisory({
    direction,
    fromTree: from.scene.tree,
    toTree: to.scene.tree,
    fromEdges: from.scene.edges,
    toEdges: to.scene.edges,
  });
  const timedPlan = buildTimedTransitionPlan({ planningAdvisory });
  const timedSequence = buildTimedTransitionSequence({ planningAdvisory });
  const overlay = buildTransitionOverlayState({
    id: 1,
    startedAt: 0,
    duration: 1000,
    planningAdvisory,
    timedPlan,
    timedSequence,
    fromPresentation: from.presentation,
    toPresentation: to.presentation,
  });
  return { planningAdvisory, timedPlan, timedSequence, overlay };
};
