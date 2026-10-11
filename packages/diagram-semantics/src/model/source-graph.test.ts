import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { parseSourceDocument, serializeSourceDocument } from '../util/serialization';
import { compileSourceGraph, createMapSourceGraphResolver } from './source-graph';
import type {
  DocumentInput,
  ProvenanceLocation,
  SchemaModule,
  SemanticDocument,
  SemanticSourceDocument,
} from './types';
import { validateDocument } from './validate';

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>();
  return { ...actual, load: vi.fn(actual.load) };
});

describe('compileSourceGraph parsed input', () => {
  it('preserves import compilation while parsing only imported documents', () => {
    const raw = serializeSourceDocument({
      version: '0.1.0',
      schemaRefs: [],
      imports: [{ namespace: 'shared', slug: 'shared' }],
      entities: [],
      relations: [],
    });
    const childRaw = serializeSourceDocument({
      version: '0.1.0',
      schemaRefs: [],
      entities: [{ id: 'api', type: 'core/web-app.types.service' }],
      relations: [],
    });
    const resolver = createMapSourceGraphResolver({ shared: childRaw });
    const expected = compileSourceGraph({ raw, sourceLabel: 'root', resolver });
    const source = parseSourceDocument(raw);
    vi.mocked(load).mockClear();
    const actual = compileSourceGraph({ source, sourceLabel: 'root', resolver });
    expect(actual).toEqual(expected);
    expect(actual.diagnostics).toEqual([]);
    expect(actual.result?.doc.entities[0].id).toBe('shared/api');
    expect(vi.mocked(load).mock.calls.map(([text]) => text)).toEqual([childRaw]);
  });
});

