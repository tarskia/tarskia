import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchemaModule } from '../model/types';
import {
  ingestSemanticDocument,
  ingestSemanticSourceDocument,
  ingestTrustedSemanticDocument,
  ingestTrustedSemanticSourceDocument,
  parseSemanticDocument,
  parseTrustedSemanticDocument,
  serializeSemanticDocument,
} from './document';

const schema: SchemaModule = {
  owner: 'user',
  name: 'document-io-test',
  version: '1',
  types: [{ id: 'service', label: 'Service' }],
  relations: [{ id: 'calls', label: 'Calls', shortLabel: 'calls' }],
};

const rawDocument = `version: 0.1.0
schemaRefs:
  - schema: user/document-io-test@1
    layer: 0
entities:
  - id: api
    type: service
relations: []
`;

describe('document io', () => {
  it.each([
    ['entities: {a: 1}', '"entities" must be a list, found a mapping'],
    ['relations: "x"', '"relations" must be a list, found a string'],
    ['schemaRefs: "x"', '"schemaRefs" must be a list, found a string'],
    ['entities: null', '"entities" must be a list, found null'],
    ['[]', 'Document must be a mapping, found a list'],
    ['hello', 'Document must be a mapping, found a string'],
    ['42', 'Document must be a mapping, found a number'],
    ['', 'Document must be a mapping, found empty input'],
  ])('rejects invalid document structure: %s', (raw, message) => {
    for (const ingest of [
      ingestTrustedSemanticDocument,
      ingestSemanticSourceDocument,
      ingestTrustedSemanticSourceDocument,
    ]) {
      const result = ingest({ raw });
      expect(result.ok).toBe(false);
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'semantic.document.invalid_structure',
          severity: 'error',
          message,
        }),
      ]);
    }
    expect(() => parseSemanticDocument(raw)).toThrow(message);
  });

  it('warns on unknown keys without making an otherwise valid ingest fail', () => {
    for (const ingest of [
      ingestTrustedSemanticDocument,
      ingestSemanticSourceDocument,
      ingestTrustedSemanticSourceDocument,
    ]) {
      const result = ingest({ raw: 'entitites: []' });
      expect(result.ok).toBe(true);
      expect(result.value?.entities).toEqual([]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'semantic.document.unknown_key',
          severity: 'warning',
          message: 'Unknown top-level key "entitites"',
        }),
      ]);
    }
    const validated = ingestSemanticDocument({ raw: `${rawDocument}entitites: []\n`, schema });
    expect(validated.ok).toBe(true);
    expect(validated.diagnostics).toHaveLength(1);
    const imported = ingestSemanticSourceDocument({
      raw: 'imports: [{slug: other}]\nentitites: []',
    });
    expect(imported.ok).toBe(true);
    expect(imported.diagnostics[0]?.code).toBe('semantic.document.unknown_key');
  });

  it('loads every curated diagram without new diagnostics or changed normalization', () => {
    const gallery = resolve(import.meta.dirname, '../../../../gallery/curated');
    const files = readdirSync(gallery).filter((file) => /\.ya?ml$/.test(file));
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const file of files) {
      const raw = readFileSync(resolve(gallery, file), 'utf8');
      const result = ingestTrustedSemanticDocument({ raw });
      expect(result.ok, file).toBe(true);
      expect(result.diagnostics, file).toEqual([]);
      expect(result.value, file).toEqual(parseSemanticDocument(raw));
    }
  });

  it('parses and serializes semantic documents explicitly', () => {
    const parsed = parseSemanticDocument(rawDocument);

    expect(parsed.entities).toHaveLength(1);
    expect(parseTrustedSemanticDocument(serializeSemanticDocument(parsed))).toEqual(parsed);
  });

  it('returns a shared yaml parse diagnostic for malformed documents', () => {
    const result = ingestTrustedSemanticDocument({ raw: 'version: [broken' });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        domain: 'diagram',
        phase: 'parse',
        code: 'semantic.parse.invalid_yaml',
      }),
    ]);
  });

  it('ingests documents with schema-aware validation', () => {
    const result = ingestSemanticDocument({
      raw: `version: 0.1.0
schemaRefs:
  - schema: user/document-io-test@1
    layer: 0
entities:
  - id: api
    type: missing
relations: []
`,
      schema,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'diagram',
          phase: 'document',
          severity: 'error',
        }),
      ]),
    );
  });

  it('ingests source documents without hand-written parse diagnostics in callers', () => {
    const result = ingestSemanticSourceDocument({
      raw: `version: 0.1.0
schemaRefs: []
imports:
  - slug: platform
    namespace: imported
entities: []
relations: []
`,
      path: 'test-source',
      messagePrefix: 'test-source',
    });

    expect(result.ok).toBe(true);
    expect(result.value?.imports).toEqual([{ slug: 'platform', namespace: 'imported' }]);
  });
});
