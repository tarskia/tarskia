import {
  getAllowedRelationTypeIds,
  getResolvedTypeSemantics,
  type SchemaModule,
  type SchemaSemantics,
} from '../../semantic';
import type {
  ActiveEdgeProposal,
  ChildNodeSpec,
  InheritedNodeEdgeContract,
  NodeRefinementResult,
} from '../types';
import { buildActiveEdgeProposalMap } from './edge-contracts';
import {
  collectSpecificEvidencePaths,
  findOverlappingContextPath,
  type SuggestedFlowEdgeRefinement,
} from './evidence';
import { CALLS_RELATION_TYPE_ID, READ_WRITE_RELATION_TYPE_IDS } from './schema-context';

export function getInheritedEdgeRefinementEndpointTypes(params: {
  edgeRefinement: NodeRefinementResult['edgeRefinements'][number];
  inheritedEdge: InheritedNodeEdgeContract;
  childByLocalId: Map<string, ChildNodeSpec>;
  activeEdgeProposals?: ActiveEdgeProposal[];
}): { sourceTypeId?: string; targetTypeId?: string } {
  const proposalEndpoints = params.activeEdgeProposals
    ? buildActiveEdgeProposalMap(params.activeEdgeProposals).get(params.edgeRefinement.edgeId)
    : undefined;
  const matchedSourceProposal =
    !params.edgeRefinement.fromChildLocalId && params.edgeRefinement.toChildLocalId
      ? proposalEndpoints?.from
      : undefined;
  const matchedTargetProposal =
    params.edgeRefinement.fromChildLocalId && !params.edgeRefinement.toChildLocalId
      ? proposalEndpoints?.to
      : undefined;
  return {
    sourceTypeId: params.edgeRefinement.fromChildLocalId
      ? params.childByLocalId.get(params.edgeRefinement.fromChildLocalId)?.typeId
      : (matchedSourceProposal?.childTypeId ?? params.inheritedEdge.sourceTypeId),
    targetTypeId: params.edgeRefinement.toChildLocalId
      ? params.childByLocalId.get(params.edgeRefinement.toChildLocalId)?.typeId
      : (matchedTargetProposal?.childTypeId ?? params.inheritedEdge.targetTypeId),
  };
}

export function relationTypeIsValidForEndpoints(params: {
  schema: SchemaModule;
  semantics: SchemaSemantics;
  fromTypeId?: string;
  toTypeId?: string;
  relationTypeId?: string;
}): boolean {
  if (!params.fromTypeId || !params.toTypeId || !params.relationTypeId) {
    return false;
  }
  return getAllowedRelationTypeIds({
    schema: params.schema,
    semantics: params.semantics,
    fromTypeId: params.fromTypeId,
    toTypeId: params.toTypeId,
  }).includes(params.relationTypeId);
}

export function relationTypeIdIsReadWriteStyle(relationTypeId?: string): boolean {
  if (!relationTypeId) {
    return false;
  }
  return (
    READ_WRITE_RELATION_TYPE_IDS.has(relationTypeId) ||
    relationTypeId.endsWith('.relations.reads') ||
    relationTypeId.endsWith('.relations.writes') ||
    relationTypeId.endsWith('.relations.read-writes')
  );
}

export function typeHasStorageSemantics(semantics: SchemaSemantics, typeId?: string): boolean {
  if (!typeId) {
    return false;
  }
  return (
    getResolvedTypeSemantics(semantics, typeId)?.traitClosure.some(
      (traitId) =>
        traitId.endsWith('.traits.storage') ||
        traitId.endsWith('.traits.storage-boundary') ||
        traitId.endsWith('.traits.relational-storage') ||
        traitId.endsWith('.traits.table-like') ||
        traitId.endsWith('.traits.cache-space-like'),
    ) ?? false
  );
}

export function edgeIsReadWriteStyleStorageEdge(params: {
  edge: InheritedNodeEdgeContract;
  semantics: SchemaSemantics;
}): boolean {
  return (
    relationTypeIdIsReadWriteStyle(params.edge.relationTypeId) &&
    (typeHasStorageSemantics(params.semantics, params.edge.sourceTypeId) ||
      typeHasStorageSemantics(params.semantics, params.edge.targetTypeId))
  );
}

