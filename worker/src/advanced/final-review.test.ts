import { describe, expect, it } from 'vitest';
import type { SemanticDocument } from '../semantic';
import { buildFinalGraphReviewSummary, detectFinalGraphRegression } from './final-review';

function createAssembledDoc(): SemanticDocument {
  return {
    version: '0.1.0',
    schemaRefs: [{ schema: 'core/web-app@0.3', layer: 0 }],
    entities: [
      {
        id: 'app',
        type: 'core/web-app.types.application',
        children: [
          {
            id: 'app/runtime',
            type: 'core/web-app.types.service',
            parent: 'app',
          },
        ],
      },
      {
        id: 'backend',
        type: 'core/web-app.types.service',
      },
    ],
    relations: [
      {
        id: 'app-calls-backend',
        type: 'core/software.relations.calls',
        from: 'app/runtime',
        to: 'backend',
      },
    ],
  };
}

describe('final graph review helpers', () => {
  it('counts nested entities in the regression summary', () => {
    const assembledDoc = createAssembledDoc();
    const summary = buildFinalGraphReviewSummary({
      assembledDoc,
      candidateDoc: {
        ...assembledDoc,
        entities: assembledDoc.entities.slice(0, 1),
        relations: [],
      },
    });

    expect(summary.assembledDocument.entityCount).toBe(3);
    expect(summary.candidateFinalGraph.entityCount).toBe(2);
    expect(summary.removedEntityIds).toEqual(['backend']);
    expect(summary.removedRelationIds).toEqual(['app-calls-backend']);
    expect(summary.candidateMissingRelationEndpointIds).toEqual([]);
  });

  const decide = (
    candidateDoc: SemanticDocument,
    inputDiagnostics: import('../semantic').Diagnostic[] = [],
    validate = (_: SemanticDocument): import('../semantic').Diagnostic[] => [],
  ) =>
    detectFinalGraphRegression({
      assembledDoc: createAssembledDoc(),
      candidateDoc,
      inputDiagnostics,
      validate,
    });

  it('restores only a removed valid relation and keeps additions', () => {
    const candidate = createAssembledDoc();
    candidate.relations = [{ id: 'new', from: 'backend', to: 'app', type: 'calls' }];
    candidate.entities.push({ id: 'added', type: 'service' });
    const result = decide(candidate);
    expect(result.document.relations.map((item) => item.id)).toEqual(['new', 'app-calls-backend']);
    expect(result.document.entities.some((item) => item.id === 'added')).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.review.reverted_edit',
        relationId: 'app-calls-backend',
        details: { edit: 'removed' },
      }),
    ]);
    expect(result.useAssembledGraph).toBe(false);
  });

  it('restores valid entity type and parenting changes independently of children', () => {
    const candidate = createAssembledDoc();
    candidate.entities[0].type = 'different';
    candidate.entities[0].children!.push({ id: 'new-child', type: 'service' });
    const result = decide(candidate);
    expect(result.document.entities[0].type).toBe(createAssembledDoc().entities[0].type);
    expect(result.document.entities[0].children!.map((item) => item.id)).toEqual([
      'app/runtime',
      'new-child',
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].entityId).toBe('app');
  });

  it('allows a deterministically invalid input relation to be removed', () => {
    const candidate = createAssembledDoc();
    candidate.relations = [];
    const result = decide(candidate, [
      {
        domain: 'diagram',
        phase: 'document',
        severity: 'error',
        code: 'invalid',
        message: 'invalid relation',
        relationId: 'app-calls-backend',
      },
    ]);
    expect(result.document.relations).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('guards root-only graphs without any child relations', () => {
    const assembledDoc = createAssembledDoc();
    assembledDoc.entities[0].children = [];
    assembledDoc.relations[0].from = 'app';
    const result = detectFinalGraphRegression({
      assembledDoc,
      candidateDoc: { ...assembledDoc, relations: [] },
      inputDiagnostics: [],
      validate: () => [],
    });
    expect(result.document.relations).toEqual(assembledDoc.relations);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('falls back with an explanation if the merged graph is invalid', () => {
    const candidate = createAssembledDoc();
    candidate.relations.push({ id: 'new', from: 'missing', to: 'backend' });
    const result = decide(candidate, [], () => [
      {
        domain: 'diagram',
        phase: 'document',
        severity: 'error',
        code: 'invalid',
        message: 'missing endpoint',
      },
    ]);
    expect(result.useAssembledGraph).toBe(true);
    expect(result.document).toEqual(createAssembledDoc());
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'diagram.review.reverted_all',
        message: expect.stringContaining('missing endpoint'),
      }),
    ]);
  });
});
