import {
  type Diagnostic,
  diagramDiagnostic,
  hasDisallowedRepoPathPrefix,
  isRepoRelativePath,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  sortDiagnostics,
} from '../semantic';
import { assertYamlInputSize, parseYamlText as parseYaml } from '../untrusted-yaml';
import { buildNodeRefinementEdgeHandles } from './node-refinement-edge-handles';
import {
  dedupeEdgeProposals,
  extractJsonResponse,
  normalizeEvidence,
  normalizeStringArray,
} from './refinement-helpers';
import { toLowercaseSlug } from './slug';
import type {
  AreaPlanEvidence,
  ChildNodeSpec,
  ChildRelationSpec,
  GroupMode,
  InheritedEdgeProposal,
  InheritedEdgeRefinement,
  NodeRefinementResult,
  NodeRefinementTask,
} from './types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const WORKER_DISALLOWED_PROVENANCE_PATH_PREFIXES =
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS.provenance.disallowedPathPrefixes ?? [];

function isValidWorkerRepoRelativePath(value: string): boolean {
  return (
    isRepoRelativePath(value) &&
    !hasDisallowedRepoPathPrefix(value, WORKER_DISALLOWED_PROVENANCE_PATH_PREFIXES)
  );
}

function buildWorkerRepoRelativePathMessage(pathLabel: string, ownerLabel: string): string {
  return `${pathLabel} for ${ownerLabel} must be repo-relative to the target repository root and must not start with target-repo/`;
}

function normalizeGroupMode(value: unknown): GroupMode | undefined {
  if (value === 'mixed' || value === 'typed') {
    return value;
  }
  return undefined;
}

function normalizeProps(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeGroupModeForChild(record: Record<string, unknown>): GroupMode | undefined {
  const props = normalizeProps(record.props);
  return (
    normalizeGroupMode(record.groupMode) ??
    normalizeGroupMode(props?.mode) ??
    normalizeGroupMode(props?.groupMode)
  );
}

function normalizeGroupTypeIdForChild(record: Record<string, unknown>): string | undefined {
  const props = normalizeProps(record.props);
  if (isNonEmptyString(record.groupTypeId)) {
    return record.groupTypeId.trim();
  }
  if (isNonEmptyString(props?.groupType)) {
    return props.groupType.trim();
  }
  if (isNonEmptyString(props?.groupTypeId)) {
    return props.groupTypeId.trim();
  }
  return undefined;
}

function normalizeChildNode(
  value: unknown,
  invalid: (field: string) => void,
): ChildNodeSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('item (expected an object)');
    return null;
  }
  const record = value as Record<string, unknown>;
  const missing = ['localId', 'name', 'typeId'].filter((field) => !isNonEmptyString(record[field]));
  for (const field of missing) invalid(field);
  const validQueueDecision = record.queueDecision === 'expand' || record.queueDecision === 'leaf';
  if (!validQueueDecision) invalid('queueDecision (expected expand or leaf)');
  const evidence = normalizeEvidence(record.evidence);
  if (evidence.length === 0) invalid('evidence (expected at least one path and reason)');
  if (
    !isNonEmptyString(record.localId) ||
    !isNonEmptyString(record.name) ||
    !isNonEmptyString(record.typeId) ||
    evidence.length === 0 ||
    (record.queueDecision !== 'expand' && record.queueDecision !== 'leaf')
  )
    return null;
  const scope = normalizeStringArray(record.scope);
  return {
    localId: toLowercaseSlug(record.localId),
    name: record.name.trim(),
    description: isNonEmptyString(record.description) ? record.description.trim() : undefined,
    typeId: record.typeId.trim(),
    props: normalizeProps(record.props),
    responsibility: isNonEmptyString(record.responsibility)
      ? record.responsibility.trim()
      : undefined,
    scope: scope.length > 0 ? scope : [...new Set(evidence.map((item) => item.path))],
    evidence,
    queueDecision: record.queueDecision,
    groupMode: normalizeGroupModeForChild(record),
    groupTypeId: normalizeGroupTypeIdForChild(record),
  };
}

