import { useCallback } from 'react';

import type { CanonicalDiagramStructureQueries } from '../canvas/structure/queries';
import type {
  NavigationIntent,
  NavigationRequestResult,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import {
  buildEntityIndex,
  type DiagramViewNodeState,
  getDiagramViewExpandedMap,
  hasChildGroupControlRow,
  hasCollapsibleDirectChildParents,
  hasExpandableDirectChildParents,
  type SemanticDocument,
} from '../semantic';
import type { CommitDoc, EnsureDiagramView } from './types';

const normalizeNodesById = (
  nodesById: Record<string, DiagramViewNodeState> | undefined,
): Record<string, DiagramViewNodeState> | undefined => {
  if (!nodesById) return undefined;
  const entries = Object.entries(nodesById).filter(([, state]) =>
    Boolean(state?.expanded || state?.hidden || state?.highlighted),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const setExpandedState = (
  nodesById: Record<string, DiagramViewNodeState> | undefined,
  entityId: string,
  expanded: boolean,
) => {
  const nextNodesById = { ...(nodesById ?? {}) };
  const nextState = { ...(nextNodesById[entityId] ?? {}) };
  if (expanded) {
    nextState.expanded = true;
    nextNodesById[entityId] = nextState;
  } else {
    nextState.expanded = undefined;
    if (nextState.hidden || nextState.highlighted) {
      nextNodesById[entityId] = nextState;
    } else {
      delete nextNodesById[entityId];
    }
  }
  return normalizeNodesById(nextNodesById);
};

const collectSingleChildChainExpansionIds = (
  rootId: string,
  getChildren: (rootId: string) => Array<{ id: string }>,
) => {
  const expansionIds = [rootId];
  let currentId = rootId;
  while (true) {
    const children = getChildren(currentId);
    if (children.length !== 1) {
      return expansionIds;
    }
    const childId = children[0]?.id;
    if (!childId) {
      return expansionIds;
    }
    const childChildren = getChildren(childId);
    if (childChildren.length === 0) {
      return expansionIds;
    }
    expansionIds.push(childId);
    currentId = childId;
  }
};

interface EntityZoomOptions {
  onComplete?: () => void;
  expandSingleChildChain?: boolean;
}

interface UseDiagramActionsArgs {
  state: {
    doc: SemanticDocument;
    expanded: Record<string, boolean>;
  };
  document: {
    commitDoc: CommitDoc;
    ensureDiagramView: EnsureDiagramView;
  };
  transition: {
    requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
    setPendingStructuralTransitionIntent: (intent: StructuralTransitionIntent | null) => void;
    flushUserGesture: () => boolean;
  };
  sceneQueries: {
    structure: CanonicalDiagramStructureQueries;
  };
}

export function useDiagramActions({
  state,
  document,
  transition,
  sceneQueries,
}: UseDiagramActionsArgs) {
  const { doc, expanded } = state;
  const { commitDoc, ensureDiagramView } = document;
  const { requestNavigation, setPendingStructuralTransitionIntent, flushUserGesture } = transition;
  const { structure } = sceneQueries;
  const centerScene = useCallback(() => {
    requestNavigation({
      kind: 'fit-scene',
      preset: 'layout',
    });
  }, [requestNavigation]);

  const expandAll = useCallback(() => {
    const parents = new Set(buildEntityIndex(doc.entities).childrenByParent.keys());
    const willChange = [...parents].some((parentId) => !expanded[parentId]);
    if (!willChange) return;
    flushUserGesture();
    setPendingStructuralTransitionIntent({
      direction: 'in',
      focus: { kind: 'global' },
    });
    commitDoc((prev) => {
      const view = ensureDiagramView(prev.view);
      const currentExpanded = getDiagramViewExpandedMap(view);
      const nextExpanded = { ...currentExpanded };
      const nextParents = new Set(buildEntityIndex(prev.entities).childrenByParent.keys());
      for (const parentId of nextParents) {
        nextExpanded[parentId] = true;
      }
      const changed = Object.keys(nextExpanded).some(
        (id) => nextExpanded[id] !== currentExpanded[id],
      );
      if (!changed) return prev;
      return {
        ...prev,
        view: {
          ...view,
          nodesById: normalizeNodesById(
            Object.fromEntries([
              ...Object.entries(view.nodesById ?? {}),
              ...Object.entries(nextExpanded).map(([id, isExpanded]) => [
                id,
                { ...(view.nodesById?.[id] ?? {}), expanded: isExpanded || undefined },
              ]),
            ]),
          ),
        },
      };
    });
  }, [
    commitDoc,
    doc.entities,
    ensureDiagramView,
    expanded,
    flushUserGesture,
    setPendingStructuralTransitionIntent,
  ]);

  const collapseAll = useCallback(() => {
    if (Object.keys(expanded).length === 0) return;
    flushUserGesture();
    setPendingStructuralTransitionIntent({
      direction: 'out',
      focus: { kind: 'global' },
    });
    commitDoc((prev) => {
      const view = ensureDiagramView(prev.view);
      const nodesById = normalizeNodesById(
        Object.fromEntries(
          Object.entries(view.nodesById ?? {}).flatMap(([id, nodeState]) => {
            if (!nodeState) return [];
            const nextState = { ...nodeState };
            nextState.expanded = undefined;
            return nextState.hidden || nextState.highlighted ? [[id, nextState]] : [];
          }),
        ),
      );
      if (!view.nodesById || Object.keys(view.nodesById).length === 0) {
        return prev;
      }
      return {
        ...prev,
        view: {
          ...view,
          nodesById,
        },
      };
    });
  }, [
    commitDoc,
    ensureDiagramView,
    expanded,
    flushUserGesture,
    setPendingStructuralTransitionIntent,
  ]);

  const triggerEntityZoom = useCallback(
    (entityId: string, direction: 'in' | 'out', options?: EntityZoomOptions) => {
      const nextExpanded = direction === 'in';
      const targetIds =
        nextExpanded && options?.expandSingleChildChain
          ? collectSingleChildChainExpansionIds(entityId, structure.getChildren)
          : [entityId];
      const willChange = targetIds.some((id) => Boolean(expanded[id]) !== nextExpanded);
      if (!willChange) return false;
      flushUserGesture();
      const intent: StructuralTransitionIntent = {
        direction,
        focus: { kind: 'single', rootId: entityId },
      };
      if (options?.onComplete) {
        intent.onComplete = options.onComplete;
      }
      setPendingStructuralTransitionIntent(intent);
      commitDoc((prev) => {
        const view = ensureDiagramView(prev.view);
        let nextNodesById = view.nodesById;
        let changed = false;
        const currentExpanded = getDiagramViewExpandedMap(view);
        for (const id of targetIds) {
          if (Boolean(currentExpanded[id]) === nextExpanded) {
            continue;
          }
          nextNodesById = setExpandedState(nextNodesById, id, nextExpanded);
          changed = true;
        }
        if (!changed) return prev;
        return {
          ...prev,
          view: {
            ...view,
            nodesById: nextNodesById,
          },
        };
      });
      return true;
    },
    [
      commitDoc,
      ensureDiagramView,
      expanded,
      flushUserGesture,
      setPendingStructuralTransitionIntent,
      structure.getChildren,
    ],
  );

  const getDirectParentChildren = useCallback(
    (rootId: string) => {
      const directChildren = structure.getChildren(rootId);
      return directChildren
        .filter((child) => structure.getChildren(child.id).length > 0)
        .map((child) => child.id);
    },
    [structure],
  );

  const getDescendantParentIds = useCallback(
    (rootId: string, includeRoot = false) => structure.getDescendantParentIds(rootId, includeRoot),
    [structure],
  );

  const expandAllDetailsWithin = useCallback(
    (rootId: string) => {
      const idsToExpand = getDescendantParentIds(rootId, true);
      if (idsToExpand.length === 0) return;
      const willChange = idsToExpand.some((id) => !expanded[id]);
      if (!willChange) return;
      flushUserGesture();
      setPendingStructuralTransitionIntent({
        direction: 'in',
        focus: { kind: 'local', rootId },
      });
      commitDoc((prev) => {
        const view = ensureDiagramView(prev.view);
        let nextNodesById = view.nodesById;
        let changed = false;
        for (const id of idsToExpand) {
          if (!getDiagramViewExpandedMap(view)[id]) {
            nextNodesById = setExpandedState(nextNodesById, id, true);
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          view: {
            ...view,
            nodesById: nextNodesById,
          },
        };
      });
    },
    [
      commitDoc,
      ensureDiagramView,
      expanded,
      flushUserGesture,
      getDescendantParentIds,
      setPendingStructuralTransitionIntent,
    ],
  );

  const collapseAllDetailsWithin = useCallback(
    (rootId: string) => {
      const idsToCollapse = getDescendantParentIds(rootId, true);
      if (idsToCollapse.length === 0) return;
      const willChange = idsToCollapse.some((id) => Boolean(expanded[id]));
      if (!willChange) return;
      flushUserGesture();
      setPendingStructuralTransitionIntent({
        direction: 'out',
        focus: { kind: 'local', rootId },
      });
      commitDoc((prev) => {
        const view = ensureDiagramView(prev.view);
        let nextNodesById = view.nodesById;
        let changed = false;
        for (const id of idsToCollapse) {
          if (getDiagramViewExpandedMap(view)[id]) {
            nextNodesById = setExpandedState(nextNodesById, id, false);
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          view: {
            ...view,
            nodesById: nextNodesById,
          },
        };
      });
    },
    [
      commitDoc,
      ensureDiagramView,
      expanded,
      flushUserGesture,
      getDescendantParentIds,
      setPendingStructuralTransitionIntent,
    ],
  );

  const expandChildGroupsWithin = useCallback(
    (rootId: string) => {
      const parentChildren = getDirectParentChildren(rootId);
      if (
        !hasChildGroupControlRow({
          rootExpanded: Boolean(expanded[rootId]),
          directChildParentCount: parentChildren.length,
        })
      ) {
        return;
      }
      if (!hasExpandableDirectChildParents(parentChildren, expanded)) return;
      const willChange = parentChildren.some((id) => !expanded[id]);
      if (!willChange) return;
      flushUserGesture();
      setPendingStructuralTransitionIntent({
        direction: 'in',
        focus: { kind: 'local', rootId },
      });
      commitDoc((prev) => {
        const view = ensureDiagramView(prev.view);
        let nextNodesById = view.nodesById;
        let changed = false;
        for (const id of parentChildren) {
          if (!getDiagramViewExpandedMap(view)[id]) {
            nextNodesById = setExpandedState(nextNodesById, id, true);
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          view: {
            ...view,
            nodesById: nextNodesById,
          },
        };
      });
    },
    [
      commitDoc,
      ensureDiagramView,
      expanded,
      flushUserGesture,
      getDirectParentChildren,
      setPendingStructuralTransitionIntent,
    ],
  );

  const collapseChildGroupsWithin = useCallback(
    (rootId: string) => {
      const parentChildren = getDirectParentChildren(rootId);
      if (
        !hasChildGroupControlRow({
          rootExpanded: Boolean(expanded[rootId]),
          directChildParentCount: parentChildren.length,
        })
      ) {
        return;
      }
      if (!hasCollapsibleDirectChildParents(parentChildren, expanded)) return;
      const idsToCollapse = new Set<string>();
      for (const childParentId of parentChildren) {
        for (const id of getDescendantParentIds(childParentId, true)) {
          idsToCollapse.add(id);
        }
      }
      if (idsToCollapse.size === 0) return;
      const willChange = [...idsToCollapse].some((id) => Boolean(expanded[id]));
      if (!willChange) return;
      flushUserGesture();
      setPendingStructuralTransitionIntent({
        direction: 'out',
        focus: { kind: 'local', rootId },
      });
      commitDoc((prev) => {
        const view = ensureDiagramView(prev.view);
        let nextNodesById = view.nodesById;
        let changed = false;
        for (const id of idsToCollapse) {
          if (getDiagramViewExpandedMap(view)[id]) {
            nextNodesById = setExpandedState(nextNodesById, id, false);
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          view: {
            ...view,
            nodesById: nextNodesById,
          },
        };
      });
    },
    [
      ensureDiagramView,
      expanded,
      flushUserGesture,
      getDescendantParentIds,
      getDirectParentChildren,
      commitDoc,
      setPendingStructuralTransitionIntent,
    ],
  );

  return {
    centerScene,
    expandAll,
    collapseAll,
    triggerEntityZoom,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
  };
}
