import { extractJsonResponse, normalizeStringArray } from './refinement-helpers';

export { extractJsonResponse } from './refinement-helpers';

import type { AdvancedBuildPromptRunner } from '../codex/advanced-thread-manager';
import type { DiagramPromptPackage } from '../codex/prompt-package';
import { normalizeGalleryDescriptionText } from '../gallery-metadata';
import type { Logger } from '../logger';
import { buildSchemaActivation, type SchemaActivation } from '../semantic';
import type { TokenUsageTotals } from '../token-usage';
import { assertYamlInputSize, parseYamlText as parseYaml } from '../untrusted-yaml';
import type { PreparedWorkspace } from '../workspace';
import { normalizeConceptKind } from './concept-plan';
import type { GraphifyHints } from './graphify-hints';
import { toLowercaseSlug } from './slug';
import type { AdvisoryConcept, AreaPlan, RepoCensus, SchemaRefCandidate } from './types';

export interface AreaPlannerInput {
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  repoCensus: RepoCensus;
  graphifyHints?: GraphifyHints;
  promptPackage: DiagramPromptPackage;
  logger: Logger;
  promptRunner?: AdvancedBuildPromptRunner;
  handoffArtifactPath?: string;
  schemaValidationCommand?: string;
}

export interface AreaPlannerResult {
  plan: AreaPlan;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface AreaPlanner {
  planAreas(input: AreaPlannerInput): Promise<AreaPlannerResult>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSchemaActivations(value: unknown): SchemaActivation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (!isNonEmptyString(record.schema)) {
        return null;
      }
      const layer = record.layer;
      if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 0) {
        return null;
      }
      return buildSchemaActivation(record.schema.trim(), layer);
    })
    .filter((activation): activation is SchemaActivation => activation !== null)
    .filter((activation) => {
      const key = `${activation.schema}@${activation.layer}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeSchemaRefCandidates(value: unknown): SchemaRefCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenSchemaIds = new Set<string>();
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (!isNonEmptyString(record.schemaRef) || !isNonEmptyString(record.rationale)) {
        return null;
      }
      const suggestedLayer = record.suggestedLayer;
      if (
        typeof suggestedLayer !== 'number' ||
        !Number.isInteger(suggestedLayer) ||
        suggestedLayer < 0
      ) {
        return null;
      }
      const evidence = Array.isArray(record.evidence)
        ? record.evidence
            .map((entry) => {
              if (!entry || typeof entry !== 'object') {
                return null;
              }
              const evidenceRecord = entry as Record<string, unknown>;
              if (
                !isNonEmptyString(evidenceRecord.path) ||
                !isNonEmptyString(evidenceRecord.reason)
              ) {
                return null;
              }
              return {
                path: evidenceRecord.path.trim(),
                reason: evidenceRecord.reason.trim(),
              };
            })
            .filter((entry): entry is SchemaRefCandidate['evidence'][number] => entry !== null)
        : [];
      if (evidence.length === 0) {
        return null;
      }
      return {
        schemaRef: record.schemaRef.trim(),
        suggestedLayer,
        rationale: record.rationale.trim(),
        evidence,
      } satisfies SchemaRefCandidate;
    })
    .filter((candidate): candidate is SchemaRefCandidate => candidate !== null)
    .filter((candidate) => {
      const schemaId = candidate.schemaRef.replace(/@.+$/, '');
      if (seenSchemaIds.has(schemaId)) {
        return false;
      }
      seenSchemaIds.add(schemaId);
      return true;
    });
}

function normalizeConceptHints(value: unknown): string[] {
  return normalizeStringArray(value);
}

function normalizeAdvisoryConcept(value: unknown, index: number): AdvisoryConcept | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = toLowercaseSlug(
    isNonEmptyString(record.id) ? record.id.trim() : `concept-${index + 1}`,
    `concept-${index + 1}`,
  );
  const title = isNonEmptyString(record.title) ? record.title.trim() : id;
  const paths = normalizeStringArray(record.paths);
  const rationale = isNonEmptyString(record.rationale)
    ? record.rationale.trim()
    : 'No rationale provided.';
  const evidence = Array.isArray(record.evidence)
    ? record.evidence
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const evidenceRecord = item as Record<string, unknown>;
          if (!isNonEmptyString(evidenceRecord.path) || !isNonEmptyString(evidenceRecord.reason)) {
            return null;
          }
          return {
            path: evidenceRecord.path.trim(),
            reason: evidenceRecord.reason.trim(),
          };
        })
        .filter((item): item is AdvisoryConcept['evidence'][number] => item !== null)
    : [];

  if (paths.length === 0 || evidence.length === 0) {
    return null;
  }

  return {
    id,
    kind: normalizeConceptKind(record.kind),
    title,
    paths,
    rationale,
    evidence,
    groupingHints: normalizeConceptHints(record.groupingHints),
    openQuestions: normalizeStringArray(record.openQuestions),
  };
}

export function parseAreaPlanResponse(response: string): AreaPlan {
  assertYamlInputSize(response);
  const extracted = extractJsonResponse(response);
  const parsed = (
    extracted.trim().startsWith('{') || extracted.trim().startsWith('[')
      ? JSON.parse(extracted)
      : parseYaml(extracted)
  ) as Record<string, unknown>;

  const repoSummary = isNonEmptyString(parsed.repoSummary)
    ? parsed.repoSummary.trim()
    : 'No repository summary provided.';
  const galleryDescription = normalizeGalleryDescriptionText(
    isNonEmptyString(parsed.galleryDescription) ? parsed.galleryDescription : repoSummary,
  );
  const initialSchemaActivations = normalizeSchemaActivations(parsed.initialSchemaActivations);
  const candidateSchemaRefs = normalizeSchemaRefCandidates(parsed.candidateSchemaRefs);
  const rawConcepts = Array.isArray(parsed.keyConcepts)
    ? parsed.keyConcepts
    : Array.isArray(parsed.areas)
      ? parsed.areas
      : [];
  const keyConcepts = rawConcepts
    .map((concept, index) => normalizeAdvisoryConcept(concept, index))
    .filter((concept): concept is AdvisoryConcept => concept !== null);

  const seenIds = new Set<string>();
  const uniqueConcepts = keyConcepts.filter((concept) => {
    if (seenIds.has(concept.id)) {
      return false;
    }
    seenIds.add(concept.id);
    return true;
  });

  if (uniqueConcepts.length === 0) {
    throw new Error('Concept plan did not include any valid keyConcepts');
  }

  return {
    repoSummary,
    ...(galleryDescription ? { galleryDescription } : {}),
    initialSchemaActivations,
    candidateSchemaRefs,
    keyConcepts: uniqueConcepts,
    areas: uniqueConcepts,
  };
}
