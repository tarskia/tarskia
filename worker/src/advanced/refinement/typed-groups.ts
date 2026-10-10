import type { SchemaSemantics } from '../../semantic';
import { isGroupLikeType } from '../refinement-helpers';
import { toLowercaseSlug } from '../slug';
import type {
  AreaPlanEvidence,
  ChildNodeSpec,
  NodeRefinementResult,
  NodeRefinementTask,
} from '../types';
import {
  buildEvidenceMatchedFlowEdgeRefinements,
  collectSpecificEvidencePaths,
  findOverlappingContextPath,
  normalizeEvidencePath,
} from './evidence';
import { MAX_SYNTHETIC_TYPED_GROUP_CHILDREN } from './schema-context';

export function pathBasenameWithoutExtension(path: string): string {
  const basename = normalizeEvidencePath(path).split('/').pop() ?? path;
  return basename.replace(/\.[^.]+$/, '');
}

export function titleFromLocalId(localId: string): string {
  return localId
    .split('-')
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}

export function buildUniqueEvidenceChildLocalId(path: string, usedLocalIds: Set<string>): string {
  const normalizedPath = normalizeEvidencePath(path);
  const segments = normalizedPath.split('/').filter(Boolean);
  const basename = pathBasenameWithoutExtension(normalizedPath);
  const parentSegment = segments.length > 1 ? segments[segments.length - 2] : '';
  const candidates = [
    toLowercaseSlug(basename, 'module'),
    toLowercaseSlug(`${parentSegment}-${basename}`, 'module'),
  ];

  for (const candidate of candidates) {
    if (!usedLocalIds.has(candidate)) {
      usedLocalIds.add(candidate);
      return candidate;
    }
  }

  const base = candidates[1] ?? candidates[0] ?? 'module';
  let index = 2;
  while (usedLocalIds.has(`${base}-${index}`)) {
    index += 1;
  }
  const unique = `${base}-${index}`;
  usedLocalIds.add(unique);
  return unique;
}

export function buildConcreteTypedChildrenFromEvidence(params: {
  typeId: string;
  scope: string[];
  evidence: AreaPlanEvidence[];
}): ChildNodeSpec[] {
  const paths = collectSpecificEvidencePaths(params);
  if (paths.length > MAX_SYNTHETIC_TYPED_GROUP_CHILDREN) {
    return [];
  }
  const usedLocalIds = new Set<string>();

  return paths.map((path) => {
    const localId = buildUniqueEvidenceChildLocalId(path, usedLocalIds);
    const evidence = params.evidence.filter((item) =>
      Boolean(findOverlappingContextPath([path], [item.path])),
    );
    return {
      localId,
      name: titleFromLocalId(localId),
      typeId: params.typeId,
      scope: [path],
      evidence:
        evidence.length > 0
          ? evidence
          : [
              {
                path,
                reason: `Concrete implementation evidence for ${titleFromLocalId(localId)}`,
              },
            ],
      queueDecision: 'leaf',
    };
  });
}

export function buildEvidenceMatchedEdgeRefinementsForChildren(params: {
  task: Pick<NodeRefinementTask, 'inboundEdges' | 'outboundEdges'>;
  children: ChildNodeSpec[];
}): NodeRefinementResult['edgeRefinements'] {
  return params.children.flatMap((child) =>
    buildEvidenceMatchedFlowEdgeRefinements({ task: params.task, child }).map((suggestion) => ({
      edgeId: suggestion.edgeId,
      relationTypeId: undefined,
      fromChildLocalId: suggestion.endpoint === 'from' ? suggestion.childLocalId : undefined,
      toChildLocalId: suggestion.endpoint === 'to' ? suggestion.childLocalId : undefined,
    })),
  );
}

