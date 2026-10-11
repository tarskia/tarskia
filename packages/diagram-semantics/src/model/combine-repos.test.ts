import { describe, expect, it } from 'vitest';
import { serializeDocument } from '../util/serialization';
import { combineRepoDiagrams, pickRepoDiagramFiles } from './combine-repos';
import type { Entity, Relation } from './types';

const diagram = (name: string, entities: Entity[], relations: Relation[] = []) => ({
  name,
  raw: serializeDocument({
    version: '1',
    schemaRefs: [],
    entities,
    relations,
    inputs: [
      {
        id: 'repo',
        kind: 'git',
        repo: `https://github.com/example/${name}`,
        revision: 'a'.repeat(40),
      },
    ],
  }),
});
const entity = (id: string, represents?: string): Entity => ({ id, type: 'service', represents });
const edge = (id: string, from: string, to: string): Relation => ({
  id,
  type: 'calls',
  from,
  to,
  provenance: { locations: [{ path: `${id}.ts` }] },
});

describe('combineRepoDiagrams', () => {
  it('namespaces IDs and input-backed provenance, merging stand-ins and parallel edges under the source owner', () => {
    const result = combineRepoDiagrams({
      name: 'workspace',
      diagrams: [
        diagram(
          'server',
          [entity('api'), entity('client', 'client/app')],
          [edge('reverse-copy', 'client', 'api')],
        ),
        diagram(
          'client',
          [entity('app'), entity('server', 'server/api')],
          [edge('call', 'app', 'server')],
        ),
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.doc?.metadata?.name).toBe('workspace');
    expect(result.doc?.entities.map((item) => item.id)).toEqual(['server/api', 'client/app']);
    expect(result.doc?.inputs?.map((input) => [input.id, input.repo])).toEqual([
      ['server/repo', 'https://github.com/example/server'],
      ['client/repo', 'https://github.com/example/client'],
    ]);
    expect(result.doc?.relations).toEqual([
      expect.objectContaining({
        id: 'client/call',
        from: 'client/app',
        to: 'server/api',
        provenance: {
          locations: [
            expect.objectContaining({ input: 'server/repo', path: 'reverse-copy.ts' }),
            expect.objectContaining({ input: 'client/repo', path: 'call.ts' }),
          ],
        },
      }),
    ]);
  });
  it('follows chains and drops collapsed self-loops', () => {
    const result = combineRepoDiagrams({
      name: 'all',
      diagrams: [
        diagram(
          'a',
          [entity('source'), entity('alias', 'b/alias')],
          [edge('call', 'source', 'alias')],
        ),
        diagram('b', [entity('alias', 'c/target')]),
        diagram(
          'c',
          [entity('target'), entity('alias', 'a/alias')],
          [edge('self', 'target', 'alias')],
        ),
      ],
    });
    expect(result.doc?.entities.map((item) => item.id)).toEqual(['a/source', 'c/target']);
    expect(result.doc?.relations.map((item) => [item.from, item.to])).toEqual([
      ['a/source', 'c/target'],
    ]);
  });
  it('rejects cycles', () => {
    const result = combineRepoDiagrams({
      name: 'all',
      diagrams: [
        diagram('a', [entity('alias', 'b/alias')]),
        diagram('b', [entity('alias', 'a/alias')]),
      ],
    });
    expect(result.doc).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'diagram.combine.represents_cycle', severity: 'error' }),
    );
  });
  it('silently keeps absent repos but warns for absent entities in available repos', () => {
    const result = combineRepoDiagrams({
      name: 'all',
      diagrams: [
        diagram('a', [entity('absent', 'missing/api'), entity('broken', 'b/api')]),
        diagram('b', [entity('other')]),
      ],
    });
    expect(result.doc?.entities).toHaveLength(3);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.combine.represents_target_missing',
        severity: 'warning',
        entityId: 'a/broken',
        message: expect.stringContaining('b/api'),
      }),
    ]);
  });
  it.each([
    ['a', 'a'],
    ['Bad', 'b'],
    ['a/b', 'b'],
  ])('rejects duplicate or invalid names %s %s', (first, second) => {
    const result = combineRepoDiagrams({
      name: 'all',
      diagrams: [diagram(first, []), diagram(second, [])],
    });
    expect(result.doc).toBeUndefined();
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });
  it('keeps same-repo parallel relations', () => {
    const result = combineRepoDiagrams({
      name: 'all',
      diagrams: [
        diagram(
          'a',
          [entity('one'), entity('two')],
          [edge('x', 'one', 'two'), edge('y', 'one', 'two')],
        ),
      ],
    });
    expect(result.doc?.relations).toHaveLength(2);
  });
});

describe('pickRepoDiagramFiles', () => {
  it('uses filenames, pairs local schemas, and skips jobs and unrelated paths', () => {
    expect(
      pickRepoDiagramFiles([
        'backend/.tarskia/api.yaml',
        'backend/.tarskia/api.schema.yaml',
        'frontend/.tarskia/web.yaml',
        'backend/.tarskia/.job/draft.yaml',
        'backend/other.yaml',
        'nested/repo/.tarskia/no.yaml',
      ]),
    ).toEqual([
      {
        name: 'api',
        diagramPath: 'backend/.tarskia/api.yaml',
        schemaPaths: ['backend/.tarskia/api.schema.yaml'],
      },
      { name: 'web', diagramPath: 'frontend/.tarskia/web.yaml', schemaPaths: [] },
    ]);
  });
  it('prefers a root repo, even if its .tarskia folder is empty', () => {
    expect(
      pickRepoDiagramFiles([
        '.tarskia/api.yaml',
        '.tarskia/api.schema.yaml',
        'child/.tarskia/child.yaml',
      ]),
    ).toEqual([
      { name: 'api', diagramPath: '.tarskia/api.yaml', schemaPaths: ['.tarskia/api.schema.yaml'] },
    ]);
    expect(pickRepoDiagramFiles(['.tarskia/', 'child/.tarskia/child.yaml'])).toEqual([]);
  });
});

it('round-trips represents through source parsing and serialization', async () => {
  const { parseSourceDocument } = await import('../util/serialization');
  const raw = diagram('a', [entity('external', 'b/api')]).raw;
  expect(parseSourceDocument(raw).entities[0].represents).toBe('b/api');
  expect(serializeDocument(parseSourceDocument(raw))).toContain('represents: b/api');
});
