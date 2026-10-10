import type { Entity, SemanticDocument } from '../semantic';
import { dedupeEvidence } from './refinement-helpers';
import type { AdvisoryConcept, AreaPlan, ConceptKind, ConceptPlanEvidence } from './types';

function normalizeLabel(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePathList(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function overlapsPath(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function collectEntityEvidence(entity: Entity): ConceptPlanEvidence[] {
  const provenanceLocations = entity.provenance?.locations ?? [];
  const evidence = provenanceLocations
    .filter((location) => location.path.trim().length > 0)
    .map((location) => ({
      path: location.path,
      reason: `Backbone provenance for ${entity.name?.trim() || entity.id}`,
    }));
  return dedupeEvidence(evidence);
}

function collectEntityPaths(entity: Entity): string[] {
  return normalizePathList(collectEntityEvidence(entity).map((entry) => entry.path));
}

function hasPathOverlap(left: string[], right: string[]): boolean {
  return left.some((leftPath) => right.some((rightPath) => overlapsPath(leftPath, rightPath)));
}

function scoreConceptForEntity(concept: AdvisoryConcept, entity: Entity): number {
  const normalizedEntityId = normalizeLabel(entity.id);
  const normalizedEntityName = normalizeLabel(entity.name);
  const normalizedConceptId = normalizeLabel(concept.id);
  const normalizedConceptTitle = normalizeLabel(concept.title);
  const entityPaths = collectEntityPaths(entity);
  const conceptPaths = normalizePathList([
    ...concept.paths,
    ...concept.evidence.map((entry) => entry.path),
  ]);
  const externalRoot = isProbablyExternalRoot(entity);

  let score = 0;
  if (concept.id === entity.id) {
    score += 100;
  }
  if (
    normalizedEntityName &&
    (normalizedEntityName === normalizedConceptTitle ||
      normalizedEntityName === normalizedConceptId)
  ) {
    score += 70;
  }
  if (normalizedEntityId && normalizedEntityId === normalizedConceptId) {
    score += 60;
  }
  if (
    !externalRoot &&
    entityPaths.length > 0 &&
    conceptPaths.length > 0 &&
    hasPathOverlap(entityPaths, conceptPaths)
  ) {
    score += 30;
  }
  if (
    concept.kind !== 'unknown' &&
    normalizedEntityName &&
    normalizedConceptTitle &&
    (normalizedEntityName.includes(normalizedConceptTitle) ||
      normalizedConceptTitle.includes(normalizedEntityName))
  ) {
    score += 10;
  }
  return score;
}

function isStrongConceptMatch(score: number): boolean {
  return score >= 30;
}

function isProbablyExternalRoot(entity: Entity): boolean {
  return /(^|[./-])(external|browser|actor|human|user)([./-]|$)/i.test(entity.type);
}

export function listPlanConcepts(plan: AreaPlan): AdvisoryConcept[] {
  const concepts = plan.keyConcepts?.length ? plan.keyConcepts : (plan.areas ?? []);
  return [...concepts];
}

export function findMatchingPlanConcepts(params: {
  plan: AreaPlan;
  entity: Entity;
}): AdvisoryConcept[] {
  return listPlanConcepts(params.plan)
    .map((concept) => ({
      concept,
      score: scoreConceptForEntity(concept, params.entity),
    }))
    .filter(({ score }) => isStrongConceptMatch(score))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.concept.id.localeCompare(right.concept.id);
    })
    .map(({ concept }) => concept);
}

export function buildPlanSupportForEntity(params: { plan: AreaPlan; entity: Entity }): {
  concepts: AdvisoryConcept[];
  scope: string[];
  evidence: ConceptPlanEvidence[];
  title?: string;
} {
  const concepts = findMatchingPlanConcepts(params);
  const entityEvidence = collectEntityEvidence(params.entity);

  if (concepts.length === 0) {
    return {
      concepts,
      scope: normalizePathList(entityEvidence.map((entry) => entry.path)),
      evidence: entityEvidence,
      title: undefined,
    };
  }

  const scope = normalizePathList([
    ...concepts.flatMap((concept) => concept.paths),
    ...entityEvidence.map((entry) => entry.path),
  ]);
  const evidence = dedupeEvidence([
    ...concepts.flatMap((concept) => concept.evidence),
    ...entityEvidence,
  ]);

  return {
    concepts,
    scope,
    evidence,
    title: concepts.length === 1 ? concepts[0]?.title : undefined,
  };
}

export function resolveVisibleResponsibilityIdsFromPlan(params: {
  level0Doc: SemanticDocument;
  plan: AreaPlan;
}): string[] {
  const roots = params.level0Doc.entities.filter((entity) => !entity.parent);
  const matchedRootIds = roots
    .filter((entity) => findMatchingPlanConcepts({ plan: params.plan, entity }).length > 0)
    .map((entity) => entity.id);

  if (matchedRootIds.length > 0) {
    const visibleRootIds = roots
      .filter((entity) => matchedRootIds.includes(entity.id) || !isProbablyExternalRoot(entity))
      .map((entity) => entity.id);
    return [...new Set(visibleRootIds)].sort((left, right) => left.localeCompare(right));
  }

  return roots
    .filter((entity) => !isProbablyExternalRoot(entity))
    .map((entity) => entity.id)
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeConceptKind(value: unknown): ConceptKind {
  switch (value) {
    case 'frontend':
    case 'service':
    case 'async-plane':
    case 'runtime-plane':
    case 'datastore':
    case 'protocol-surface':
    case 'shared-kernel':
    case 'integration':
    case 'external':
      return value;
    default:
      return 'unknown';
  }
}
