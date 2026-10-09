import {
  type CompiledDiagramEdge,
  compileDiagramViewState,
  getSingleChildChainTop,
  type SchemaModule,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';
import { useCallback, useMemo } from 'react';
import {
  buildSemanticStateDocument,
  combineDiagramSemanticAndDeclarativeViewState,
  selectDeclarativeDiagramViewState,
  useDiagramSemanticState,
} from '../semantic/view/declarative-view-state';
import { buildGraphModel } from './rendering/graph/graph-model';
import { buildLayoutResult, type LayoutResult } from './rendering/layout/layout-pipeline';
import { buildRenderedDiagramViewQueries } from './rendering/scene/queries';
import {
  type AnimationSettings,
  cloneAnimationSettings,
} from './rendering/transition/animation-constants';
import {
  buildTransitionPlanningAdvisory,
  type TransitionPlanningAdvisory,
} from './rendering/transition/sequencer';
import type { TimedTransitionPlan } from './rendering/transition/timed-plan';
import {
  collectLayoutBounds,
  collectSubtreeIds,
  computeViewportForBounds,
  computeViewRect,
} from './rendering/transition/viewport';
import { buildCanonicalDiagramStructureQueries } from './structure/queries';

export type { AnimationSettings, LayoutResult, TimedTransitionPlan, TransitionPlanningAdvisory };
export { cloneAnimationSettings };

const viewportHelpers = {
  collectLayoutBounds,
  collectSubtreeIds,
  computeViewRect,
  computeViewportForBounds,
};

export function useDiagramRenderingController({
  doc,
  schema,
}: {
  doc: SemanticDocument;
  schema: SchemaModule;
}) {
  const semanticState = useDiagramSemanticState(doc);
  const declarativeViewState = useMemo(
    () => selectDeclarativeDiagramViewState({ view: doc.view }),
    [doc.view],
  );
  const semanticDocument = useMemo(
    () => buildSemanticStateDocument(semanticState),
    [semanticState],
  );
  const renderDocument = useMemo(
    () =>
      combineDiagramSemanticAndDeclarativeViewState({
        semanticState,
        declarativeViewState,
      }),
    [declarativeViewState, semanticState],
  );
  const graph = useMemo(
    () => buildGraphModel(semanticDocument, schema),
    [schema, semanticDocument],
  );
  const viewState = useMemo(
    () => compileDiagramViewState({ doc: renderDocument, schema }),
    [renderDocument, schema],
  );
  const layout = useMemo(
    () =>
      buildLayoutResult({
        graph,
        viewState,
      }),
    [graph, viewState],
  );

  const buildTransitionAdvisory = useCallback(
    ({
      direction,
      fromTree,
      toTree,
      fromEdges,
      toEdges,
      animationSettings,
    }: {
      direction: 'in' | 'out';
      fromTree: LayoutResult['tree'];
      toTree: LayoutResult['tree'];
      fromEdges: CompiledDiagramEdge[];
      toEdges: CompiledDiagramEdge[];
      animationSettings: AnimationSettings;
    }) =>
      buildTransitionPlanningAdvisory({
        direction,
        fromTree,
        toTree,
        fromEdges,
        toEdges,
        animationSettings,
      }),
    [],
  );

  const resolveViewportFocusRoot = useCallback(
    (tree: LayoutResult['tree'], requestedRootId: string) =>
      getSingleChildChainTop(tree, requestedRootId),
    [],
  );
  const sceneQueries = useMemo(
    () => ({
      structure: buildCanonicalDiagramStructureQueries(graph),
      view: buildRenderedDiagramViewQueries(layout),
    }),
    [graph, layout],
  );

  return useMemo(
    () => ({
      graph,
      layout,
      declarativeViewState,
      buildTransitionAdvisory,
      resolveViewportFocusRoot,
      sceneQueries,
      viewport: viewportHelpers,
    }),
    [
      buildTransitionAdvisory,
      declarativeViewState,
      graph,
      layout,
      resolveViewportFocusRoot,
      sceneQueries,
    ],
  );
}
