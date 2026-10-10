import {
  buildSchemaActivationMap,
  buildSchemaId,
  type Diagnostic,
  getAllowedChildTypeIds,
  parseSchemaRef,
  type SchemaActivation,
  type SchemaModule,
  type SchemaSemantics,
} from '../../semantic';
import { validateNodeRefinementResultShape } from '../node-refinement';
import { isGroupLikeType } from '../refinement-helpers';
import type { ActiveEdgeProposal, NodeRefinementResult, NodeRefinementTask } from '../types';
import { collectFlowRelevantChildIds } from './flow-children';

export type NodeValidationParams = {
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  schema: SchemaModule;
  semantics: SchemaSemantics;
  schemaActivations: SchemaActivation[];
  activeEdgeProposals?: ActiveEdgeProposal[];
};
export function createValidationContext(params: NodeValidationParams) {
  const diagnostics: Diagnostic[] = [
    ...validateNodeRefinementResultShape({
      result: params.result,
      nodeId: params.task.nodeId,
    }),
  ];
  const allowedChildTypeIds = new Set(
    getAllowedChildTypeIds({
      schema: params.schema,
      parentTypeId: params.task.nodeTypeId,
      schemaActivations: params.schemaActivations,
    }),
  );
  const activationMap = buildSchemaActivationMap(params.schemaActivations);
  const getTypeLayer = (typeId: string): number | undefined => {
    const typeDef = params.schema.types.find((candidate) => candidate.id === typeId);
    return typeDef?.originSchemaId
      ? activationMap.get(buildSchemaId(parseSchemaRef(typeDef.originSchemaId)))?.layer
      : undefined;
  };
  const parentLayer = getTypeLayer(params.task.nodeTypeId);
  const childByLocalId = new Map(
    params.result.children.map((child) => [child.localId, child] as const),
  );
  const inboundEdgeIds = new Set(params.task.inboundEdges.map((edge) => edge.id));
  const outboundEdgeIds = new Set(params.task.outboundEdges.map((edge) => edge.id));
  const { flowRelevantChildIds } = collectFlowRelevantChildIds(params.result);
  const taskIsGroupLike = isGroupLikeType(params.semantics, params.task.nodeTypeId);
  return {
    params,
    diagnostics,
    allowedChildTypeIds,
    activationMap,
    getTypeLayer,
    parentLayer,
    childByLocalId,
    inboundEdgeIds,
    outboundEdgeIds,
    flowRelevantChildIds,
    taskIsGroupLike,
  };
}
