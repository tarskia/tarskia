import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { loadDiagramDocFromRaw } from './loadDiagramDocFromRaw';

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>();
  return { ...actual, load: vi.fn(actual.load) };
});

describe('loadDiagramDocFromRaw', () => {
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
