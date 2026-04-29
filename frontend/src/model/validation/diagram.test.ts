import { describe, expect, it } from 'vitest';

import baseRaw from '../../schemas/base.yaml?raw';
import codeRaw from '../../schemas/code.yaml?raw';
import dataModelRaw from '../../schemas/data-model.yaml?raw';
import frontendRaw from '../../schemas/frontend.yaml?raw';
import kubernetesRaw from '../../schemas/kubernetes.yaml?raw';
import softwareRaw from '../../schemas/software.yaml?raw';
import webAppRaw from '../../schemas/web-app.yaml?raw';
import { sampleDiagramRaw } from '../../semantic/bundled-diagrams';
import { parseDocument, parseSchema } from '../../util/serialization';
import { buildRawSchemaSet, buildSchemaRuntime, buildSchemaSelection } from '../schema-runtime';
import type { SemanticDocument } from '../types';
import { parseAndValidateDiagramDoc, sanitizeDiagramDoc, validateDiagramDoc } from './diagram';

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
    const result = parseAndValidateDiagramDoc(sampleDiagramRaw, schema);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.entities.length).toBeGreaterThan(0);
  });

  it('sanitizes dangling relations', () => {
    const doc = parseDocument(sampleDiagramRaw);
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