describe('imported input provenance', () => {
  const revision = 'a'.repeat(40);
  const input = (repo: string, id = 'primary'): DocumentInput => ({
    id,
    kind: 'git',
    repo,
    revision,
    ref: 'main',
    role: 'primary',
  });
  const location = (inputId?: string): ProvenanceLocation => ({
    path: 'src/api.ts',
    ...(inputId ? { input: inputId } : {}),
  });
  const source = (repo: string, locations = [location('primary')]): SemanticSourceDocument => ({
    version: '0.1.0',
    schemaRefs: [],
    inputs: [input(repo)],
    entities: [
      {
        id: 'api',
        type: 'service',
        provenance: { locations },
        children: [{ id: 'child', type: 'service', provenance: { locations } }],
      },
    ],
    relations: [{ id: 'calls', from: 'api', to: 'child', provenance: { locations } }],
  });
  const schema: SchemaModule = {
    owner: 'user',
    name: 'test',
    version: '1',
    types: [{ id: 'service', label: 'Service' }],
    relations: [],
  };
  const provenanceDiagnostics = (doc: SemanticDocument) =>
    validateDocument(doc, schema).filter((d) => /input|provenance/.test(d.code));
  const compile = (
    root: SemanticSourceDocument,
    sources: Record<string, SemanticSourceDocument>,
  ) => {
    const result = compileSourceGraph({
      source: root,
      sourceLabel: 'root',
      resolver: createMapSourceGraphResolver(
        Object.fromEntries(
          Object.entries(sources).map(([key, value]) => [key, serializeSourceDocument(value)]),
        ),
      ),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.result).toBeDefined();
    return result.result!.doc;
  };
  const root = (): SemanticSourceDocument => ({
    version: '0.1.0',
    schemaRefs: [],
    entities: [],
    relations: [],
    imports: [
      { namespace: 'backend', slug: 'backend' },
      { namespace: 'frontend', slug: 'frontend' },
    ],
  });

  it.each([
    false,
    true,
  ])('retains imported inputs and rewrites entity, child and relation references (root input=%s)', (withRoot) => {
    const top = root();
    if (withRoot) top.inputs = [input('acme/root')];
    const doc = compile(top, {
      backend: source('acme/backend'),
      frontend: source('acme/frontend'),
    });
    expect(doc.inputs).toEqual([
      ...(top.inputs ?? []),
      ...['backend', 'frontend'].map((name) => ({
        ...input(`acme/${name}`),
        id: `${name}/primary`,
        role: 'secondary',
      })),
    ]);
    for (const [index, namespace] of ['backend', 'frontend'].entries()) {
      expect(doc.entities[index].provenance?.locations[0].input).toBe(`${namespace}/primary`);
      expect(doc.entities[index].children?.[0].provenance?.locations[0].input).toBe(
        `${namespace}/primary`,
      );
      expect(doc.relations[index].provenance?.locations[0].input).toBe(`${namespace}/primary`);
    }
    expect(provenanceDiagnostics(doc)).toEqual([]);
    expect(top.inputs?.[0]?.id).toBe(withRoot ? 'primary' : undefined);
  });
  it('qualifies nested inputs with their complete import prefix', () => {
    const top = root();
    top.imports = [{ namespace: 'a', slug: 'a' }];
    const a = source('acme/a');
    a.imports = [{ namespace: 'b', slug: 'b' }];
    const doc = compile(top, { a, b: source('acme/b') });
    expect(doc.inputs?.map((i) => i.id)).toEqual(['a/primary', 'a/b/primary']);
    expect(doc.entities[1].provenance?.locations[0].input).toBe('a/b/primary');
    expect(provenanceDiagnostics(doc)).toEqual([]);
  });
  it('makes shorthand explicit for both the root and imported single-input source', () => {
    const top = source('acme/root', [location()]);
    top.imports = root().imports;
    const doc = compile(top, {
      backend: source('acme/backend', [location()]),
      frontend: source('acme/frontend', [location()]),
    });
    expect(doc.entities.map((e) => e.provenance?.locations[0].input)).toEqual([
      'primary',
      'backend/primary',
      'frontend/primary',
    ]);
    expect(doc.relations.map((e) => e.provenance?.locations[0].input)).toEqual([
      'primary',
      'backend/primary',
      'frontend/primary',
    ]);
    expect(provenanceDiagnostics(doc)).toEqual([]);
  });
  it.each([0, 2])('does not infer shorthand for a source with %s inputs', (count) => {
    const child = source('acme/backend', [location()]);
    child.inputs = Array.from({ length: count }, (_, i) => ({
      ...input(`acme/${i}`, `repo-${i}`),
      role: 'secondary' as const,
    }));
    const top = root();
    top.imports = [{ namespace: 'backend', slug: 'backend' }];
    const doc = compile(top, { backend: child });
    expect(doc.entities[0].provenance?.locations[0].input).toBeUndefined();
  });
  it('preserves absolute repo/full commit locations, but expands incomplete coordinates', () => {
    const locations = [40, 64].map((length) => ({
      ...location(),
      repo: 'acme/absolute',
      commit: 'b'.repeat(length),
    }));
    const top = root();
    top.imports = [{ namespace: 'backend', slug: 'backend' }];
    const doc = compile(top, {
      backend: source('acme/backend', [
        ...locations,
        { ...location(), repo: 'acme/override', commit: 'short' },
      ]),
    });
    expect(doc.entities[0].provenance?.locations).toEqual([
      ...locations,
      { ...location(), repo: 'acme/override', commit: 'short', input: 'backend/primary' },
    ]);
  });
  it('retains unknown input names so validation still rejects them', () => {
    const top = root();
    top.imports = [{ namespace: 'backend', slug: 'backend' }];
    const doc = compile(top, { backend: source('acme/backend', [location('missing')]) });
    expect(doc.entities[0].provenance?.locations[0].input).toBe('missing');
    expect(provenanceDiagnostics(doc)).toContainEqual(
      expect.objectContaining({
        code: 'diagram.document.unknown_provenance_input',
        targetId: 'missing',
      }),
    );
  });
});
