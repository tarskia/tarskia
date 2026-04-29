import { buildEntityIndex } from './entity-tree';
import { FREEFORM_RELATION_TYPE } from './schema-ids';
import {
  compileSchemaSemantics,
  getResolvedRelationSemantics,
  getResolvedTypeSemantics,
  type ResolvedFlowRole,
  type ResolvedTypeExpectations,
  relationTypeMatchesEndpoints,
  type SchemaSemantics,
} from './schema-semantics';
import type {
  Relation,
  RelationFulfillment,
  RelationTypeDef,
  SchemaModule,
  SemanticDocument,
} from './types';

export type FlowExpectationStatus = 'not_expected' | 'fulfilled' | 'missing';
export type EntityFlowExpectationStatus = 'not_applicable' | 'fulfilled' | 'partial' | 'missing';

export type RelationFlowIssue =
  | 'missing_relation_type'
  | 'unsupported_relation_type'
  | 'unknown_relation_type'
  | 'inactive_relation'
  | 'missing_source_entity'
  | 'missing_target_entity'
  | 'endpoint_mismatch';

export interface EntityFlowExpectationFulfillment {
  expected: boolean;
  status: FlowExpectationStatus;
  fulfilledByRelationIds: string[];
}

export interface ExpectedRelationFulfillmentStatus {
  relationTypeId: string;
  fulfilled: boolean;
  fulfilledByRelationIds: string[];
}

export interface EntityFlowAnalysis {
  entityId: string;
  entityTypeId: string;
  flowRole: ResolvedFlowRole;
  expectations: ResolvedTypeExpectations;
  fulfillment: {
    ingress: EntityFlowExpectationFulfillment;
    egress: EntityFlowExpectationFulfillment;
    expectedRelations: ExpectedRelationFulfillmentStatus[];
    status: EntityFlowExpectationStatus;
    hasExpectations: boolean;
    allExpectationsFulfilled: boolean;
    missingExpectedRelationIds: string[];
  };
  contributingRelationIds: string[];
}

export interface RelationFlowAnalysis {
  relationId: string;
  relationTypeId?: string;
  sourceId: string;
  targetId: string;
  sourceTypeId?: string;
  targetTypeId?: string;
  fulfillment: {
    from: RelationFulfillment[];
    to: RelationFulfillment[];
  };
  countsForExpectationFulfillment: boolean;
  issues: RelationFlowIssue[];
}

export interface DocumentFlowAnalysis {
  entitiesById: Map<string, EntityFlowAnalysis>;
  relationsById: Map<string, RelationFlowAnalysis>;
}

const EMPTY_EXPECTATIONS: ResolvedTypeExpectations = {
  expectsIngress: false,
  expectsEgress: false,
  mayTerminate: false,
  expectedRelationIds: [],
  flowRole: 'none',
};

const deriveExpectationStatus = (expected: boolean, fulfilledByRelationIds: string[]) => {
  if (!expected) return 'not_expected' satisfies FlowExpectationStatus;
  return fulfilledByRelationIds.length > 0 ? 'fulfilled' : 'missing';
};

const deriveOverallExpectationStatus = (params: {
  hasExpectations: boolean;
  ingress: FlowExpectationStatus;
  egress: FlowExpectationStatus;
  expectedRelations: ExpectedRelationFulfillmentStatus[];
}): EntityFlowExpectationStatus => {
  const { hasExpectations, ingress, egress, expectedRelations } = params;
  if (!hasExpectations) return 'not_applicable';

  const statuses: Array<FlowExpectationStatus | 'fulfilled' | 'missing'> = [
    ingress,
    egress,
    ...expectedRelations.map((entry) => (entry.fulfilled ? 'fulfilled' : 'missing')),
  ].filter((status) => status !== 'not_expected');

  if (statuses.length === 0) return 'not_applicable';
  if (statuses.every((status) => status === 'fulfilled')) return 'fulfilled';
  if (statuses.every((status) => status === 'missing')) return 'missing';
  return 'partial';
};

const createEmptyEntityFlowAnalysis = (params: {
  entityId: string;
  entityTypeId: string;
  expectations: ResolvedTypeExpectations;
}): EntityFlowAnalysis => ({
  entityId: params.entityId,
  entityTypeId: params.entityTypeId,
  flowRole: params.expectations.flowRole,
  expectations: params.expectations,
  fulfillment: {
    ingress: {
      expected: params.expectations.expectsIngress,
      status: 'not_expected',
      fulfilledByRelationIds: [],
    },
    egress: {
      expected: params.expectations.expectsEgress,
      status: 'not_expected',
      fulfilledByRelationIds: [],
    },
    expectedRelations: params.expectations.expectedRelationIds.map((relationTypeId) => ({
      relationTypeId,
      fulfilled: false,
      fulfilledByRelationIds: [],
    })),
    status: 'not_applicable',
    hasExpectations:
      params.expectations.expectsIngress ||
      params.expectations.expectsEgress ||
      params.expectations.expectedRelationIds.length > 0,
    allExpectationsFulfilled: false,
    missingExpectedRelationIds: [],
  },
  contributingRelationIds: [],
});

