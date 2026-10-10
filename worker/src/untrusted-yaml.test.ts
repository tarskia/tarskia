import * as shared from '@tarskia/diagram-semantics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAreaPlanResponse } from './advanced/area-plan';
import { parseNodeRefinementResponse } from './advanced/node-refinement';
import { parseWave1ReviewPatchResponse } from './advanced/wave1-review';
import { extractYamlResponse } from './codex/diagram-agent';
import { parseDocument, parseSchemaModuleYaml, parseSourceDocument } from './semantic';
import { assertYamlInputSize, MAX_YAML_INPUT_BYTES, parseYamlText } from './untrusted-yaml';

afterEach(() => vi.restoreAllMocks());

describe('worker YAML boundary', () => {
  it.each([
    'a: &a {x: 1}\nb: *a',
    'a: &a [1]\nb: *a',
    'a: &a [*a]',
    'a: &a {self: *a}',
    'a: &a {x: 1}\nb: {<<: *a}',
    'metadata: {a: &a [1], b: &b [*a, *a], c: [*b, *b]}',
  ])('rejects repeated containers before normalization: %s', (raw) => {
    for (const parse of [parseYamlText, parseDocument, parseSourceDocument]) {
      expect(() => parse(raw)).toThrow(
        expect.objectContaining({ code: 'diagram.parse.alias_not_allowed' }),
      );
    }
    expect(parseSchemaModuleYaml(raw)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'diagram.parse.alias_not_allowed' }],
    });
  });

  it('retains JSON_SCHEMA scalars, unused anchors, scalar aliases and ordinary documents', () => {
    expect(parseYamlText('a: &a hello\nb: *a\ncount: 1_000\nflag: yes\nunused: &u {}')).toEqual({
      a: 'hello',
      b: 'hello',
      count: 1000,
      flag: 'yes',
      unused: {},
    });
    const raw = 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []';
    expect(parseDocument(raw)).toEqual(shared.parseDocument(raw));
  });

  it.each([
    'a: 1\na: 2',
    'a: !custom value',
    'a: !!binary aGVsbG8=',
    'a: 1\n---\nb: 2',
  ])('retains canonical syntax rejection: %s', (raw) => {
    expect(() => parseYamlText(raw)).toThrow();
  });

  it('counts UTF-8 bytes and rejects above 50 MiB before calling the parser', () => {
    const parser = vi.spyOn(shared, 'parseYamlText');
    const boundary = 'é'.repeat(MAX_YAML_INPUT_BYTES / 2);
    expect(() => assertYamlInputSize(boundary)).not.toThrow();
    expect(() => parseYamlText(boundary + 'a')).toThrow(
      expect.objectContaining({ code: 'diagram.parse.too_large' }),
    );
    expect(parser).not.toHaveBeenCalled();
  });

  it.each([
    parseAreaPlanResponse,
    parseNodeRefinementResponse,
    parseWave1ReviewPatchResponse,
  ])('rejects agent aliases and oversized JSON/fenced envelopes', (parse) => {
    expect(() => parse('hidden: &a [1]\nother: *a')).toThrow(
      expect.objectContaining({ code: 'diagram.parse.alias_not_allowed' }),
    );
    const padding = ' '.repeat(MAX_YAML_INPUT_BYTES);
    expect(() => parse('{}' + padding)).toThrow(
      expect.objectContaining({ code: 'diagram.parse.too_large' }),
    );
    expect(() => parse('```json\n{}\n```' + padding)).toThrow(
      expect.objectContaining({ code: 'diagram.parse.too_large' }),
    );
    expect(() =>
      parse(
        JSON.stringify({
          keyConcepts: [{ id: 'app', paths: ['src'], evidence: [{ path: 'src', reason: 'code' }] }],
        }),
      ),
    ).not.toThrow();
  });

  it('keeps oversized diagram envelopes intact for the validation repair loop', () => {
    const raw = '{"yaml":"version: 0.1.0"}' + ' '.repeat(MAX_YAML_INPUT_BYTES);
    expect(extractYamlResponse(raw)).toBe(raw);
    expect(() => parseDocument(extractYamlResponse(raw))).toThrow(
      expect.objectContaining({ code: 'diagram.parse.too_large' }),
    );
  });
});
