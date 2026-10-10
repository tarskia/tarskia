import { isDeepStrictEqual } from 'node:util';
import { type Diagnostic, diagramDiagnostic, type SemanticDocument } from '../semantic';
import type { FinalGraphReviewSummary } from './types';

function listEntities(doc: SemanticDocument): SemanticDocument['entities'] {
  const visit = (entities: SemanticDocument['entities']): SemanticDocument['entities'] =>
    entities.flatMap((entity) => [entity, ...visit(entity.children ?? [])]);
  return visit(doc.entities);
}

interface DocumentStructureSnapshot {
  entityParentById: Map<string, string | null>;
  relationSignatureById: Map<
    string,
    {
      from: string;
      to: string;
      type: string | null;
    }
  >;
}

function snapshotDocumentStructure(doc: SemanticDocument): DocumentStructureSnapshot {
  const entityParentById = new Map<string, string | null>();
  const visit = (entities: SemanticDocument['entities'], parentId: string | null) => {
    for (const entity of entities) {
      entityParentById.set(entity.id, parentId);
      visit(entity.children ?? [], entity.id);
    }
  };
  visit(doc.entities, null);

  const relationSignatureById = new Map(
    doc.relations.map((relation) => [
      relation.id,
      {
        from: relation.from,
        to: relation.to,
        type: relation.type ?? null,
      },
    ]),
  );

  return {
    entityParentById,
    relationSignatureById,
  };
}

function listRelationIdsWithMissingEndpoints(doc: SemanticDocument): string[] {
  const entityIds = new Set(listEntities(doc).map((entity) => entity.id));
  return doc.relations
    .filter((relation) => !entityIds.has(relation.from) || !entityIds.has(relation.to))
    .map((relation) => relation.id);
}

export function buildFinalGraphReviewSummary(params: {
  assembledDoc: SemanticDocument;
  candidateDoc: SemanticDocument;
}): FinalGraphReviewSummary {
  const assembled = snapshotDocumentStructure(params.assembledDoc);
  const candidate = snapshotDocumentStructure(params.candidateDoc);

  const removedEntityIds = [...assembled.entityParentById.keys()].filter(
    (entityId) => !candidate.entityParentById.has(entityId),
  );
  const reparentedEntityIds = [...assembled.entityParentById.entries()]
    .filter(([entityId, parentId]) => {
      const candidateParentId = candidate.entityParentById.get(entityId);
      return candidateParentId !== undefined && candidateParentId !== parentId;
    })
    .map(([entityId]) => entityId);
  const removedRelationIds = [...assembled.relationSignatureById.keys()].filter(
    (relationId) => !candidate.relationSignatureById.has(relationId),
  );
  const rewrittenRelationIds = [...assembled.relationSignatureById.entries()]
    .filter(([relationId, signature]) => {
      const candidateSignature = candidate.relationSignatureById.get(relationId);
      return (
        candidateSignature !== undefined &&
        (candidateSignature.from !== signature.from ||
          candidateSignature.to !== signature.to ||
          candidateSignature.type !== signature.type)
      );
    })
    .map(([relationId]) => relationId);
  const candidateMissingRelationEndpointIds = listRelationIdsWithMissingEndpoints(
    params.candidateDoc,
  );

  return {
    assembledDocument: {
      entityCount: assembled.entityParentById.size,
      relationCount: params.assembledDoc.relations.length,
    },
    candidateFinalGraph: {
      entityCount: candidate.entityParentById.size,
      relationCount: params.candidateDoc.relations.length,
    },
    removedEntityIds,
    reparentedEntityIds,
    removedRelationIds,
    rewrittenRelationIds,
    candidateMissingRelationEndpointIds,
  };
}

export interface FinalGraphRegressionDecision {
  document: SemanticDocument;
  diagnostics: Diagnostic[];
  useAssembledGraph: boolean;
}