const buildRelationFlowAnalysis = (params: {
  relation: Relation;
  schema: SchemaModule;
  semantics: SchemaSemantics;
  entityTypesById: Map<string, string>;
}): RelationFlowAnalysis => {
  const { relation, schema, semantics, entityTypesById } = params;
  const relationTypeId = relation.type;
  const sourceTypeId = entityTypesById.get(relation.from);
  const targetTypeId = entityTypesById.get(relation.to);
  const relationTypeById = new Map(schema.relations.map((entry) => [entry.id, entry] as const));
  const issues: RelationFlowIssue[] = [];

  if (relation.state === 'none') {
    issues.push('inactive_relation');
  }
  if (!relationTypeId) {
    issues.push('missing_relation_type');
  } else if (relationTypeId === FREEFORM_RELATION_TYPE) {
    issues.push('unsupported_relation_type');
  }

  const relationType: RelationTypeDef | undefined =
    relationTypeId && relationTypeId !== FREEFORM_RELATION_TYPE
      ? relationTypeById.get(relationTypeId)
      : undefined;
  const relationSemantics =
    relationTypeId && relationTypeId !== FREEFORM_RELATION_TYPE
      ? getResolvedRelationSemantics(semantics, relationTypeId)
      : undefined;

  if (
    relationTypeId &&
    relationTypeId !== FREEFORM_RELATION_TYPE &&
    (!relationType || !relationSemantics)
  ) {
    issues.push('unknown_relation_type');
  }
  if (!sourceTypeId) {
    issues.push('missing_source_entity');
  }
  if (!targetTypeId) {
    issues.push('missing_target_entity');
  }
  if (
    relationType &&
    relationSemantics &&
    sourceTypeId &&
    targetTypeId &&
    !relationTypeMatchesEndpoints({
      semantics,
      relationType,
      fromType: sourceTypeId,
      toType: targetTypeId,
    })
  ) {
    issues.push('endpoint_mismatch');
  }

  return {
    relationId: relation.id,
    relationTypeId,
    sourceId: relation.from,
    targetId: relation.to,
    sourceTypeId,
    targetTypeId,
    fulfillment: {
      from: relationSemantics?.fulfills.from ?? [],
      to: relationSemantics?.fulfills.to ?? [],
    },
    countsForExpectationFulfillment: issues.length === 0,
    issues,
  };
};

const applyRelationContribution = (params: {
  relation: RelationFlowAnalysis;
  entityAnalysis: EntityFlowAnalysis;
  endpoint: 'from' | 'to';
}): void => {
  const { relation, entityAnalysis, endpoint } = params;
  const endpointFulfills =
    endpoint === 'from' ? relation.fulfillment.from : relation.fulfillment.to;

  if (
    endpointFulfills.length === 0 &&
    !entityAnalysis.expectations.expectedRelationIds.includes(relation.relationTypeId ?? '')
  ) {
    return;
  }

  if (!entityAnalysis.contributingRelationIds.includes(relation.relationId)) {
    entityAnalysis.contributingRelationIds.push(relation.relationId);
  }

  if (endpointFulfills.includes('ingress')) {
    entityAnalysis.fulfillment.ingress.fulfilledByRelationIds.push(relation.relationId);
  }
  if (endpointFulfills.includes('egress')) {
    entityAnalysis.fulfillment.egress.fulfilledByRelationIds.push(relation.relationId);
  }

  if (!relation.relationTypeId) {
    return;
  }
  const expectedRelation = entityAnalysis.fulfillment.expectedRelations.find(
    (entry) => entry.relationTypeId === relation.relationTypeId,
  );
  if (expectedRelation) {
    expectedRelation.fulfilledByRelationIds.push(relation.relationId);
  }
};

const collectSelfAndAncestors = (
  entityId: string,
  parentById: ReadonlyMap<string, string | undefined>,
): string[] => {
  const chain: string[] = [];
  let currentId: string | undefined = entityId;
  while (currentId) {
    chain.push(currentId);
    currentId = parentById.get(currentId);
  }
  return chain;
};

const collectContributionEntityIds = (params: {
  entityId: string;
  oppositeEntityId: string;
  parentById: ReadonlyMap<string, string | undefined>;
}): string[] => {
  const entityChain = collectSelfAndAncestors(params.entityId, params.parentById);
  const oppositeAncestors = new Set(
    collectSelfAndAncestors(params.oppositeEntityId, params.parentById),
  );
  const lowestCommonAncestorId = entityChain.find((ancestorId) =>
    oppositeAncestors.has(ancestorId),
  );

  if (!lowestCommonAncestorId) {
    return entityChain;
  }

  const contributionEntityIds = entityChain.slice(0, entityChain.indexOf(lowestCommonAncestorId));
  return contributionEntityIds;
};