function normalizeChildRelation(
  value: unknown,
  invalid: (field: string) => void,
  normalizeReference: (value: string) => string,
): ChildRelationSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('item (expected an object)');
    return null;
  }
  const record = value as Record<string, unknown>;
  const missing = ['localId', 'typeId', 'fromLocalId', 'toLocalId'].filter(
    (field) => !isNonEmptyString(record[field]),
  );
  for (const field of missing) invalid(field);
  const evidence = normalizeEvidence(record.evidence);
  if (evidence.length === 0) invalid('evidence (expected at least one path and reason)');
  if (
    !isNonEmptyString(record.localId) ||
    !isNonEmptyString(record.typeId) ||
    !isNonEmptyString(record.fromLocalId) ||
    !isNonEmptyString(record.toLocalId) ||
    evidence.length === 0
  )
    return null;
  return {
    localId: toLowercaseSlug(record.localId.trim(), 'relation'),
    typeId: record.typeId.trim(),
    description: isNonEmptyString(record.description)
      ? record.description.trim()
      : isNonEmptyString(record.summary)
        ? record.summary.trim()
        : undefined,
    fromLocalId: normalizeReference(record.fromLocalId),
    toLocalId: normalizeReference(record.toLocalId),
    evidence,
  };
}

function normalizeEdgeRefinement(
  value: unknown,
  normalizeReference: (value: string) => string,
): InheritedEdgeRefinement | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.edgeId)) {
    return null;
  }
  const fromChildLocalId = isNonEmptyString(record.fromChildLocalId)
    ? normalizeReference(record.fromChildLocalId)
    : undefined;
  const toChildLocalId = isNonEmptyString(record.toChildLocalId)
    ? normalizeReference(record.toChildLocalId)
    : undefined;
  if (!fromChildLocalId && !toChildLocalId) {
    return null;
  }
  return {
    edgeId: record.edgeId.trim(),
    relationTypeId: isNonEmptyString(record.relationTypeId)
      ? record.relationTypeId.trim()
      : undefined,
    fromChildLocalId,
    toChildLocalId,
  };
}

function normalizeEdgeProposal(
  value: unknown,
  normalizeReference: (value: string) => string,
): InheritedEdgeProposal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.edgeId) ||
    !isNonEmptyString(record.childLocalId) ||
    (record.endpoint !== 'from' && record.endpoint !== 'to')
  ) {
    return null;
  }
  return {
    edgeId: record.edgeId.trim(),
    endpoint: record.endpoint,
    childLocalId: normalizeReference(record.childLocalId),
    relationTypeId: isNonEmptyString(record.relationTypeId)
      ? record.relationTypeId.trim()
      : undefined,
  };
}

function dedupeEdgeRefinements(
  edgeRefinements: InheritedEdgeRefinement[],
): InheritedEdgeRefinement[] {
  const seen = new Set<string>();
  const deduped: InheritedEdgeRefinement[] = [];
  for (const edgeRefinement of edgeRefinements) {
    const key = [
      edgeRefinement.edgeId,
      edgeRefinement.relationTypeId ?? '',
      edgeRefinement.fromChildLocalId ?? '',
      edgeRefinement.toChildLocalId ?? '',
    ].join('::');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edgeRefinement);
  }
  return deduped;
}

