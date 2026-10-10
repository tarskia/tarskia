import {
  applyDiagramViewOperation,
  applySavedView,
  compileView,
  hashDiagramContent,
  type SavedDiagramView,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { loadGallery } from '../test/curated-rendering';
import { createSharedViewUrl, decodeSharedView, encodeSharedView } from './shared-view-link';

const record = (): SavedDiagramView => ({
  kind: 'semantic-diagram-saved-view',
  version: 1,
  diagram: { namespace: 'tarskia', slug: 'n8n' },
  revision: '123456abcdef',
  view: {
    kind: 'semantic-diagram-view',
    version: 3,
    scopeRootId: 'scope',
    nodesById: { scope: { expanded: true }, child: { expanded: false, highlighted: false } },
    camera: { anchorId: 'scope', rect: { x: -44, y: 56, width: 1400, height: 800 } },
  },
});
async function compress(text: string) {
  const bytes = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer(),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
describe('shared view links', () => {
  it('roundtrips scope, expansion, highlight flags and framing while keeping q and the source URL unchanged', async () => {
    const source = 'https://example.com/gallery/tarskia/n8n?q=worker';
    const saved = record();
    const url = new URL(await createSharedViewUrl(saved, source));
    expect(url.searchParams.get('q')).toBe('worker');
    const decoded = await decodeSharedView(url.searchParams.get('view')!, saved.diagram);
    expect(decoded).toEqual({
      ...saved,
      view: {
        ...saved.view,
        nodesById: { scope: { expanded: true }, child: { highlighted: false } },
      },
    });
    expect(source).not.toContain('view=');
  });
  // Camera captured from the real fully expanded viewer at 1200 × 796 after the readable-camera update.
  it('keeps fully expanded curated supabase within 1600 characters with identical compiled nodes', async () => {
    const { graph } = loadGallery('supabase.yaml');
    const view = applyDiagramViewOperation(graph.tree, undefined, { kind: 'expand-all' });
    const saved: SavedDiagramView = {
      ...record(),
      diagram: { namespace: 'tarskia', slug: 'supabase' },
      revision: hashDiagramContent(graph.content),
      view: {
        ...view,
        camera: {
          rect: {
            x: -906.9285714285716,
            y: -625.4285714285714,
            width: 3422.857142857143,
            height: 2082.857142857143,
          },
        },
      },
    };
    const url = new URL(
      await createSharedViewUrl(saved, 'https://tarskia.com/gallery/tarskia/supabase'),
    );
    expect(url.toString().length).toBeLessThanOrEqual(1600);
    const decoded = await decodeSharedView(url.searchParams.get('view')!, saved.diagram);
    expect(decoded.view.camera).toEqual(saved.view.camera);
    expect([...compileView(graph, decoded.view).tree.byId.keys()]).toEqual([
      ...compileView(graph, view).tree.byId.keys(),
    ]);
    console.info(`Fully expanded supabase share URL: ${url.toString().length} characters`);
  });
  it.each([
    '',
    '!',
    'a'.repeat(8001),
    'AAAA',
  ])('rejects malformed or oversized encoded data', async (encoded) => {
    await expect(decodeSharedView(encoded, record().diagram)).rejects.toThrow();
  });
  it('rejects truncated streams, oversized inflated payloads and invalid records', async () => {
    const valid = await encodeSharedView(record());
    await expect(decodeSharedView(valid.slice(0, -8), record().diagram)).rejects.toThrow();
    const bomb = await compress(' '.repeat(65537));
    expect(bomb.length).toBeLessThan(8000);
    await expect(decodeSharedView(bomb, record().diagram)).rejects.toThrow('size limit');
    for (const value of [
      'null',
      '[]',
      '{',
      JSON.stringify({ ...record(), diagram: undefined, version: 9 }),
    ]) {
      await expect(decodeSharedView(await compress(value), record().diagram)).rejects.toThrow();
    }
  });
  it('applies a link against changed content and reports only dropped IDs', async () => {
    const { graph } = loadGallery('n8n.yaml');
    const retained = graph.entities[0].id;
    const saved = {
      ...record(),
      view: {
        ...record().view,
        scopeRootId: retained,
        nodesById: { [retained]: { expanded: true }, removed: { highlighted: true } },
        camera: { anchorId: 'gone', rect: { x: 0, y: 0, width: 10, height: 10 } },
      },
    };
    const decoded = await decodeSharedView(await encodeSharedView(saved), saved.diagram);
    const applied = applySavedView(graph, decoded, hashDiagramContent(graph.content));
    expect(applied.view.scopeRootId).toBe(retained);
    expect(applied.view.nodesById).toEqual({ [retained]: { expanded: true } });
    expect(applied.view.camera).toBeUndefined();
    expect(applied.report).toEqual({
      revisionMatches: false,
      droppedIds: ['gone', 'removed'],
      scopeRootDropped: false,
      anchorDropped: true,
    });
  });
});

it('carries a toggled Chatwoot highlight in a copied share link', async () => {
  const { graph } = loadGallery('chatwoot.yaml');
  const entityId = graph.entities[0].id;
  const view = applyDiagramViewOperation(graph.tree, graph.content.view, {
    kind: 'toggle-highlight',
    entityId,
  });
  const saved: SavedDiagramView = {
    kind: 'semantic-diagram-saved-view',
    version: 1,
    diagram: { namespace: 'tarskia', slug: 'chatwoot' },
    revision: hashDiagramContent(graph.content),
    view: view!,
  };
  const url = new URL(
    await createSharedViewUrl(saved, 'https://tarskia.com/gallery/tarskia/chatwoot'),
  );
  const decoded = await decodeSharedView(url.searchParams.get('view')!, saved.diagram);
  expect(decoded.view.nodesById?.[entityId]?.highlighted).toBe(true);
  expect(compileView(graph, decoded.view).tree.byId.get(entityId)?.view.highlighted).toBe(true);
});
