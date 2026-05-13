import { describe, expect, it } from 'vitest';
import { buildSchemaVersionCatalog, type SemanticDocument } from '../../../semantic';
import { semanticBootstrap } from '../../../semantic/bootstrap';
import { compileDiagramViewState } from '../../../semantic/view/compile-diagram-view-tree';
import occlusionFixtureRaw from '../../../test-fixtures/commerce-occlusion.yaml?raw';
import { parseDocument } from '../../../util/serialization';
import { buildGraphModel } from '../../rendering/graph/graph-model';
import { buildLayoutResult } from '../../rendering/layout/layout-pipeline';
import { buildStaticCanvasPresentation } from '../../rendering/presentation/presentation';
import { resolveEdgeOverlayRenderState } from './edge-overlay-state';

const sampleSchemaCatalog = buildSchemaVersionCatalog(
  semanticBootstrap.builtInSchemaCatalogEntries,
);
const sampleSchema = semanticBootstrap.resolveActivatedSchema(
  sampleSchemaCatalog,
  parseDocument(occlusionFixtureRaw).schemaRefs,
);

const withExpandedNodes = (doc: SemanticDocument, expandedIds: string[]): SemanticDocument => ({
  ...doc,
  view: {
    kind: 'semantic-diagram-view',
    version: 2,
    nodesById: Object.fromEntries(expandedIds.map((id) => [id, { expanded: true }])),
  },
});

describe('commerce occlusion', () => {
  it('keeps collapsed cache edges out of unrelated data sibling branches even when their solid-over ownership includes the shared platform ancestor', () => {
    const doc = withExpandedNodes(parseDocument(occlusionFixtureRaw), [
      'data-platform',
      'orders-db',
      'orders-schema',
    ]);
    const graph = buildGraphModel(doc, sampleSchema);
    const viewState = compileDiagramViewState({ doc, schema: sampleSchema });
    const scene = buildLayoutResult({
      graph,
      viewState,
      canvasSize: { width: 1800, height: 1200 },
    });
    const presentation = buildStaticCanvasPresentation({
      scene,
    });
    const renderState = resolveEdgeOverlayRenderState({
      edges: presentation.overlayEdges,
      nodes: presentation.nodes,
    });

    const edge = renderState.edges.find(
      (candidate) => candidate.relationId === 'rel-orders-cache-products',
    );
    const ordersSchema = presentation.nodes.find((node) => node.id === 'orders-schema');
    const orders = presentation.nodes.find((node) => node.id === 'orders');

    expect(edge).toBeDefined();
    expect(ordersSchema).toBeDefined();
    expect(orders).toBeDefined();

    const rectContainsPoint = (
      rect: { x: number; y: number; width: number; height: number },
      point: { x: number; y: number },
    ) =>
      point.x >= rect.x &&
      point.y >= rect.y &&
      point.x <= rect.x + rect.width &&
      point.y <= rect.y + rect.height;

    const segmentIntersectsRect = (
      segment:
        | { kind: 'vertical'; x: number; y1: number; y2: number }
        | { kind: 'horizontal'; y: number; x1: number; x2: number },
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      if (segment.kind === 'vertical') {
        return (
          segment.x >= rect.x &&
          segment.x <= rect.x + rect.width &&
          Math.max(Math.min(segment.y1, segment.y2), rect.y) <=
            Math.min(Math.max(segment.y1, segment.y2), rect.y + rect.height)
        );
      }
      return (
        segment.y >= rect.y &&
        segment.y <= rect.y + rect.height &&
        Math.max(Math.min(segment.x1, segment.x2), rect.x) <=
          Math.min(Math.max(segment.x1, segment.x2), rect.x + rect.width)
      );
    };

    const samplePointWithinRect = (
      segment:
        | { kind: 'vertical'; x: number; y1: number; y2: number }
        | { kind: 'horizontal'; y: number; x1: number; x2: number },
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      if (segment.kind === 'vertical') {
        const y = Math.max(rect.y, Math.min(rect.y + rect.height, (segment.y1 + segment.y2) / 2));
        return { x: segment.x, y };
      }
      const x = Math.max(rect.x, Math.min(rect.x + rect.width, (segment.x1 + segment.x2) / 2));
      return { x, y: segment.y };
    };

    const segments = edge
      ? [
          {
            kind: 'horizontal' as const,
            y: edge.geometry.sourcePoint.y,
            x1: edge.geometry.sourcePoint.x,
            x2: edge.geometry.control1.x,
          },
          {
            kind: 'vertical' as const,
            x: edge.geometry.control1.x,
            y1: edge.geometry.control1.y,
            y2: edge.geometry.control2.y,
          },
          {
            kind: 'horizontal' as const,
            y: edge.geometry.targetPoint.y,
            x1: edge.geometry.control2.x,
            x2: edge.geometry.targetPoint.x,
          },
        ]
      : [];
    const cacheEdgeBlockedByOrders =
      orders !== undefined &&
      segments.some((segment) => {
        if (!segmentIntersectsRect(segment, orders.rect)) {
          return false;
        }
        const samplePoint = samplePointWithinRect(segment, orders.rect);
        return edge?.blockerOccluders.some((rect) => rectContainsPoint(rect, samplePoint));
      });

    expect(edge).toBeDefined();
    expect(ordersSchema).toBeDefined();
    expect(orders).toBeDefined();
    expect(edge).toMatchObject({
      relationId: 'rel-orders-cache-products',
      sourceId: 'cache-session',
      targetId: 'app-checkout',
      solidOverNodeIds: ['app-checkout', 'cache-session', 'data-platform'],
    });
    expect(cacheEdgeBlockedByOrders).toBe(true);
  });
});
