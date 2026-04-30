import { useCallback } from 'react';

import type { CanonicalDiagramStructureQueries } from '../canvas/structure/queries';
import type {
  NavigationIntent,
  NavigationRequestResult,
  StructuralTransitionIntent,
} from '../diagram/motion-types';
import {
  addEntityToDocument,
  buildEntityIndex,
  type DiagramViewNodeState,
  duplicateEntityInDocument,
  type Entity,
  type EntityIndex,
  getDiagramViewExpandedMap,
  hasChildGroupControlRow,
  hasCollapsibleDirectChildParents,
  hasExpandableDirectChildParents,
  insertSiblingEntityInDocument,
  moveEntityInDocument,
  normalizeTagList,
  removeEntitiesFromDocument,
  removeEntityPropInDocument,
  type SemanticDocument,
  setEntityPropInDocument,
  updateEntityNameInDocument,
  updateEntityTagsInDocument,
} from '../semantic';
import { createId } from '../util/id';
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

interface UseShellDiagramActionsArgs {
  state: {
    doc: SemanticDocument;
    expanded: Record<string, boolean>;
    entityIndex: EntityIndex;
  };
  document: {
    commitDoc: CommitDoc;
    ensureDiagramView: EnsureDiagramView;
  };
  transition: {
    requestNavigation: (intent: NavigationIntent) => NavigationRequestResult;
    cancelTransitions: () => void;
    setPendingStructuralTransitionIntent: (intent: StructuralTransitionIntent | null) => void;
    flushUserGesture: () => boolean;
  };
  selection: {
    setSelectedEntity: (id: string | undefined) => void;
    setSelectedEdge: (id: string | undefined) => void;
  };
  rules: {
    canContainEntity: (parent: Entity, childType: string) => boolean;
    resolveDefaultEntityName: (
      typeId: string,
      requestedName: string | undefined,
      existingCount: number,
    ) => string | undefined;
  };
  sceneQueries: {
    structure: CanonicalDiagramStructureQueries;
  };
}

