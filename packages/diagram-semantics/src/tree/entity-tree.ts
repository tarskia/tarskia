import type { Entity, SemanticDocument } from '../model/types';
import { type CanonicalTree, indexTree } from './canonical-tree';

/**
 * Semantic tree ownership lives here rather than in canvas.
 * Rendering layers consume this hierarchy and adapt it into scene/layout nodes.
 */
export const ROOT_ID = '__root__';

export interface SemanticEntityNode {
  id: string;
  entity: Entity;
  parentId?: string;
  children: SemanticEntityNode[];
  hasChildren: boolean;
}

export type SemanticEntityTree = CanonicalTree<SemanticEntityNode>;

const ROOT_ENTITY: Entity = {
  id: ROOT_ID,
  type: 'semantic-root',
  name: 'Semantic Root',
};

export function buildEntityTree(doc: SemanticDocument): SemanticEntityTree {
  const byId = new Map<string, SemanticEntityNode>();
  const nestedParentById = new Map<string, string>();
  const rootNode: SemanticEntityNode = {
    id: ROOT_ID,
    entity: ROOT_ENTITY,
    children: [],
    hasChildren: true,
  };
  byId.set(ROOT_ID, rootNode);

  const visit = (entity: Entity, parentId?: string): SemanticEntityNode => {
    const existing = byId.get(entity.id);
    const node = existing ?? {
      id: entity.id,
      entity,
      parentId,
      children: [],
      hasChildren: false,
    };
    if (!existing) {
      byId.set(entity.id, node);
    } else {
      existing.entity = entity;
    }
    if (parentId && parentId !== ROOT_ID && !nestedParentById.has(entity.id)) {
      nestedParentById.set(entity.id, parentId);
    }
    for (const child of entity.children ?? []) {
      visit(child, entity.id);
    }
    return node;
  };

  for (const entity of doc.entities) {
    visit(entity);
  }

  for (const [id, node] of byId.entries()) {
    if (id === ROOT_ID) continue;
    node.children = [];
    node.parentId = undefined;
    node.hasChildren = false;
  }
  rootNode.children = [];
  rootNode.hasChildren = false;

  for (const [id, node] of byId.entries()) {
    if (id === ROOT_ID) continue;
    const parentId = nestedParentById.get(id) ?? node.entity.parent;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && parent.id !== id) {
      node.parentId = parent.id;
      parent.children.push(node);
      parent.hasChildren = true;
      continue;
    }
    node.parentId = ROOT_ID;
    rootNode.children.push(node);
    rootNode.hasChildren = true;
  }

  return indexTree({ rootId: ROOT_ID, byId });
}
