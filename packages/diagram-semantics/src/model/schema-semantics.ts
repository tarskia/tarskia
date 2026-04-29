import { getTraitAncestors, resolveTypeDef, traitMatches, typeMatches } from './schema';
import { buildSchemaActivationMap, buildSchemaId, parseSchemaRef } from './schema-ref';
import type {
  RelationFulfillment,
  RelationTypeDef,
  SchemaActivation,
  SchemaModule,
  TraitFlowType,
  TraitRelationParticipation,
} from './types';

export type ResolvedFlowRole = 'none' | TraitFlowType;
export type RelationEndpointRole = 'from' | 'to';

export interface ResolvedTypeRelationParticipation {
  relationId: string;
  from: boolean;
  to: boolean;
}

export interface ResolvedTypeExpectations {
  expectsIngress: boolean;
  expectsEgress: boolean;
  mayTerminate: boolean;
  expectedRelationIds: string[];
  flowRole: ResolvedFlowRole;
}

export interface ResolvedTypeSemantics {
  typeId: string;
  traitClosure: string[];
  relationParticipation: ResolvedTypeRelationParticipation[];
  expectations: ResolvedTypeExpectations;
}

export interface ResolvedRelationSemantics {
  relationId: string;
  fulfills: {
    from: RelationFulfillment[];
    to: RelationFulfillment[];
  };
}

export interface SchemaSemantics {
  typesById: Map<string, ResolvedTypeSemantics>;
  relationsById: Map<string, ResolvedRelationSemantics>;
}

const CONTAINER_TRAIT_ID = 'core/base.traits.container';
const CONTAINABLE_TRAIT_ID = 'core/base.traits.containable';
const GROUP_LIKE_TRAIT_ID = 'core/base.traits.group-like';

const sortStrings = (values: Iterable<string>) =>
  [...values].sort((left, right) => left.localeCompare(right));

const normalizeEndpointParticipation = (
  entry: TraitRelationParticipation,
): { from: boolean; to: boolean } => ({
  from: entry.endpoint === 'from' || entry.endpoint === 'both',
  to: entry.endpoint === 'to' || entry.endpoint === 'both',
});

const deriveFlowExpectations = (
  flowType?: TraitFlowType,
): Pick<ResolvedTypeExpectations, 'expectsIngress' | 'expectsEgress'> => {
  if (flowType === 'source') {
    return { expectsIngress: false, expectsEgress: true };
  }
  if (flowType === 'sink') {
    return { expectsIngress: true, expectsEgress: false };
  }
  if (flowType === 'through') {
    return { expectsIngress: true, expectsEgress: true };
  }
  return { expectsIngress: false, expectsEgress: false };
};

const deriveFlowRole = ({
  expectsIngress,
  expectsEgress,
}: Pick<ResolvedTypeExpectations, 'expectsIngress' | 'expectsEgress'>): ResolvedFlowRole => {
  if (expectsIngress && expectsEgress) return 'through';
  if (expectsIngress) return 'sink';
  if (expectsEgress) return 'source';
  return 'none';
};

const buildTraitClosure = (schema: SchemaModule, typeId: string): string[] => {
  const resolvedType = resolveTypeDef(schema, typeId);
  const traitIds = new Set<string>();
  for (const traitId of resolvedType?.traits ?? []) {
    for (const ancestor of getTraitAncestors(schema, traitId)) {
      traitIds.add(ancestor);
    }
  }
  return sortStrings(traitIds);
};

const buildRelationSemantics = (relation: RelationTypeDef): ResolvedRelationSemantics => ({
  relationId: relation.id,
  fulfills: {
    from: [...new Set(relation.analysis?.fulfills?.from ?? [])],
    to: [...new Set(relation.analysis?.fulfills?.to ?? [])],
  },
});

const buildTypeSemantics = (schema: SchemaModule, typeId: string): ResolvedTypeSemantics => {
  const traitMap = new Map((schema.traits ?? []).map((trait) => [trait.id, trait] as const));
  const relationParticipationById = new Map<string, ResolvedTypeRelationParticipation>();
  const expectedRelationIds = new Set<string>();
  let expectsIngress = false;
  let expectsEgress = false;
  let mayTerminate = false;
  const traitClosure = buildTraitClosure(schema, typeId);

  for (const traitId of traitClosure) {
    const trait = traitMap.get(traitId);
    if (!trait) continue;
    const analysis = trait.analysis;

    for (const relationId of analysis?.expectedRelationIds ?? []) {
      expectedRelationIds.add(relationId);
    }

    const expectation = deriveFlowExpectations(analysis?.flowType);
    expectsIngress = expectsIngress || expectation.expectsIngress;
    expectsEgress = expectsEgress || expectation.expectsEgress;
    mayTerminate = mayTerminate || analysis?.mayTerminate === true;

    for (const entry of trait.relationParticipation ?? []) {
      const participation = relationParticipationById.get(entry.relation) ?? {
        relationId: entry.relation,
        from: false,
        to: false,
      };
      const endpoint = normalizeEndpointParticipation(entry);
      participation.from = participation.from || endpoint.from;
      participation.to = participation.to || endpoint.to;
      relationParticipationById.set(entry.relation, participation);
    }
  }

  const expectations: ResolvedTypeExpectations = {
    expectsIngress,
    expectsEgress,
    mayTerminate,
    expectedRelationIds: sortStrings(expectedRelationIds),
    flowRole: deriveFlowRole({ expectsIngress, expectsEgress }),
  };

  return {
    typeId,
    traitClosure,
    relationParticipation: sortStrings(relationParticipationById.keys()).map((relationId) => {
      const participation = relationParticipationById.get(relationId);
      if (!participation) {
        throw new Error(`Missing compiled participation for relation ${relationId}`);
      }
      return participation;
    }),
    expectations,
  };
};

