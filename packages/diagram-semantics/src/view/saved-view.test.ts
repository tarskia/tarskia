import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applySavedView,
  buildSemanticIndex,
  hashDiagramContent,
  parseSavedDiagramView,
  type SavedDiagramView,
  type SchemaModule,
  type SemanticDocument,
  serializeSavedDiagramView,
} from '../index';
import { parseDocument, serializeDocument } from '../util/serialization';

const schema: SchemaModule = {
  owner: 'core',
  name: 'test',
  version: '1.0',
  types: [{ id: 'node' }],
  relations: [],
};
const doc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [{ id: 'a', type: 'node', children: [{ id: 'a/b', type: 'node' }] }],
  relations: [],
  view: { kind: 'semantic-diagram-view', version: 3, nodesById: { a: { expanded: true } } },
};
const record = (): SavedDiagramView => ({
  kind: 'semantic-diagram-saved-view',
  version: 1,
  diagram: { namespace: 'tarskia', slug: 'example' },
  revision: hashDiagramContent(doc),
  title: 'A useful view',
  view: {
    kind: 'semantic-diagram-view',
    version: 3,
    scopeRootId: 'a',
    nodesById: { 'a/b': { expanded: false, highlighted: true } },
    camera: { anchorId: 'a/b', rect: { x: -100, y: 20, width: 1440, height: 900 } },
  },
});
const expectRejected = (value: unknown) => {
  let result: ReturnType<typeof parseSavedDiagramView>;
  expect(() => {
    result = parseSavedDiagramView(value);
  }).not.toThrow();
  expect(result!.ok).toBe(false);
  if (result!.ok === false) expect(result!.diagnostic.severity).toBe('error');
  expect(() => serializeSavedDiagramView(value)).not.toThrow();
  expect(serializeSavedDiagramView(value).ok).toBe(false);
};

