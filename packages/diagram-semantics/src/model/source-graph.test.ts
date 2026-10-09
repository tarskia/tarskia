import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { parseSourceDocument, serializeSourceDocument } from '../util/serialization';
import { compileSourceGraph, createMapSourceGraphResolver } from './source-graph';

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