export const compileSchemaSemantics = (schema: SchemaModule): SchemaSemantics => ({
  typesById: new Map(
    schema.types.map((type) => [type.id, buildTypeSemantics(schema, type.id)] as const),
  ),
  relationsById: new Map(
    schema.relations.map((relation) => [relation.id, buildRelationSemantics(relation)] as const),
  ),
});

export const getResolvedTypeSemantics = (semantics: SchemaSemantics, typeId: string) =>
  semantics.typesById.get(typeId);

export const getResolvedRelationSemantics = (semantics: SchemaSemantics, relationId: string) =>
  semantics.relationsById.get(relationId);

export const typeSupportsRelationEndpoint = (
  semantics: SchemaSemantics,
  typeId: string,
  relationId: string,
  endpoint: RelationEndpointRole,
): boolean => {
  const typeSemantics = getResolvedTypeSemantics(semantics, typeId);
  if (!typeSemantics) return false;
  const participation = typeSemantics.relationParticipation.find(
    (candidate) => candidate.relationId === relationId,
  );
  if (!participation) return false;
  return endpoint === 'from' ? participation.from : participation.to;
};

export const relationTypeMatchesEndpoints = ({
  semantics,
  relationType,
  fromType,
  toType,
}: {
  semantics: SchemaSemantics;
  relationType: RelationTypeDef;
  fromType: string;
  toType: string;
}) => {
  const forwardMatches =
    typeSupportsRelationEndpoint(semantics, fromType, relationType.id, 'from') &&
    typeSupportsRelationEndpoint(semantics, toType, relationType.id, 'to');
  const reverseMatches =
    typeSupportsRelationEndpoint(semantics, toType, relationType.id, 'from') &&
    typeSupportsRelationEndpoint(semantics, fromType, relationType.id, 'to');
  const directed = relationType.directed ?? true;
  return directed ? forwardMatches : forwardMatches || reverseMatches;
};

export const getAllowedChildTypeIds = ({
  schema,
  parentTypeId,
  schemaActivations,
}: {
  schema: SchemaModule;
  parentTypeId: string;
  schemaActivations?: SchemaActivation[];
}): string[] => {
  const parentType = resolveTypeDef(schema, parentTypeId);
  const containment = parentType?.containment;
  const activationMap = schemaActivations ? buildSchemaActivationMap(schemaActivations) : undefined;
  const parentLayer =
    parentType?.originSchemaId && activationMap
      ? activationMap.get(buildSchemaId(parseSchemaRef(parentType.originSchemaId)))?.layer
      : undefined;

  return schema.types
    .filter((candidate) => {
      const candidateType = resolveTypeDef(schema, candidate.id);
      const childLayer =
        candidateType?.originSchemaId && activationMap
          ? activationMap.get(buildSchemaId(parseSchemaRef(candidateType.originSchemaId)))?.layer
          : undefined;

      const explicitContainmentOk = containment
        ? (containment.allowedChildTypes
            ? typeMatches(schema, candidate.id, containment.allowedChildTypes)
            : true) &&
          (containment.allowedChildTraits
            ? traitMatches(schema, candidate.id, containment.allowedChildTraits)
            : true)
        : false;
      const structuralGroupContainmentOk =
        explicitContainmentOk && traitMatches(schema, candidate.id, [GROUP_LIKE_TRAIT_ID]);

      if (structuralGroupContainmentOk) {
        return true;
      }

      if (parentLayer !== undefined && childLayer !== undefined) {
        const layerDelta = childLayer - parentLayer;
        if (layerDelta < 0 || layerDelta > 1) {
          return false;
        }
        if (layerDelta === 1) {
          return (
            traitMatches(schema, parentTypeId, [CONTAINER_TRAIT_ID]) &&
            traitMatches(schema, candidate.id, [CONTAINABLE_TRAIT_ID])
          );
        }
      }

      if (!containment) {
        return false;
      }

      return explicitContainmentOk;
    })
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
};

export const isAllowedChildType = ({
  schema,
  parentTypeId,
  childTypeId,
  schemaActivations,
}: {
  schema: SchemaModule;
  parentTypeId: string;
  childTypeId: string;
  schemaActivations?: SchemaActivation[];
}): boolean =>
  getAllowedChildTypeIds({ schema, parentTypeId, schemaActivations }).includes(childTypeId);

export const getAllowedRelationTypeIds = ({
  schema,
  semantics,
  fromTypeId,
  toTypeId,
}: {
  schema: SchemaModule;
  semantics: SchemaSemantics;
  fromTypeId: string;
  toTypeId: string;
}): string[] =>
  schema.relations
    .filter((relationType) =>
      relationTypeMatchesEndpoints({
        semantics,
        relationType,
        fromType: fromTypeId,
        toType: toTypeId,
      }),
    )
    .map((relationType) => relationType.id)
    .sort((left, right) => left.localeCompare(right));

export const getTypeFlowSemantics = (semantics: SchemaSemantics, typeId: string) =>
  getResolvedTypeSemantics(semantics, typeId)?.expectations;
