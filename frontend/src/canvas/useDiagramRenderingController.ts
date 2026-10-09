import {
  buildSemanticIndex,
  type CompiledDiagramEdge,
  compileView,
  type DiagramView,
  getSingleChildChainTop,
  type SchemaModule,
  type SemanticDocument,
  type SemanticIndex,
} from '@tarskia/diagram-semantics';
import { useCallback, useMemo } from 'react';
import { selectDeclarativeDiagramViewState } from '../semantic/view/declarative-view-state';
import { buildLayoutResult, type LayoutResult } from './rendering/layout/layout-pipeline';
import {
  buildTransitionPlanningAdvisory,
  type TransitionPlanningAdvisory,
} from './rendering/transition/sequencer';
import type { TimedTransitionPlan } from './rendering/transition/timed-plan';
import { collectSubtreeIds } from './rendering/transition/viewport';

export type { LayoutResult, TimedTransitionPlan, TransitionPlanningAdvisory };

const viewportHelpers = {
  collectSubtreeIds,
};

export function useDiagramRenderingController(params: {
  doc?: SemanticDocument;
  schema?: SchemaModule;
  index?: SemanticIndex;
  view?: DiagramView;
}) {
  const graph = useMemo(() => {
    if (params.index) return params.index;
    if (!params.doc || !params.schema) throw new Error('Diagram content and schema are required');
    return buildSemanticIndex(params.doc, params.schema);
  }, [params.index, params.doc, params.schema]);
  const view = params.index ? params.view : params.doc?.view;
  const declarativeViewState = useMemo(() => selectDeclarativeDiagramViewState({ view }), [view]);
  const viewState = useMemo(() => compileView(graph, view), [graph, view]);
  const layout = useMemo(() => buildLayoutResult({ graph, viewState }), [graph, viewState]);

  const buildTransitionAdvisory = useCallback(
    ({
      direction,
      fromTree,
      toTree,
      fromEdges,
      toEdges,
    }: {
      direction: 'in' | 'out';
      fromTree: LayoutResult['tree'];
      toTree: LayoutResult['tree'];
      fromEdges: CompiledDiagramEdge[];
      toEdges: CompiledDiagramEdge[];
    }) =>
      buildTransitionPlanningAdvisory({
        direction,
        fromTree,
        toTree,
        fromEdges,
        toEdges,
      }),
    [],
  );

  const resolveViewportFocusRoot = useCallback(
    (tree: LayoutResult['tree'], requestedRootId: string) =>
      getSingleChildChainTop(tree, requestedRootId),
    [],
  );
  return useMemo(
    () => ({
      graph,
      layout,
      declarativeViewState,
      buildTransitionAdvisory,
      resolveViewportFocusRoot,
      viewport: viewportHelpers,
    }),
    [buildTransitionAdvisory, declarativeViewState, graph, layout, resolveViewportFocusRoot],
  );
}
