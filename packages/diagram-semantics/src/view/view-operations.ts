import type { DiagramView, Relation } from '../model/types';
import { collectDescendantParentIds, collectSingleChildChainDown } from '../tree/canonical-tree';
import type { SemanticEntityTree } from '../tree/entity-tree';
import { hasChildGroupControlRow } from './node-controls';
import { normalizeDiagramView, normalizeDiagramViewNodesById } from './normalize-diagram-view';
import { resolveRevealAnnotations } from './reveal-tree';

export type DiagramViewOperation =
  | { kind: 'toggle'; entityId: string }
  | { kind: 'set-expansion'; entityId: string; expanded: boolean; expandSingleChildChain?: boolean }
  | { kind: 'expand-all' | 'collapse-all' }
  | {
      kind: 'expand-within' | 'collapse-within' | 'expand-child-groups' | 'collapse-child-groups';
      entityId: string;
    }
  | { kind: 'enter-focus'; entityId: string; expandTarget?: boolean }
  | { kind: 'clear-focus' }
  | {
      kind: 'search-reveal';
      entityIds: Set<string>;
      relationIds: Set<string>;
      relations: Relation[];
    };

/** Pure view writers share the same canonical hierarchy as view compilation. */
export function applyDiagramViewOperation(
  tree: SemanticEntityTree,
  previous: DiagramView | undefined,
  operation: DiagramViewOperation,
): DiagramView | undefined {
  const view = normalizeDiagramView(previous);
  const nodes = { ...view.nodesById };
  let changed = false;
  const setExpanded = (id: string, expanded: boolean) => {
    if (Boolean(nodes[id]?.expanded) === expanded) return;
    nodes[id] = { ...nodes[id], expanded: expanded || undefined };
    changed = true;
  };
  const parentIds = (rootId: string) =>
    collectDescendantParentIds(tree, rootId, { includeRoot: true }).filter(
      (id) => id !== tree.rootId,
    );
  let scopeRootId = view.scopeRootId;
  switch (operation.kind) {
    case 'toggle':
    case 'set-expansion': {
      if (!tree.byId.has(operation.entityId)) break;
      const expanded =
        operation.kind === 'toggle' ? !nodes[operation.entityId]?.expanded : operation.expanded;
      const ids =
        operation.kind === 'set-expansion' && expanded && operation.expandSingleChildChain
          ? [
              operation.entityId,
              ...collectSingleChildChainDown(tree, operation.entityId).filter(
                (id) => tree.byId.get(id)?.hasChildren,
              ),
            ]
          : [operation.entityId];
      for (const id of ids) setExpanded(id, expanded);
      break;
    }
    case 'expand-all':
      for (const id of parentIds(tree.rootId)) setExpanded(id, true);
      break;
    case 'collapse-all':
      for (const id of Object.keys(nodes)) setExpanded(id, false);
      break;
    case 'expand-within':
    case 'collapse-within':
      for (const id of parentIds(operation.entityId))
        setExpanded(id, operation.kind === 'expand-within');
      break;
    case 'expand-child-groups':
    case 'collapse-child-groups': {
      const children =
        tree.byId.get(operation.entityId)?.children.filter((child) => child.hasChildren) ?? [];
      if (
        !hasChildGroupControlRow({
          rootExpanded: Boolean(nodes[operation.entityId]?.expanded),
          directChildParentCount: children.length,
        })
      )
        break;
      if (operation.kind === 'expand-child-groups') {
        for (const child of children) setExpanded(child.id, true);
      } else if (children.some((child) => nodes[child.id]?.expanded)) {
        for (const child of children) for (const id of parentIds(child.id)) setExpanded(id, false);
      }
      break;
    }
    case 'enter-focus':
      if (!tree.byId.get(operation.entityId)?.hasChildren) break;
      scopeRootId = operation.entityId;
      if (operation.expandTarget) setExpanded(operation.entityId, true);
      break;
    case 'clear-focus':
      scopeRootId = undefined;
      break;
    case 'search-reveal': {
      scopeRootId = undefined;
      const reveal = resolveRevealAnnotations({
        tree,
        expanded: {},
        targetNodeIds: operation.entityIds,
        targetEdgeIds: operation.relationIds,
        edges: operation.relations,
        forceExpandToTargets: true,
      });
      for (const id of reveal.includedNodeIds) {
        if (
          id === tree.rootId ||
          !tree.byId.get(id)?.children.some((child) => reveal.includedNodeIds.has(child.id))
        )
          continue;
        setExpanded(id, true);
      }
      break;
    }
  }
  if (!changed && scopeRootId === view.scopeRootId) return previous;
  return { ...view, scopeRootId, nodesById: normalizeDiagramViewNodesById(nodes) };
}
