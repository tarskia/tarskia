import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../util/serialization';
import { normalizeDiagramView } from './normalize-diagram-view';

const doc = 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n';
describe('DiagramView camera format migration', () => {
  it('reads v2 viewport with the documented 1440 by 900 canvas assumption', () => {
    const parsed = parseDocument(
      doc +
        'view:\n  kind: semantic-diagram-view\n  version: 2\n  layout:\n    viewport: {x: 100, y: -40, zoom: 2}\n',
    );
    expect(parsed.view).toEqual({
      kind: 'semantic-diagram-view',
      version: 3,
      camera: { rect: { x: -50, y: 20, width: 720, height: 450 } },
    });
  });
  it('migrates legacy top-level layout too', () => {
    expect(
      parseDocument(doc + 'layout:\n  viewport: {x: 100, y: -40, zoom: 2}\n').view?.camera,
    ).toEqual({ rect: { x: -50, y: 20, width: 720, height: 450 } });
  });
  it('round-trips v3 anchor, exact rectangle and explicit false flags', () => {
    const view = {
      kind: 'semantic-diagram-view' as const,
      version: 3 as const,
      scopeRootId: 'scope',
      nodesById: { a: { expanded: false, highlighted: true } },
      camera: { anchorId: 'a', rect: { x: -12.25, y: 85.5, width: 720.5, height: 450.25 } },
    };
    const original = { ...parseDocument(doc), view };
    expect(parseDocument(serializeDocument(original))).toEqual(original);
    expect(normalizeDiagramView(view).camera).toEqual(view.camera);
    expect(serializeDocument(original)).not.toContain('viewport:');
  });
  it('rejects unsupported versions and invalid camera rectangles', () => {
    expect(() => parseDocument(doc + 'view: {version: 99}\n')).toThrow(
      'Unsupported diagram view version',
    );
    expect(() =>
      parseDocument(
        doc + 'view: {version: 3, camera: {rect: {x: 0, y: 0, width: 0, height: 20}}}\n',
      ),
    ).toThrow('Invalid diagram camera framing');
  });
});