export function parseNodeRefinementResponse(
  response: string,
  task?: NodeRefinementTask,
): NodeRefinementResult {
  assertYamlInputSize(response);
  const extracted = extractJsonResponse(response);
  const parsed = (
    extracted.trim().startsWith('{') || extracted.trim().startsWith('[')
      ? JSON.parse(extracted)
      : parseYaml(extracted)
  ) as Record<string, unknown>;
  const parseDiagnostics: Diagnostic[] = [];
  const invalidItem =
    (kind: 'child' | 'relation', value: unknown, index: number) => (field: string) => {
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const itemId = isNonEmptyString(record.localId) ? record.localId : `#${index + 1}`;
      const from = isNonEmptyString(record.fromLocalId) ? record.fromLocalId : '?';
      const to = isNonEmptyString(record.toLocalId) ? record.toLocalId : '?';
      const label = kind === 'child' ? itemId : `${from} -> ${to} (${itemId})`;
      parseDiagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_item',
          ...(task ? { entityId: task.nodeId } : {}),
          message: `Dropped ${kind} ${label}: missing or invalid ${field}.`,
        }),
      );
    };
  const children = Array.isArray(parsed.children)
    ? parsed.children
        .map((child, index) => normalizeChildNode(child, invalidItem('child', child, index)))
        .filter((child): child is ChildNodeSpec => child !== null)
    : [];
  const childIds = new Set(children.map((child) => child.localId));
  const declaredChildIds = new Set<string>(
    Array.isArray(parsed.children)
      ? parsed.children.flatMap((child) =>
          child && typeof child === 'object' && isNonEmptyString(child.localId)
            ? [child.localId.trim()]
            : [],
        )
      : [],
  );
  const normalizeChildReference = (value: string): string => {
    const endpoint = value.trim();
    if (declaredChildIds.has(endpoint) && childIds.has(toLowercaseSlug(endpoint)))
      return toLowercaseSlug(endpoint);
    const prefix = task ? `${task.nodeId}/` : undefined;
    if (prefix && endpoint.startsWith(prefix)) {
      const localId = endpoint.slice(prefix.length);
      const normalized = toLowercaseSlug(localId);
      if (!localId.includes('/') && childIds.has(normalized)) return normalized;
    }
    // Absolute references outside this task's direct children are not local IDs.
    return endpoint.includes('/') ? endpoint : toLowercaseSlug(endpoint);
  };
  const boundaryIds = new Set(
    task
      ? [...task.inboundEdges, ...task.outboundEdges].flatMap((edge) => [
          edge.sourceId,
          edge.targetId,
        ])
      : [],
  );
  const normalizeRelationReference = (value: string): string =>
    boundaryIds.has(value.trim()) ? value.trim() : normalizeChildReference(value);
  const relations = Array.isArray(parsed.relations)
    ? parsed.relations
        .map((relation, index) =>
          normalizeChildRelation(
            relation,
            invalidItem('relation', relation, index),
            normalizeRelationReference,
          ),
        )
        .filter((relation): relation is ChildRelationSpec => relation !== null)
    : [];
  const edgeRefinements = Array.isArray(parsed.edgeRefinements)
    ? dedupeEdgeRefinements(
        parsed.edgeRefinements
          .map((edgeRefinement) => normalizeEdgeRefinement(edgeRefinement, normalizeChildReference))
          .filter(
            (edgeRefinement): edgeRefinement is InheritedEdgeRefinement => edgeRefinement !== null,
          ),
      )
    : [];
  const edgeProposals = Array.isArray(parsed.edgeProposals)
    ? dedupeEdgeProposals(
        parsed.edgeProposals
          .map((edgeProposal) => normalizeEdgeProposal(edgeProposal, normalizeChildReference))
          .filter((edgeProposal): edgeProposal is InheritedEdgeProposal => edgeProposal !== null),
      )
    : [];

  const edgeReferenceDiagnostics: Diagnostic[] = [];
  const handles = task ? buildNodeRefinementEdgeHandles(task) : undefined;
  const mapReferences = <T extends { edgeId: string }>(edges: T[]): T[] =>
    edges.flatMap((edge) => {
      if (!handles || !task) return [edge];
      const realId = Object.hasOwn(handles, edge.edgeId) ? handles[edge.edgeId] : undefined;
      if (realId !== undefined) return [{ ...edge, edgeId: realId }];
      edgeReferenceDiagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_edge_handle',
          entityId: task.nodeId,
          message: `Edge reference "${edge.edgeId}" is not one of this task's edges: ${Object.keys(handles).join(', ')}.`,
        }),
      );
      return [];
    });
  const mappedRefinements = mapReferences(edgeRefinements);
  const mappedProposals = mapReferences(edgeProposals);
  return {
    children,
    relations,
    ...(parseDiagnostics.length > 0 ? { parseDiagnostics } : {}),
    edgeRefinements: mappedRefinements,
    edgeProposals: mappedProposals,
    ...(edgeReferenceDiagnostics.length > 0 ? { edgeReferenceDiagnostics } : {}),
    suggestedSchemaRefs: normalizeStringArray(parsed.suggestedSchemaRefs),
    description: isNonEmptyString(parsed.description)
      ? parsed.description.trim()
      : normalizeStringArray(parsed.notes).join(' ').trim() || undefined,
    openQuestions: normalizeStringArray(parsed.openQuestions),
  };
}

