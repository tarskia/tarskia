import { describe, expect, it } from 'vitest';

import baseRaw from '../../../__tests__/fixtures/viewer/base.yaml?raw';
import codeRaw from '../../../__tests__/fixtures/viewer/code.yaml?raw';
import dataModelRaw from '../../../__tests__/fixtures/viewer/data-model.yaml?raw';
import frontendRaw from '../../../__tests__/fixtures/viewer/frontend.yaml?raw';
import kubernetesRaw from '../../../__tests__/fixtures/viewer/kubernetes.yaml?raw';
import softwareRaw from '../../../__tests__/fixtures/viewer/software.yaml?raw';
import starterDiagramRaw from '../../../__tests__/fixtures/viewer/starter.yaml?raw';
import webAppRaw from '../../../__tests__/fixtures/viewer/web-app.yaml?raw';
import {
  buildRawSchemaSet,
  buildSchemaRuntime,
  buildSchemaSelection,
  parseAndValidateDiagramDoc,
  parseDocument,
  parseSchema,
  type SemanticDocument,
  sanitizeDiagramDoc,
  validateDiagramDoc,
} from '../../../index';

const raw = buildRawSchemaSet([
  parseSchema(baseRaw),
  parseSchema(softwareRaw),
  parseSchema(webAppRaw),
  parseSchema(codeRaw),
  parseSchema(frontendRaw),
  parseSchema(dataModelRaw),
  parseSchema(kubernetesRaw),
]);
const schema = buildSchemaRuntime({
  raw,
  selection: buildSchemaSelection({ raw }),
}).resolved.effectiveSchema;

describe('diagram validation API', () => {
  it('resolves and validates a diagram activating a supplied repo schema', () => {
    const module = parseSchema(`owner: repo
name: x
version: "0.1"
types:
  - id: service
relations: []
`);
    const doc = parseDocument(`version: "1"
schemaRefs:
  - schema: repo/x@0.1
    layer: 0
entities:
  - id: service
    type: repo/x.types.service
relations: []
`);
    const raw = buildRawSchemaSet([module]);
    const runtime = buildSchemaRuntime({
      raw,
      selection: buildSchemaSelection({ raw, activations: doc.schemaRefs }),
    });
    expect(runtime.resolved.resolvedModuleIds).toEqual(['repo/x']);
    expect(runtime.resolved.diagnostics).toEqual([]);
    expect(validateDiagramDoc(doc, runtime.resolved.effectiveSchema).ok).toBe(true);
    expect(doc.schemaRefs[0].schema).toBe('repo/x@0.1');
  });

  it('parses and validates diagram raw text', () => {
    const result = parseAndValidateDiagramDoc(starterDiagramRaw, schema);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.entities.length).toBeGreaterThan(0);
  });

  it('sanitizes dangling relations', () => {
    const doc = parseDocument(starterDiagramRaw);
    const withDangling: SemanticDocument = {
      ...doc,
      relations: [
        ...doc.relations,
        {
          id: 'rel-dangling',
          from: 'missing-a',
          to: 'missing-b',
          label: 'dangling',
          state: 'undecided',
        },
      ],
    };
    const sanitized = sanitizeDiagramDoc(withDangling);
    expect(sanitized.relations.some((relation) => relation.id === 'rel-dangling')).toBe(false);
    const validated = validateDiagramDoc(sanitized, schema);
    expect(validated.ok).toBe(true);
  });
});
