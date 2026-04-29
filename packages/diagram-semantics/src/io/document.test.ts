import { describe, expect, it } from 'vitest';
import type { SchemaModule } from '../model/types';
import {
  ingestSemanticDocument,
  ingestSemanticSourceDocument,
  ingestTrustedSemanticDocument,
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