export function getSuggestedInheritedEdgeEndpointTypes(params: {
  edge: InheritedNodeEdgeContract;
  endpoint: 'from' | 'to';
  child: ChildNodeSpec;
  activeEdgeProposals?: ActiveEdgeProposal[];
}): { sourceTypeId?: string; targetTypeId?: string } {
  const proposalEndpoints = params.activeEdgeProposals
    ? buildActiveEdgeProposalMap(params.activeEdgeProposals).get(params.edge.id)
    : undefined;
  return {
    sourceTypeId:
      params.endpoint === 'from'
        ? params.child.typeId
        : (proposalEndpoints?.from?.childTypeId ?? params.edge.sourceTypeId),
    targetTypeId:
      params.endpoint === 'to'
        ? params.child.typeId
        : (proposalEndpoints?.to?.childTypeId ?? params.edge.targetTypeId),
  };
}

export function chooseSuggestedInheritedEdgeRelationType(params: {
  edge: InheritedNodeEdgeContract;
  endpoint: 'from' | 'to';
  child: ChildNodeSpec;
  schema: SchemaModule;
  semantics: SchemaSemantics;
  activeEdgeProposals?: ActiveEdgeProposal[];
}): { relationTypeId?: string; validRelationTypeIds: string[] } {
  const { sourceTypeId, targetTypeId } = getSuggestedInheritedEdgeEndpointTypes({
    edge: params.edge,
    endpoint: params.endpoint,
    child: params.child,
    activeEdgeProposals: params.activeEdgeProposals,
  });
  const validRelationTypeIds =
    sourceTypeId && targetTypeId
      ? getAllowedRelationTypeIds({
          schema: params.schema,
          semantics: params.semantics,
          fromTypeId: sourceTypeId,
          toTypeId: targetTypeId,
        }).sort((left, right) => left.localeCompare(right))
      : [];

  if (params.edge.relationTypeId && validRelationTypeIds.includes(params.edge.relationTypeId)) {
    return {
      relationTypeId: params.edge.relationTypeId,
      validRelationTypeIds,
    };
  }

  if (
    edgeIsReadWriteStyleStorageEdge({ edge: params.edge, semantics: params.semantics }) &&
    validRelationTypeIds.includes(CALLS_RELATION_TYPE_ID)
  ) {
    return {
      relationTypeId: CALLS_RELATION_TYPE_ID,
      validRelationTypeIds,
    };
  }

  return { validRelationTypeIds };
}

export function buildUnrefinedInheritedEdgeSuggestions(params: {
  edge: InheritedNodeEdgeContract;
  endpoint: 'from' | 'to';
  children: ChildNodeSpec[];
  schema: SchemaModule;
  semantics: SchemaSemantics;
  activeEdgeProposals?: ActiveEdgeProposal[];
}): SuggestedFlowEdgeRefinement[] {
  const edgePaths = collectSpecificEvidencePaths({ evidence: params.edge.evidence });
  if (edgePaths.length === 0) {
    return [];
  }

  return params.children
    .flatMap((child): SuggestedFlowEdgeRefinement[] => {
      const matchingPath = findOverlappingContextPath(
        collectSpecificEvidencePaths(child),
        edgePaths,
      );
      if (!matchingPath) {
        return [];
      }
      const { relationTypeId, validRelationTypeIds } = chooseSuggestedInheritedEdgeRelationType({
        edge: params.edge,
        endpoint: params.endpoint,
        child,
        schema: params.schema,
        semantics: params.semantics,
        activeEdgeProposals: params.activeEdgeProposals,
      });
      return [
        {
          edgeId: params.edge.id,
          endpoint: params.endpoint,
          childLocalId: child.localId,
          fromChildLocalId: params.endpoint === 'from' ? child.localId : undefined,
          toChildLocalId: params.endpoint === 'to' ? child.localId : undefined,
          relationTypeId,
          validRelationTypeIds: relationTypeId ? undefined : validRelationTypeIds,
          matchingPath,
          reason: `child evidence overlaps inherited ${params.endpoint} edge evidence at ${matchingPath}`,
        },
      ];
    })
    .sort((left, right) => {
      const leftKey = `${left.edgeId}:${left.endpoint}:${left.childLocalId}:${left.matchingPath}`;
      const rightKey = `${right.edgeId}:${right.endpoint}:${right.childLocalId}:${right.matchingPath}`;
      return leftKey.localeCompare(rightKey);
    });
}
