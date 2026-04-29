import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../../../model/types';
import { buildSchemaVersionCatalog } from '../../../model/validation';
import { semanticBootstrap } from '../../../semantic/bootstrap';
import { compileDiagramViewState } from '../../../semantic/view/compile-diagram-view-tree';
import tutorialLayoutRaw from '../../../test-fixtures/tutorial-layout.yaml?raw';
import { parseDocument } from '../../../util/serialization';
import { computeViewportForBoundsInVisibleCanvas } from '../../viewport-visibility';
import { buildGraphModel } from '../graph/graph-model';
import { buildStaticCanvasPresentation } from '../presentation/presentation';
import { buildLayoutResult } from './layout-pipeline';

const tutorialDoc = parseDocument(tutorialLayoutRaw);
const tutorialSchemaCatalog = buildSchemaVersionCatalog(
  semanticBootstrap.builtInSchemaCatalogEntries,
);
const tutorialSchema = semanticBootstrap.resolveActivatedSchema(
  tutorialSchemaCatalog,
  tutorialDoc.schemaRefs,
);

const withExpandedNodes = (doc: SemanticDocument, expandedIds: string[]): SemanticDocument => ({
  ...doc,
  view: {
    kind: 'semantic-diagram-view',
    version: 2,
    scopeRootId: doc.view?.scopeRootId,
    nodesById: {
      ...(doc.view?.nodesById ?? {}),
      ...Object.fromEntries(expandedIds.map((id) => [id, { expanded: true }])),
    },
  },
});

const buildTutorialLayout = (expandedIds: string[]) => {
  const doc = withExpandedNodes(tutorialDoc, expandedIds);
  const graph = buildGraphModel(doc, tutorialSchema);
  const viewState = compileDiagramViewState({ doc, schema: tutorialSchema });
  return buildLayoutResult({
    graph,
    viewState,
    layout: doc.view?.layout,
    canvasSize: { width: 1600, height: 900 },
  });
};

describe('tutorial layout', () => {
  it('keeps the tutorial root summary label while contracted', () => {
    const layout = buildTutorialLayout([]);

    expect(layout.tree.byId.get('tour-root')?.summaryLabel).toBe('4 steps');
  });

  it('fits the contracted tutorial to the rendered root instead of hidden nested expansions', () => {
    const graph = buildGraphModel(tutorialDoc, tutorialSchema);
    const viewState = compileDiagramViewState({ doc: tutorialDoc, schema: tutorialSchema });
    const scene = buildLayoutResult({
      graph,
      viewState,
      layout: tutorialDoc.view?.layout,
      canvasSize: { width: 1200, height: 800 },
    });
    const presentation = buildStaticCanvasPresentation({ graph, scene });
    const visibleNodeIds = presentation.nodes
      .filter((node) => !node.style.focusShell && node.opacity > 0.01)
      .map((node) => node.id);
    const renderedRoot = presentation.nodes.find((node) => node.id === 'tour-root');

    expect(visibleNodeIds).toEqual(['tour-root']);
    expect(renderedRoot).toBeDefined();

    const viewport = computeViewportForBoundsInVisibleCanvas({
      bounds: renderedRoot?.rect ?? { x: 0, y: 0, width: 1, height: 1 },
      canvas: { width: 1200, height: 800 },
      minZoom: 0.05,
      maxZoom: 2,
      padding: 0.12,
      leftOcclusion: 0,
    });

    expect(viewport.zoom).toBeGreaterThan(1);
  });

  it('lays out the four top-level tutorial sections as a two-row grid', () => {
    const layout = buildTutorialLayout(['tour-root']);

    const root = layout.tree.byId.get('tour-root');
    const concepts = layout.tree.byId.get('tour-concepts');
    const extensibility = layout.tree.byId.get('tour-schema-extensibility');
    const git = layout.tree.byId.get('tour-git');
    const examples = layout.tree.byId.get('tour-examples');

    expect(root).toBeDefined();
    expect(concepts?.position?.y).toBe(extensibility?.position?.y);
    expect(git?.position?.y).toBe(examples?.position?.y);
    expect(concepts?.position?.x ?? 0).toBeLessThan(extensibility?.position?.x ?? 0);
    expect(git?.position?.x ?? 0).toBeLessThan(examples?.position?.x ?? 0);
    expect(git?.position?.y ?? 0).toBeGreaterThan(concepts?.position?.y ?? 0);
    expect(root?.size.width ?? 0).toBeGreaterThan(root?.size.height ?? 0);
  });

  it('renders the schema and git explainers as nested diagrams with horizontal child rows', () => {
    const layout = buildTutorialLayout(['tour-root', 'tour-concepts', 'tour-git']);

    const schemaDocMini = layout.tree.byId.get('schema-doc-mini');
    const schemaMini = layout.tree.byId.get('schema-mini');
    const documentMini = layout.tree.byId.get('document-mini');
    const viewMini = layout.tree.byId.get('view-mini');
    const gitWorkflowMini = layout.tree.byId.get('git-workflow-mini');
    const gitCodeMini = layout.tree.byId.get('git-code-mini');
    const gitInferenceMini = layout.tree.byId.get('git-inference-mini');
    const gitDiagramMini = layout.tree.byId.get('git-diagram-mini');
    const gitReviewMini = layout.tree.byId.get('git-review-mini');

    expect(schemaDocMini?.layoutMode).toBe('graph');
    expect(schemaMini?.position?.y).toBe(documentMini?.position?.y);
    expect(documentMini?.position?.y).toBe(viewMini?.position?.y);
    expect(schemaMini?.position?.x ?? 0).toBeLessThan(documentMini?.position?.x ?? 0);
    expect(documentMini?.position?.x ?? 0).toBeLessThan(viewMini?.position?.x ?? 0);

    expect(gitWorkflowMini?.layoutMode).toBe('graph');
    expect(gitCodeMini?.position?.y).toBe(gitInferenceMini?.position?.y);
    expect(gitDiagramMini?.position?.y).toBe(gitReviewMini?.position?.y);
    expect(gitDiagramMini?.position?.y ?? 0).toBeGreaterThan(gitCodeMini?.position?.y ?? 0);
    expect(gitCodeMini?.position?.x ?? 0).toBeLessThan(gitInferenceMini?.position?.x ?? 0);
    expect(gitDiagramMini?.position?.x ?? 0).toBeLessThan(gitReviewMini?.position?.x ?? 0);
  });
});
