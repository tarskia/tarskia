import { describe, expect, it } from 'vitest';
import { parseDocument, type SemanticDocument, serializeDocument } from '../semantic';
import { applyGraphEditResponse } from './graph-edit-response';

function graph(): SemanticDocument {
  return {
    version: '0.1.0',
    schemaRefs: [{ schema: 'core/web-app@0.3', layer: 0 }],
    entities: [
      {
        id: 'app',
        type: 'application',
        description: 'Keep this description',
        children: [
          {
            id: 'app/queue/retry/gate',
            parent: 'app',
            type: 'service',
            props: { language: 'go' },
            provenance: {
              locations: [{ input: 'primary', path: 'storage/remote/queue_manager.go' }],
            },
          },
        ],
      },
      { id: 'remote', type: 'external-api' },
    ],
    relations: [
      {
        id: 'send',
        from: 'app/queue/retry/gate',
        to: 'remote',
        type: 'calls',
        description: 'Keep this relation',
        provenance: { locations: [{ input: 'primary', path: 'storage/remote/queue_manager.go' }] },
      },
    ],
  };
}

describe('graph edit response', () => {
  it('preserves the entire large graph when the model returns a no-op', () => {
    const doc = graph();
    doc.entities[0].children!.push(
      ...Array.from({ length: 238 }, (_, index) => ({ id: `app/node-${index}`, type: 'service' })),
    );
    expect(applyGraphEditResponse(doc, '{}')).toEqual(parseDocument(serializeDocument(doc)));
  });

  it('merges a targeted field without dropping descriptions, provenance, edges or descendants', () => {
    const doc = graph();
    const patched = applyGraphEditResponse(
      doc,
      JSON.stringify({ entityEdits: [{ id: 'app/queue/retry/gate', name: 'Gate' }] }),
    );
    expect(patched.entities[0].children![0]).toMatchObject({
      ...doc.entities[0].children![0],
      name: 'Gate',
    });
    expect(patched.entities[0].description).toBe(doc.entities[0].description);
    expect(patched.relations).toEqual(doc.relations);
    expect(doc.entities[0].children![0].name).toBeUndefined();
  });

  it('applies explicit additions, removals and reparenting together', () => {
    const doc = graph();
    const patched = applyGraphEditResponse(
      doc,
      JSON.stringify({
        entityEdits: [
          { id: 'new', type: 'service', parent: 'app' },
          { id: 'app/queue/retry/gate', parent: null },
        ],
        removeEntityIds: ['remote'],
        removeRelationIds: ['send'],
        relationEdits: [{ id: 'new-edge', from: 'app/queue/retry/gate', to: 'new', type: 'calls' }],
      }),
    );
    expect(patched.entities.map((item) => item.id)).toEqual(['app', 'app/queue/retry/gate']);
    expect(patched.entities[0].children!.map((item) => item.id)).toEqual(['new']);
    expect(patched.entities[1].parent).toBeUndefined();
    expect(patched.relations.map((item) => item.id)).toEqual(['new-edge']);
  });

  it.each([
    '{"entities": [], "relations": []}',
    '{"entityEdits": {}}',
    '{"entityEdits": [{"id": "app", "children": []}]}',
    '{"entityEdits": [{"id": "app", "newId": "renamed"}]}',
    '{"entityEdits": [{"id": "app"}, {"id": "app"}]}',
    '{"entityEdits": [{"id": "app"}], "removeEntityIds": ["app"]}',
    '{"entityEdits": [{"id": "app", "parent": "app/queue/retry/gate"}]}',
    '{"entityEdits": [{"id": "app", "parent": "missing"}]}',
    '{"removeEntityIds": ["app"]}',
    '{"removeRelationIds": ["missing"]}',
    '{"entityEdits": [{"id": "new"}]}',
    '{"relationEdits": [{"id": "new"}]}',
    '{"entityEdits": [',
  ])('rejects malformed or ambiguous edits: %s', (response) => {
    expect(() => applyGraphEditResponse(graph(), response)).toThrow();
  });
});