describe('saved view records', () => {
  it('exports and round-trips independent v3 view records without sharing mutable input', () => {
    const source = record();
    const serialized = serializeSavedDiagramView(source);
    expect(serialized.ok).toBe(true);
    if (serialized.ok === false) throw new Error(serialized.diagnostic.message);
    expect(parseSavedDiagramView(serialized.value)).toEqual({ ok: true, value: source });
    const parsed = parseSavedDiagramView(source);
    if (parsed.ok === false) throw new Error(parsed.diagnostic.message);
    parsed.value.view.nodesById!['a/b'].expanded = true;
    parsed.value.view.camera!.rect.x = 42;
    expect(source.view.nodesById!['a/b'].expanded).toBe(false);
    expect(source.view.camera!.rect.x).toBe(-100);
  });

  it.each([
    null,
    undefined,
    true,
    0,
    [],
    () => {},
    Symbol('value'),
    1n,
    new Date(),
    new Map(),
    'not JSON',
    '[]',
  ])('rejects non-record input %s without throwing', (value) => expectRejected(value));

  it('rejects wrong kinds, versions, shapes and non-JSON field values', () => {
    const source = record();
    for (const value of [
      { ...source, kind: 'other' },
      { ...source, version: 2 },
      { ...source, revision: 'NOT_A_HASH' },
      { ...source, diagram: { namespace: 'n' } },
      { ...source, view: { ...source.view, version: 2 } },
      { ...source, title: 42 },
      { ...source, title: Symbol('title') },
      { ...source, extra: 1n },
      { ...source, view: { ...source.view, nodesById: { a: { expanded: 'yes' } } } },
      { ...source, view: { ...source.view, nodesById: { a: { highlighted: () => {} } } } },
      { ...source, view: { ...source.view, nodesById: { a: { hidden: true } } } },
      {
        ...source,
        view: { ...source.view, camera: { rect: { x: 0, y: 0, width: Infinity, height: 1 } } },
      },
      {
        ...source,
        view: { ...source.view, camera: { rect: { x: 0, y: 0, width: 0, height: 1 } } },
      },
    ])
      expectRejected(value);
  });

  it('rejects getters, revoked proxies and cyclic objects without invoking accessors', () => {
    const getter = vi.fn(() => {
      throw new Error('must not run');
    });
    const source = record();
    Object.defineProperty(source, 'title', { get: getter, enumerable: true });
    expectRejected(source);
    expect(getter).not.toHaveBeenCalled();
    expectRejected(
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('hostile');
          },
        },
      ),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectRejected(revoked.proxy);
    const cyclic = record() as unknown as Record<string, unknown>;
    cyclic.view = cyclic;
    expectRejected(cyclic);
  });

  it('reads data descriptors without invoking proxy get traps', () => {
    const source = record();
    const get = vi.fn(() => {
      throw new Error('must not run');
    });
    expect(parseSavedDiagramView(new Proxy(source, { get }))).toEqual({ ok: true, value: source });
    expect(get).not.toHaveBeenCalled();
  });

  it('enforces ID, title, reference-count and total JSON caps', () => {
    const source = record();
    expectRejected({ ...source, title: 'x'.repeat(201) });
    expectRejected({ ...source, view: { ...source.view, scopeRootId: 'x'.repeat(513) } });
    expectRejected({
      ...source,
      view: { ...source.view, camera: { ...source.view.camera, anchorId: 'x'.repeat(513) } },
    });
    expectRejected({
      ...source,
      view: { ...source.view, nodesById: { ['x'.repeat(513)]: { expanded: true } } },
    });
    const nodesById = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`node-${i}`, { expanded: true }]),
    );
    const capped = {
      ...source,
      title: 'x'.repeat(200),
      view: {
        kind: 'semantic-diagram-view',
        version: 3,
        nodesById,
        scopeRootId: 'node-0',
        camera: { anchorId: 'node-1', rect: { x: 0, y: 0, width: 1, height: 1 } },
      },
    };
    expect(parseSavedDiagramView(capped).ok).toBe(true);
    expectRejected({ ...capped, view: { ...capped.view, scopeRootId: 'extra' } });
    expectRejected({ ...capped, view: { ...capped.view, nodesById: { ...nodesById, extra: {} } } });
    expectRejected(' '.repeat(16 * 1024 * 1024 + 1));
    expect(
      parseSavedDiagramView({
        ...source,
        view: { kind: 'semantic-diagram-view', version: 3, nodesById: { ['x'.repeat(512)]: {} } },
      }).ok,
    ).toBe(true);
  });

  it('preserves special IDs as own data, without prototype pollution', () => {
    const source = record();
    source.view.nodesById = Object.fromEntries([
      ['__proto__', { expanded: true }],
      ['constructor', { highlighted: false }],
    ]);
    const parsed = parseSavedDiagramView(source);
    expect(parsed).toEqual({ ok: true, value: source });
    if (parsed.ok === true)
      expect(Object.getPrototypeOf(parsed.value.view.nodesById)).toBe(Object.prototype);
  });

  it('applies matching revisions with no drops and leaves the default embedded view alone', () => {
    const index = buildSemanticIndex(doc, schema),
      saved = record(),
      before = serializeDocument(doc);
    const result = applySavedView(index, saved, saved.revision);
    expect(result.view).toEqual(saved.view);
    expect(result.report).toEqual({
      revisionMatches: true,
      droppedIds: [],
      scopeRootDropped: false,
      anchorDropped: false,
    });
    result.view.nodesById!['a/b'].highlighted = false;
    expect(saved.view.nodesById!['a/b'].highlighted).toBe(true);
    expect(serializeDocument(doc)).toBe(before);
  });

  it('keeps valid flags and reports exactly the missing IDs, including scope and camera', () => {
    const index = buildSemanticIndex(doc, schema),
      saved = record();
    saved.view.nodesById = {
      a: { expanded: true },
      gone: { expanded: true },
      other: { highlighted: true },
    };
    saved.view.scopeRootId = 'gone';
    saved.view.camera!.anchorId = 'anchor';
    const result = applySavedView(index, saved, '0123456789ab');
    expect(result.view).toEqual({
      kind: 'semantic-diagram-view',
      version: 3,
      nodesById: { a: { expanded: true } },
    });
    expect(result.report).toEqual({
      revisionMatches: false,
      droppedIds: ['anchor', 'gone', 'other'],
      scopeRootDropped: true,
      anchorDropped: true,
    });
    expect(saved.view.camera!.anchorId).toBe('anchor');
  });

  it('still validates IDs for a matching revision and keeps unanchored cameras', () => {
    const saved = record();
    saved.view.nodesById = { gone: { expanded: false } };
    delete saved.view.camera!.anchorId;
    const result = applySavedView(buildSemanticIndex(doc, schema), saved, saved.revision);
    expect(result.report).toEqual({
      revisionMatches: true,
      droppedIds: ['gone'],
      scopeRootDropped: false,
      anchorDropped: false,
    });
    expect(result.view.camera).toEqual(saved.view.camera);
  });
});

describe('parsed content revision', () => {
  it('is stable across curated YAML formatting/key order, ignores default view and changes with semantics', () => {
    const raw = readFileSync(
      resolve(import.meta.dirname, '../../../../gallery/curated/n8n.yaml'),
      'utf8',
    );
    const parsed = parseDocument(raw);
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, reverseKeys(child)]),
            )
          : value;
    const reordered = parseDocument(JSON.stringify(reverseKeys(parsed), null, 4));
    const hash = hashDiagramContent(parsed);
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
    expect(hashDiagramContent(reordered)).toBe(hash);
    expect(hashDiagramContent(parseDocument(serializeDocument(parsed)))).toBe(hash);
    expect(
      hashDiagramContent({ ...parsed, view: record().view, metadata: { name: 'New title' } }),
    ).toBe(hash);
    expect(
      hashDiagramContent({
        ...parsed,
        entities: parsed.entities.map((entity, i) =>
          i === 0 ? { ...entity, name: 'Changed' } : entity,
        ),
      }),
    ).not.toBe(hash);
    expect(
      hashDiagramContent({
        ...parsed,
        relations: parsed.relations.map((relation, i) =>
          i === 0 ? { ...relation, label: 'Changed' } : relation,
        ),
      }),
    ).not.toBe(hash);
    expect(
      hashDiagramContent({
        ...parsed,
        schemaRefs: parsed.schemaRefs.map((ref, i) =>
          i === 0 ? { ...ref, layer: ref.layer + 1 } : ref,
        ),
      }),
    ).not.toBe(hash);
  });
});