export function useShellDiagramActions({
  state,
  document,
  transition,
  selection,
  rules,
  sceneQueries,
}: UseShellDiagramActionsArgs) {
  const { doc, expanded, entityIndex } = state;
  const { commitDoc, ensureDiagramView } = document;
  const {
    requestNavigation,
    cancelTransitions,
    setPendingStructuralTransitionIntent,
    flushUserGesture,
  } = transition;
  const { setSelectedEntity, setSelectedEdge } = selection;
  const { canContainEntity, resolveDefaultEntityName } = rules;
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
    commitDoc(
      (prev) => {
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
      },
      { undoable: false },
    );
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
    commitDoc(
      (prev) => {
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
      },
      { undoable: false },
    );
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
      commitDoc(
        (prev) => {
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
        },
        { undoable: false },
      );
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

  const addEntity = useCallback(
    (typeId: string, parentId?: string, name?: string) => {
      let createdEntityId = '';
      commitDoc((prev) => {
        const result = addEntityToDocument({
          doc: prev,
          typeId,
          parentId,
          name,
          createEntityId: createId,
          resolveEntityName: resolveDefaultEntityName,
          canContainEntity,
        });
        createdEntityId = result.createdEntityId;
        return result.doc;
      });
      if (createdEntityId && parentId) {
        triggerEntityZoom(parentId, 'in');
      }
      return createdEntityId;
    },
    [canContainEntity, commitDoc, resolveDefaultEntityName, triggerEntityZoom],
  );

  const createInspectorChild = useCallback(
    (parentId: string, typeId: string, name?: string) => {
      const parent = entityIndex.byId.get(parentId);
      if (!parent || !canContainEntity(parent, typeId)) return;
      const id = addEntity(typeId, parentId, name);
      setSelectedEntity(id);
      setSelectedEdge(undefined);
    },
    [addEntity, canContainEntity, entityIndex.byId, setSelectedEdge, setSelectedEntity],
  );

  const createInspectorSibling = useCallback(
    (siblingId: string, typeId: string, name?: string) => {
      const sibling = entityIndex.byId.get(siblingId);
      if (!sibling) return;
      const parentId = entityIndex.parentById.get(siblingId);
      if (parentId) {
        const parent = entityIndex.byId.get(parentId);
        if (!parent || !canContainEntity(parent, typeId)) return;
      }
      let createdEntityId = '';
      commitDoc((prev) => {
        const result = insertSiblingEntityInDocument({
          doc: prev,
          siblingId,
          typeId,
          name,
          createEntityId: createId,
          resolveEntityName: resolveDefaultEntityName,
        });
        createdEntityId = result.createdEntityId;
        return result.doc;
      });
      setSelectedEntity(createdEntityId);
      setSelectedEdge(undefined);
    },
    [
      canContainEntity,
      commitDoc,
      entityIndex.byId,
      entityIndex.parentById,
      resolveDefaultEntityName,
      setSelectedEdge,
      setSelectedEntity,
    ],
  );

  const duplicateEntity = useCallback(
    (id: string) => {
      let duplicatedId: string | undefined;
      commitDoc((prev) => {
        const result = duplicateEntityInDocument({
          doc: prev,
          entityId: id,
          createEntityId: createId,
        });
        duplicatedId = result.duplicatedEntityId;
        return result.doc;
      });
      if (duplicatedId) {
        setSelectedEntity(duplicatedId);
        setSelectedEdge(undefined);
      }
    },
    [commitDoc, setSelectedEdge, setSelectedEntity],
  );

  const moveEntity = useCallback(
    (id: string, parentId?: string) => {
      if (parentId === id) return;
      const entity = entityIndex.byId.get(id);
      if (!entity) return;
      const currentParentId = entityIndex.parentById.get(id);
      if ((currentParentId ?? undefined) === (parentId ?? undefined)) return;
      if (parentId) {
        const parent = entityIndex.byId.get(parentId);
        if (!parent || !canContainEntity(parent, entity.type)) return;
      }
      commitDoc((prev) => moveEntityInDocument(prev, id, parentId));
    },
    [canContainEntity, commitDoc, entityIndex.byId, entityIndex.parentById],
  );

  const setEntityProp = useCallback(
    (id: string, key: string, value: unknown) => {
      commitDoc((prev) => setEntityPropInDocument(prev, id, key, value));
    },
    [commitDoc],
  );

  const removeEntityProp = useCallback(
    (id: string, key: string) => {
      commitDoc((prev) => removeEntityPropInDocument(prev, id, key));
    },
    [commitDoc],
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
      commitDoc(
        (prev) => {
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
        },
        { undoable: false },
      );
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
      commitDoc(
        (prev) => {
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
        },
        { undoable: false },
      );
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
      commitDoc(
        (prev) => {
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
        },
        { undoable: false },
      );
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
      commitDoc(
        (prev) => {
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
        },
        { undoable: false },
      );
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

  const updateEntityName = useCallback(
    (id: string, name: string) => {
      commitDoc((prev) => updateEntityNameInDocument(prev, id, name));
    },
    [commitDoc],
  );

  const updateEntityTags = useCallback(
    (id: string, tags: string[]) => {
      const normalized = normalizeTagList(tags);
      commitDoc((prev) =>
        updateEntityTagsInDocument(prev, id, normalized.length > 0 ? normalized : undefined),
      );
    },
    [commitDoc],
  );

  const deleteEntities = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const uniqueIds = Array.from(new Set(ids));
      cancelTransitions();
      commitDoc((prev) => removeEntitiesFromDocument(prev, uniqueIds));
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
    },
    [cancelTransitions, commitDoc, setSelectedEdge, setSelectedEntity],
  );

  const deleteEntity = useCallback(
    (id: string) => {
      deleteEntities([id]);
    },
    [deleteEntities],
  );

  return {
    centerScene,
    expandAll,
    collapseAll,
    triggerEntityZoom,
    addEntity,
    createInspectorChild,
    createInspectorSibling,
    duplicateEntity,
    moveEntity,
    setEntityProp,
    removeEntityProp,
    expandAllDetailsWithin,
    collapseAllDetailsWithin,
    expandChildGroupsWithin,
    collapseChildGroupsWithin,
    updateEntityName,
    updateEntityTags,
    deleteEntities,
    deleteEntity,
  };
}