/** Restore only valid input items. Children are independent items, not part of a parent's payload. */
export function detectFinalGraphRegression(params: {
  assembledDoc: SemanticDocument;
  candidateDoc: SemanticDocument;
  inputDiagnostics: Diagnostic[];
  validate: (document: SemanticDocument) => Diagnostic[];
}): FinalGraphRegressionDecision {
  type Entity = SemanticDocument['entities'][number];
  const flatten = (
    entities: Entity[],
    parent: string | null = null,
    result = new Map<string, { entity: Entity; parent: string | null }>(),
  ) => {
    for (const entity of entities) {
      const { children, ...own } = entity;
      result.set(entity.id, { entity: own, parent });
      flatten(children ?? [], entity.id, result);
    }
    return result;
  };
  const before = flatten(params.assembledDoc.entities);
  const after = flatten(params.candidateDoc.entities);
  const relations = new Map(params.candidateDoc.relations.map((item) => [item.id, item]));
  const duplicateIds =
    after.size !== listEntities(params.candidateDoc).length ||
    relations.size !== params.candidateDoc.relations.length;
  const errors = params.inputDiagnostics.filter((item) => item.severity === 'error');
  const diagnostics: Diagnostic[] = [];
  const warn = (kind: 'entity' | 'relation', id: string, removed: boolean) => {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.review.reverted_edit',
        message: `Restored ${kind} ${id}: review ${removed ? 'removed' : 'rewritten'} a valid input item.`,
        ...(kind === 'entity' ? { entityId: id } : { relationId: id }),
        details: { edit: removed ? 'removed' : 'rewritten' },
      }),
    );
  };
  for (const [id, original] of before) {
    if (errors.some((error) => error.entityId === id)) continue;
    const candidate = after.get(id);
    if (
      !isDeepStrictEqual(
        JSON.parse(JSON.stringify(original)),
        candidate === undefined ? undefined : JSON.parse(JSON.stringify(candidate)),
      )
    ) {
      after.set(id, original);
      warn('entity', id, !candidate);
    }
  }
  for (const original of params.assembledDoc.relations) {
    if (errors.some((error) => error.relationId === original.id)) continue;
    const candidate = relations.get(original.id);
    if (
      !isDeepStrictEqual(
        JSON.parse(JSON.stringify(original)),
        candidate === undefined ? undefined : JSON.parse(JSON.stringify(candidate)),
      )
    ) {
      relations.set(original.id, original);
      warn('relation', original.id, !candidate);
    }
  }
  // Rebuild nesting while retaining all independent additions and accepted edits.
  const entities: Entity[] = [];
  const rebuilt = new Map(
    [...after].map(([id, item]) => [id, { ...item.entity, children: [] as Entity[] }]),
  );
  let invalidHierarchy = duplicateIds;
  for (const [id, item] of after) {
    const entity = rebuilt.get(id)!;
    const visited = new Set([id]);
    let ancestor = item.parent;
    while (ancestor !== null) {
      if (visited.has(ancestor) || !after.has(ancestor)) {
        invalidHierarchy = true;
        break;
      }
      visited.add(ancestor);
      ancestor = after.get(ancestor)!.parent;
    }
    if (invalidHierarchy) break;
    if (item.parent === null) entities.push(entity);
    else rebuilt.get(item.parent)!.children!.push(entity);
  }
  const document = { ...params.candidateDoc, entities, relations: [...relations.values()] };
  const mergedErrors = invalidHierarchy
    ? []
    : params.validate(document).filter((item) => item.severity === 'error');
  if (invalidHierarchy || mergedErrors.length > 0) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.review.reverted_all',
        message: `Restored the input graph because the merged review is invalid: ${
          invalidHierarchy
            ? 'duplicate item id or missing/cyclic entity parent'
            : mergedErrors.map((item) => item.message).join('; ')
        }`,
      }),
    );
    return { document: params.assembledDoc, diagnostics, useAssembledGraph: true };
  }
  return { document, diagnostics, useAssembledGraph: false };
}