export function validateNodeRefinementResultShape(params: {
  result: NodeRefinementResult;
  nodeId: string;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [
    ...(params.result.parseDiagnostics ?? []),
    ...(params.result.edgeReferenceDiagnostics ?? []),
  ];
  const childIds = new Set<string>();
  const relationIds = new Set<string>();
  const edgeRefinementKeys = new Set<string>();
  const edgeProposalKeys = new Set<string>();

  for (const child of params.result.children) {
    if (child.localId.includes('/')) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_child_local_id',
          entityId: params.nodeId,
          message: `Child ${child.localId} for ${params.nodeId} may not contain '/'`,
        }),
      );
    }
    if (childIds.has(child.localId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.duplicate_child_local_id',
          entityId: params.nodeId,
          message: `Child ${child.localId} is duplicated for ${params.nodeId}`,
        }),
      );
      continue;
    }
    childIds.add(child.localId);

    for (const scopePath of child.scope) {
      if (isValidWorkerRepoRelativePath(scopePath)) {
        continue;
      }
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_child_scope_path',
          entityId: params.nodeId,
          path: scopePath,
          message: buildWorkerRepoRelativePathMessage(
            `Scope path ${scopePath}`,
            `child ${child.localId}`,
          ),
        }),
      );
    }

    for (const evidence of child.evidence) {
      if (isValidWorkerRepoRelativePath(evidence.path)) {
        continue;
      }
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_child_evidence_path',
          entityId: params.nodeId,
          path: evidence.path,
          message: buildWorkerRepoRelativePathMessage(
            `Evidence path ${evidence.path}`,
            `child ${child.localId}`,
          ),
        }),
      );
    }
  }

  for (const relation of params.result.relations) {
    if (relationIds.has(relation.localId)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.duplicate_relation_local_id',
          entityId: params.nodeId,
          relationId: relation.localId,
          message: `Relation ${relation.localId} is duplicated for ${params.nodeId}`,
        }),
      );
    }
    relationIds.add(relation.localId);

    for (const evidence of relation.evidence) {
      if (isValidWorkerRepoRelativePath(evidence.path)) {
        continue;
      }
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_relation_evidence_path',
          entityId: params.nodeId,
          relationId: relation.localId,
          path: evidence.path,
          message: buildWorkerRepoRelativePathMessage(
            `Evidence path ${evidence.path}`,
            `relation ${relation.localId}`,
          ),
        }),
      );
    }
  }

  for (const edgeRefinement of params.result.edgeRefinements) {
    if (!edgeRefinement.fromChildLocalId && !edgeRefinement.toChildLocalId) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_edge_refinement',
          entityId: params.nodeId,
          message: `Edge refinement for ${edgeRefinement.edgeId} must refine at least one endpoint`,
        }),
      );
    }
    const key = [
      edgeRefinement.edgeId,
      edgeRefinement.relationTypeId ?? '',
      edgeRefinement.fromChildLocalId ?? '',
      edgeRefinement.toChildLocalId ?? '',
    ].join('::');
    if (edgeRefinementKeys.has(key)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.duplicate_edge_refinement',
          entityId: params.nodeId,
          message: `Edge refinement ${key} is duplicated for ${params.nodeId}`,
        }),
      );
      continue;
    }
    edgeRefinementKeys.add(key);
  }

  for (const edgeProposal of params.result.edgeProposals ?? []) {
    const key = [
      edgeProposal.edgeId,
      edgeProposal.endpoint,
      edgeProposal.childLocalId,
      edgeProposal.relationTypeId ?? '',
    ].join('::');
    if (edgeProposalKeys.has(key)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.duplicate_edge_proposal',
          entityId: params.nodeId,
          message: `Edge proposal ${key} is duplicated for ${params.nodeId}`,
        }),
      );
      continue;
    }
    edgeProposalKeys.add(key);
  }

  return sortDiagnostics(diagnostics);
}
