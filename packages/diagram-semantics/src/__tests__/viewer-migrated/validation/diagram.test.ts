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
