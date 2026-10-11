import { extractJsonResponse } from '../advanced/refinement-helpers';
import { type Entity, parseDocument, type Relation, type SemanticDocument } from '../semantic';
import { assertYamlInputSize } from '../untrusted-yaml';

export function renderGraphEditContract(): string[] {
  return [
    'Output requirements:',
    '- The semantic document contract describes the resulting graph; this stage returns edits using the JSON contract below.',
    '- Return a JSON edit object only, without markdown fences. Do not return the whole document.',
    '- Return {} if no changes are needed. Omitted fields preserve their existing values.',
    '- Shape: {"entityEdits": [{"id": "exact-existing-or-new-id", "type": "optional-type", "parent": "optional-parent-id", "description": "optional-description"}], "relationEdits": [{"id": "exact-existing-or-new-id", "from": "optional-endpoint", "to": "optional-endpoint", "type": "optional-relation-type"}], "removeEntityIds": [], "removeRelationIds": []}.',
    '- Edits merge fields into the item with that exact id. Never rename existing ids or copy existing items under different ids.',
    '- Entity edits may also include name, props, tags, removeDefaultTags, replaceDefaultTags, and provenance. Relation edits may also include label, description, state, props, tags, removeDefaultTags, replaceDefaultTags, and provenance.',
    '- Entity edits are flat: no children arrays. Omit parent to keep containment; use parent: null to move to the root. New entities require type; new relations require from and to.',
    '- Removing an entity requires explicitly removing or reparenting its children and repairing its incident relations in the same patch.',
    '- Keep version and schemaRefs unchanged. Use only ontology types and relation types from the active schema catalog.',
    '- Every new item must include canonical provenance.locations with input: primary and repo-relative path. Preserve existing provenance when it is unchanged.',
  ];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const entityKeys = new Set([
  'id',
  'type',
  'name',
  'description',
  'props',
  'provenance',
  'parent',
  'tags',
  'removeDefaultTags',
  'replaceDefaultTags',
]);
const relationKeys = new Set([
  'id',
  'type',
  'label',
  'description',
  'state',
  'from',
  'to',
  'props',
  'provenance',
  'tags',
  'removeDefaultTags',
  'replaceDefaultTags',
]);

/** Apply a small model-authored delta; unchanged graph payloads stay deterministic. */
export function applyGraphEditResponse(
  document: SemanticDocument,
  response: string,
): SemanticDocument {
  assertYamlInputSize(response);
  const patch: unknown = JSON.parse(extractJsonResponse(response));
  const keys = new Set(['entityEdits', 'relationEdits', 'removeEntityIds', 'removeRelationIds']);
  if (!record(patch) || Object.keys(patch).some((key) => !keys.has(key))) {
    throw new Error('Expected a graph edit object, not a full semantic document');
  }
  const entries = (key: string): unknown[] => {
    const value = patch[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
    return value;
  };
  const stringId = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Item id must be a non-empty string');
    }
    return value;
  };
  const removed = (key: string): Set<string> => new Set(entries(key).map(stringId));
  const removedEntities = removed('removeEntityIds');
  const removedRelations = removed('removeRelationIds');
  const entities = new Map<string, { entity: Entity; parent: string | null }>();
  const visit = (items: Entity[], parent: string | null) => {
    for (const item of items) {
      if (entities.has(item.id)) throw new Error(`Duplicate input entity ${item.id}`);
      const { children, ...entity } = item;
      entities.set(item.id, { entity, parent });
      visit(children ?? [], item.id);
    }
  };
  visit(document.entities, null);
  const relations = new Map(document.relations.map((item) => [item.id, item]));
  if (relations.size !== document.relations.length) throw new Error('Duplicate input relation');
  for (const id of removedEntities) {
    if (!entities.delete(id)) throw new Error(`Cannot remove unknown entity ${id}`);
  }
  for (const id of removedRelations) {
    if (!relations.delete(id)) throw new Error(`Cannot remove unknown relation ${id}`);
  }
  const edits = (key: string, allowed: Set<string>, removals: Set<string>) => {
    const seen = new Set<string>();
    return entries(key).map((value) => {
      if (!record(value) || Object.keys(value).some((field) => !allowed.has(field))) {
        throw new Error(`Invalid ${key} item fields`);
      }
      const id = stringId(value.id);
      if (seen.has(id) || removals.has(id)) throw new Error(`Conflicting edits for ${id}`);
      seen.add(id);
      return { ...value, id } as Record<string, unknown> & { id: string };
    });
  };
  for (const edit of edits('entityEdits', entityKeys, removedEntities)) {
    const previous = entities.get(edit.id);
    const { parent, ...fields } = edit;
    if (parent !== undefined && parent !== null) stringId(parent);
    const nextParent =
      parent === undefined ? (previous?.parent ?? null) : parent === null ? null : stringId(parent);
    const entity = { ...previous?.entity, ...fields } as Entity;
    if (typeof entity.type !== 'string' || !entity.type.trim()) {
      throw new Error(`Entity ${edit.id} requires type`);
    }
    if (parent !== undefined) {
      if (parent === null) delete entity.parent;
      else entity.parent = nextParent!;
    }
    entities.set(edit.id, { entity, parent: nextParent });
  }
  for (const edit of edits('relationEdits', relationKeys, removedRelations)) {
    const relation = { ...relations.get(edit.id), ...edit } as Relation;
    stringId(relation.from);
    stringId(relation.to);
    relations.set(edit.id, relation);
  }
  const rebuilt = new Map(
    [...entities].map(([id, { entity }]) => [id, { ...entity, children: [] as Entity[] }]),
  );
  const roots: Entity[] = [];
  for (const [id, item] of entities) {
    const ancestors = new Set([id]);
    let parent = item.parent;
    while (parent !== null) {
      if (ancestors.has(parent) || !entities.has(parent)) {
        throw new Error(`Missing or cyclic parent for ${id}`);
      }
      ancestors.add(parent);
      parent = entities.get(parent)!.parent;
    }
    const entity = rebuilt.get(id)!;
    if (item.parent === null) roots.push(entity);
    else rebuilt.get(item.parent)!.children.push(entity);
  }
  // Structural validation is still required; schema/provenance/flow validation follows in the stage.
  return parseDocument(
    JSON.stringify({ ...document, entities: roots, relations: [...relations.values()] }),
  );
}
