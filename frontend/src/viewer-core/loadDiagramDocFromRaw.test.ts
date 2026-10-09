import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { loadDiagramDocFromRaw } from './loadDiagramDocFromRaw';

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>();
  return { ...actual, load: vi.fn(actual.load) };
});

describe('loadDiagramDocFromRaw', () => {
  it.each([
    ['malformed YAML', 'entities: [ { id: a, type: x\n  oops: : :', false],
    [
      'unresolved imports',
      'version: 0.1.0\nschemaRefs: []\nimports:\n  - namespace: shared\n    slug: shared\nentities: []\nrelations: []',
      false,
    ],
    [
      'valid gallery',
      readFileSync(new URL('../../../gallery/curated/n8n.yaml', import.meta.url), 'utf8'),
      true,
    ],
    [
      'renderable invalid document',
      'version: 0.1.0\nschemaRefs: []\nentities:\n  - id: unknown\n    type: unknown/type\nrelations: []',
      true,
    ],
  ])('reports readability for %s', (_name, raw, readable) => {
    expect(
      loadDiagramDocFromRaw({ raw: raw as string, streamName: 'Test', sourceLabel: 'test' })
        .readable,
    ).toBe(readable);
  });

  it('reuses the parsed root for documents with imports', () => {
    const raw =
      'version: 0.1.0\nschemas: []\nimports:\n  - namespace: shared\n    slug: shared\nentities: []\nrelations: []\n';
    vi.mocked(load).mockClear();
    const result = loadDiagramDocFromRaw({ raw, streamName: 'Test', sourceLabel: 'test' });
    expect(vi.mocked(load).mock.calls.filter(([text]) => text === raw)).toHaveLength(1);
    expect(result.sourceDiagnostics.some((diagnostic) => diagnostic.code.includes('import'))).toBe(
      true,
    );
  });
});