export function retargetWrapperEdgeRefinements(params: {
  wrapperLocalId: string;
  replacementChildren: ChildNodeSpec[];
  edgeRefinements: NodeRefinementResult['edgeRefinements'];
}): NodeRefinementResult['edgeRefinements'] {
  return params.edgeRefinements.flatMap((edgeRefinement) => {
    const replacesFrom = edgeRefinement.fromChildLocalId === params.wrapperLocalId;
    const replacesTo = edgeRefinement.toChildLocalId === params.wrapperLocalId;
    if (!replacesFrom && !replacesTo) {
      return [edgeRefinement];
    }
    return params.replacementChildren.map((child) => ({
      ...edgeRefinement,
      fromChildLocalId: replacesFrom ? child.localId : edgeRefinement.fromChildLocalId,
      toChildLocalId: replacesTo ? child.localId : edgeRefinement.toChildLocalId,
    }));
  });
}

export function retargetWrapperEdgeProposals(params: {
  wrapperLocalId: string;
  replacementChildren: ChildNodeSpec[];
  edgeProposals?: NodeRefinementResult['edgeProposals'];
}): NodeRefinementResult['edgeProposals'] {
  if (!params.edgeProposals) {
    return params.edgeProposals;
  }
  return params.edgeProposals.flatMap((edgeProposal) => {
    if (edgeProposal.childLocalId !== params.wrapperLocalId) {
      return [edgeProposal];
    }
    return params.replacementChildren.map((child) => ({
      ...edgeProposal,
      childLocalId: child.localId,
    }));
  });
}

export function collapseDegenerateTypedGroupRefinement(params: {
  semantics: SchemaSemantics;
  task: Pick<
    NodeRefinementTask,
    'nodeId' | 'nodeName' | 'groupMode' | 'groupTypeId' | 'inboundEdges' | 'outboundEdges'
  > &
    Partial<Pick<NodeRefinementTask, 'scope' | 'evidence'>>;
  children: ChildNodeSpec[];
  relations: NodeRefinementResult['relations'];
  edgeRefinements: NodeRefinementResult['edgeRefinements'];
  edgeProposals?: NodeRefinementResult['edgeProposals'];
}): {
  children: ChildNodeSpec[];
  relations: NodeRefinementResult['relations'];
  edgeRefinements: NodeRefinementResult['edgeRefinements'];
  edgeProposals?: NodeRefinementResult['edgeProposals'];
} {
  if (params.task.groupMode !== 'typed' || !params.task.groupTypeId) {
    return params;
  }
  if (params.relations.length > 0) {
    return params;
  }

  const firstChild = params.children[0];
  const replacementChildren =
    params.children.length === 0
      ? buildConcreteTypedChildrenFromEvidence({
          typeId: params.task.groupTypeId,
          scope: params.task.scope ?? [],
          evidence: params.task.evidence ?? [],
        })
      : params.children.length === 1 &&
          firstChild &&
          isGroupLikeType(params.semantics, firstChild.typeId) &&
          firstChild?.groupMode === 'typed' &&
          firstChild?.groupTypeId === params.task.groupTypeId
        ? buildConcreteTypedChildrenFromEvidence({
            typeId: params.task.groupTypeId,
            scope: firstChild.scope,
            evidence: firstChild.evidence,
          })
        : [];

  if (replacementChildren.length === 0) {
    return params;
  }

  const wrapperLocalId = params.children.length === 1 ? params.children[0]?.localId : undefined;
  const edgeRefinements = wrapperLocalId
    ? retargetWrapperEdgeRefinements({
        wrapperLocalId,
        replacementChildren,
        edgeRefinements: params.edgeRefinements,
      })
    : params.edgeRefinements;
  const edgeProposals = wrapperLocalId
    ? retargetWrapperEdgeProposals({
        wrapperLocalId,
        replacementChildren,
        edgeProposals: params.edgeProposals,
      })
    : params.edgeProposals;

  return {
    children: replacementChildren,
    relations: [],
    edgeRefinements: [
      ...edgeRefinements,
      ...buildEvidenceMatchedEdgeRefinementsForChildren({
        task: params.task,
        children: replacementChildren,
      }),
    ],
    edgeProposals,
  };
}
