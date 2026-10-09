import { buildEntityIndex, type EntityIndex } from '../model/entity-tree';
import { CORE_CONTAINS_RELATION_ID } from '../model/schema-ids';
import type { Entity, Relation, SchemaModule, SemanticDocument } from '../model/types';
import { buildEntityTree, type SemanticEntityTree } from '../tree/entity-tree';
import { resolveRelationDisplayLabel } from './display-labels';

export type DiagramContent = Omit<SemanticDocument, 'view'>;

/** Map-compatible read access; normal mutation methods reject writes after construction. */
export class ImmutableMap<K, V> extends Map<K, V> {
  #locked = false;
  constructor(entries: Iterable<readonly [K, V]>) {
    super();
    for (const [key, value] of entries) super.set(key, value);
    this.#locked = true;
    Object.freeze(this);
  }
  set(key: K, value: V): this {
    if (this.#locked) throw new TypeError('Cannot mutate a semantic index');
    return super.set(key, value);
  }
  delete(_key: K): boolean {
    throw new TypeError('Cannot mutate a semantic index');
  }
  clear(): void {
    throw new TypeError('Cannot mutate a semantic index');
  }
}

export interface SemanticNodeMetadata {
  readonly hasDiagramChildren: boolean;
  readonly isListContainer: boolean;
  readonly diagramChildCount: number;
  readonly diagramChildTypeCounts: Record<string, number>;
}

/** Content and schema are immutable inputs: replace their identities when editing them. */
export interface SemanticIndex {
  readonly content: DiagramContent;
  readonly schema: SchemaModule;
  readonly entityIndex: EntityIndex;
  readonly tree: SemanticEntityTree;
  readonly entities: readonly Entity[];
  readonly typeById: ReadonlyMap<string, SchemaModule['types'][number]>;
  readonly relationTypeById: ReadonlyMap<string, SchemaModule['relations'][number]>;
  readonly relationDisplayById: ReadonlyMap<string, string | undefined>;
  readonly renderableRelations: Relation[];
  readonly nodeMetadata: ReadonlyMap<string, SemanticNodeMetadata>;
}

const indexes = new WeakMap<SchemaModule, WeakMap<Entity[], SemanticIndex[]>>();
const contentEntries = (content: DiagramContent) =>
  Object.entries(content).filter(([key]) => key !== 'view');
const sameContent = (left: DiagramContent, right: DiagramContent) => {
  const entries = contentEntries(left);
  const other = contentEntries(right);
  return (
    entries.length === other.length &&
    entries.every(([key, value]) =>
      Object.is(value, (right as unknown as Record<string, unknown>)[key]),
    )
  );
};

export function buildSemanticIndex(content: DiagramContent, schema: SchemaModule): SemanticIndex {
  let byEntities = indexes.get(schema);
  if (!byEntities) {
    byEntities = new WeakMap();
    indexes.set(schema, byEntities);
  }
  const candidates = byEntities.get(content.entities) ?? [];
  const cached = candidates.find((index) => sameContent(index.content, content));
  if (cached) return cached;
  // Strip an extra view field from legacy document callers without retaining their camera state.
  const stableContent = Object.freeze(
    Object.fromEntries(contentEntries(content)),
  ) as DiagramContent;
  const tree = buildEntityTree(stableContent);
  const rawEntityIndex = buildEntityIndex(content.entities);
  for (const entry of rawEntityIndex.entries) Object.freeze(entry);
  for (const children of rawEntityIndex.childrenByParent.values()) Object.freeze(children);
  Object.freeze(rawEntityIndex.entries);
  const entityIndex = Object.freeze({
    entries: rawEntityIndex.entries,
    byId: new ImmutableMap(rawEntityIndex.byId),
    parentById: new ImmutableMap(rawEntityIndex.parentById),
    childrenByParent: new ImmutableMap(rawEntityIndex.childrenByParent),
  });
  const relationTypeById = new ImmutableMap(
    schema.relations.map((relation) => [relation.id, relation] as const),
  );
  const renderableRelations = content.relations.filter(
    (relation) => relation.type !== CORE_CONTAINS_RELATION_ID,
  );
  const relationDisplayById = new ImmutableMap(
    renderableRelations.map(
      (relation) => [relation.id, resolveRelationDisplayLabel(relation, relationTypeById)] as const,
    ),
  );
  const nodeMetadata = new Map<string, SemanticNodeMetadata>();
  for (const node of tree.byId.values()) {
    const childIds = new Set(node.children.map((child) => child.id));
    const counts: Record<string, number> = {};
    for (const child of node.children)
      counts[child.entity.type] = (counts[child.entity.type] ?? 0) + 1;
    nodeMetadata.set(
      node.id,
      Object.freeze({
        hasDiagramChildren: node.hasChildren,
        isListContainer:
          node.id !== tree.rootId &&
          node.children.length > 1 &&
          node.children.every((child) => !child.hasChildren) &&
          !renderableRelations.some(
            (relation) =>
              relation.from !== relation.to &&
              childIds.has(relation.from) &&
              childIds.has(relation.to),
          ),
        diagramChildCount: node.children.length,
        diagramChildTypeCounts: Object.freeze(counts),
      }),
    );
    Object.freeze(node.children);
    Object.freeze(node);
  }
  tree.byId = new ImmutableMap(tree.byId);
  tree.childrenByParent = new ImmutableMap(tree.childrenByParent);
  Object.freeze(tree);
  Object.freeze(renderableRelations);
  const index: SemanticIndex = Object.freeze({
    content: stableContent,
    schema,
    entityIndex,
    tree,
    entities: Object.freeze(rawEntityIndex.entries.map((entry) => entry.entity)),
    typeById: new ImmutableMap(schema.types.map((type) => [type.id, type] as const)),
    relationTypeById,
    relationDisplayById,
    renderableRelations,
    nodeMetadata: new ImmutableMap(nodeMetadata),
  });
  // Bound variants sharing one entity array (e.g. relation edits) without retaining old documents.
  byEntities.set(content.entities, [index, ...candidates].slice(0, 8));
  return index;
}