const finalizeEntityFlowAnalysis = (analysis: EntityFlowAnalysis): EntityFlowAnalysis => {
  analysis.fulfillment.ingress.status = deriveExpectationStatus(
    analysis.fulfillment.ingress.expected,
    analysis.fulfillment.ingress.fulfilledByRelationIds,
  );
  analysis.fulfillment.egress.status = deriveExpectationStatus(
    analysis.fulfillment.egress.expected,
    analysis.fulfillment.egress.fulfilledByRelationIds,
  );

  for (const relationExpectation of analysis.fulfillment.expectedRelations) {
    relationExpectation.fulfilled = relationExpectation.fulfilledByRelationIds.length > 0;
  }

  analysis.fulfillment.missingExpectedRelationIds = analysis.fulfillment.expectedRelations
    .filter((entry) => !entry.fulfilled)
    .map((entry) => entry.relationTypeId);
  analysis.fulfillment.allExpectationsFulfilled =
    analysis.fulfillment.ingress.status !== 'missing' &&
    analysis.fulfillment.egress.status !== 'missing' &&
    analysis.fulfillment.missingExpectedRelationIds.length === 0;
  analysis.fulfillment.status = deriveOverallExpectationStatus({
    hasExpectations: analysis.fulfillment.hasExpectations,
    ingress: analysis.fulfillment.ingress.status,
    egress: analysis.fulfillment.egress.status,
    expectedRelations: analysis.fulfillment.expectedRelations,
  });

  analysis.contributingRelationIds.sort((left, right) => left.localeCompare(right));
  analysis.fulfillment.ingress.fulfilledByRelationIds.sort((left, right) =>
    left.localeCompare(right),
  );
  analysis.fulfillment.egress.fulfilledByRelationIds.sort((left, right) =>
    left.localeCompare(right),
  );
  for (const relationExpectation of analysis.fulfillment.expectedRelations) {
    relationExpectation.fulfilledByRelationIds.sort((left, right) => left.localeCompare(right));
  }

  return analysis;
};

export const analyzeDocumentFlow = (params: {
  doc: SemanticDocument;
  schema: SchemaModule;
  semantics?: SchemaSemantics;
}): DocumentFlowAnalysis => {
  const { doc, schema } = params;
  const semantics = params.semantics ?? compileSchemaSemantics(schema);
  const entityIndex = buildEntityIndex(doc.entities);
  const entityTypesById = new Map(
    entityIndex.entries.map((entry) => [entry.entity.id, entry.entity.type] as const),
  );

  const entitiesById = new Map<string, EntityFlowAnalysis>();
  for (const entry of entityIndex.entries) {
    const expectations =
      getResolvedTypeSemantics(semantics, entry.entity.type)?.expectations ?? EMPTY_EXPECTATIONS;
    entitiesById.set(
      entry.entity.id,
      createEmptyEntityFlowAnalysis({
        entityId: entry.entity.id,
        entityTypeId: entry.entity.type,
        expectations,
      }),
    );
  }

  const relationsById = new Map<string, RelationFlowAnalysis>();
  for (const relation of doc.relations) {
    const relationAnalysis = buildRelationFlowAnalysis({
      relation,
      schema,
      semantics,
      entityTypesById,
    });
    relationsById.set(relation.id, relationAnalysis);

    if (!relationAnalysis.countsForExpectationFulfillment) {
      continue;
    }

    const sourceContributionEntityIds = collectContributionEntityIds({
      entityId: relation.from,
      oppositeEntityId: relation.to,
      parentById: entityIndex.parentById,
    });
    for (const sourceEntityId of sourceContributionEntityIds) {
      const sourceAnalysis = entitiesById.get(sourceEntityId);
      if (!sourceAnalysis) {
        continue;
      }
      applyRelationContribution({
        relation: relationAnalysis,
        entityAnalysis: sourceAnalysis,
        endpoint: 'from',
      });
    }

    const targetContributionEntityIds = collectContributionEntityIds({
      entityId: relation.to,
      oppositeEntityId: relation.from,
      parentById: entityIndex.parentById,
    });
    for (const targetEntityId of targetContributionEntityIds) {
      const targetAnalysis = entitiesById.get(targetEntityId);
      if (!targetAnalysis) {
        continue;
      }
      applyRelationContribution({
        relation: relationAnalysis,
        entityAnalysis: targetAnalysis,
        endpoint: 'to',
      });
    }
  }

  for (const [entityId, analysis] of entitiesById) {
    entitiesById.set(entityId, finalizeEntityFlowAnalysis(analysis));
  }

  return {
    entitiesById,
    relationsById,
  };
};
