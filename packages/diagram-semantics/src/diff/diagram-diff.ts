import { type Diagnostic, diagramDiagnostic, sortDiagnostics } from '../model/diagnostics';
import { FREEFORM_RELATION_TYPE, getSchemaObjectLocalId } from '../model/schema-ids';
import type { Entity, Relation, SchemaModule, SemanticDocument } from '../model/types';
import { type CanonicalTree, getChildren } from '../tree/canonical-tree';
import { buildEntityTree, ROOT_ID, type SemanticEntityNode } from '../tree/entity-tree';
import type { ValidationResult } from '../validation/types';
import { buildCompiledDiagramEdgeId } from '../view/compile-diagram-view-tree';

export type SemanticDiagramDiffChange = 'added' | 'removed' | 'changed' | 'unchanged';
export type SemanticDiagramDiffSide = 'before' | 'after' | 'merged';

export type SemanticDiagramEntityChangedField = 'name' | 'type' | 'parent' | 'tags' | 'props';
export type SemanticDiagramRelationChangedField =
  | 'type'
  | 'label'
  | 'state'
  | 'tags'
  | 'from'
  | 'to'
  | 'props';

export interface SemanticDiagramEntityDiff {
  entityId: string;
  change: SemanticDiagramDiffChange;
  before?: Entity;
  after?: Entity;
  changedFields: SemanticDiagramEntityChangedField[];
}

export interface SemanticDiagramRelationDiff {
  relationId: string;
  change: SemanticDiagramDiffChange;
  before?: Relation;
  after?: Relation;
  changedFields: SemanticDiagramRelationChangedField[];
}

export interface SemanticDiagramDiff {
  kind: 'semantic-diagram-diff';
  version: 1;
  entities: SemanticDiagramEntityDiff[];
  relations: SemanticDiagramRelationDiff[];
}

export interface SemanticDiagramDiffNode {
  id: string;
  entity: Entity;
  before?: Entity;
  after?: Entity;
  parentId?: string;
  children: SemanticDiagramDiffNode[];
  hasDiagramChildren: boolean;
  diff: {
    side: SemanticDiagramDiffSide;
    change: SemanticDiagramDiffChange;
    changedFields: SemanticDiagramEntityChangedField[];
    tombstone: boolean;
  };
}

export interface SemanticDiagramDiffEdge {
  id: string;
  relationId: string;
  sourceId: string;
  targetId: string;
  type?: string;
  label?: string;
  state?: 'undecided' | 'none';
  relation: Relation;
  before?: Relation;
  after?: Relation;
  diff: {
    side: SemanticDiagramDiffSide;
    change: SemanticDiagramDiffChange;
    changedFields: SemanticDiagramRelationChangedField[];
  };
}

export interface SemanticDiagramDiffUnion {
  tree: CanonicalTree<SemanticDiagramDiffNode>;
  edges: SemanticDiagramDiffEdge[];
  pointsOfInterest: {
    nodeIds: string[];
    edgeIds: string[];
  };
  diff: SemanticDiagramDiff;
}

export interface DiffSemanticDiagramDocumentsParams {
  before: SemanticDocument;
  after: SemanticDocument;
}

export interface CompileSemanticDiagramDiffUnionParams {
  before: SemanticDocument;
  after?: SemanticDocument;
  schema?: SchemaModule;
  diff?: SemanticDiagramDiff;
}

export interface EvolveSemanticDiagramDiffUnionParams {
  before: SemanticDocument;
  diff: SemanticDiagramDiff;
  schema?: SchemaModule;
}

const ENTITY_FIELD_ORDER: SemanticDiagramEntityChangedField[] = [
  'name',
  'type',
  'parent',
  'tags',
  'props',
];

const RELATION_FIELD_ORDER: SemanticDiagramRelationChangedField[] = [
  'type',
  'label',
  'state',
  'tags',
  'from',
  'to',
  'props',
];

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
};

const normalizeStringArray = (values?: string[]): string[] | undefined => {
  if (!values || values.length === 0) return undefined;
  return [...values].sort((left, right) => left.localeCompare(right));
};

const normalizeParentId = (parentId?: string) =>
  parentId && parentId !== ROOT_ID ? parentId : undefined;

const normalizeEntitySnapshot = (node?: SemanticEntityNode): Entity | undefined => {
  if (!node) return undefined;
  const { children: _children, provenance: _provenance, ...entity } = node.entity;
  const snapshot: Entity = { ...entity };
  const parentId = normalizeParentId(node.parentId);
  if (parentId) {
    snapshot.parent = parentId;
  } else {
    delete snapshot.parent;
  }
  return snapshot;
};

const normalizeRelationSnapshot = (relation?: Relation): Relation | undefined => {
  if (!relation) return undefined;
  const { provenance: _provenance, ...snapshot } = relation;
  return { ...snapshot };
};

const tagFieldKey = (
  subject?:
    | Pick<Entity, 'tags' | 'removeDefaultTags' | 'replaceDefaultTags'>
    | Pick<Relation, 'tags' | 'removeDefaultTags' | 'replaceDefaultTags'>,
) => {
  if (!subject) return undefined;
  return stableSerialize({
    tags: normalizeStringArray(subject.tags),
    removeDefaultTags: normalizeStringArray(subject.removeDefaultTags),
    replaceDefaultTags: subject.replaceDefaultTags === true ? true : undefined,
  });
};

const propsKey = (props?: Record<string, unknown>) => stableSerialize(props);

const compareOrderedFields = <T extends string>(left: T[], right: T[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const collectEntityChangedFields = (
  before: Entity,
  after: Entity,
): SemanticDiagramEntityChangedField[] =>
  ENTITY_FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'name':
        return before.name !== after.name;
      case 'type':
        return before.type !== after.type;
      case 'parent':
        return before.parent !== after.parent;
      case 'tags':
        return tagFieldKey(before) !== tagFieldKey(after);
      case 'props':
        return propsKey(before.props) !== propsKey(after.props);
      default:
        return false;
    }
  });

const collectRelationChangedFields = (
  before: Relation,
  after: Relation,
): SemanticDiagramRelationChangedField[] =>
  RELATION_FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'type':
        return before.type !== after.type;
      case 'label':
        return before.label !== after.label;
      case 'state':
        return before.state !== after.state;
      case 'tags':
        return tagFieldKey(before) !== tagFieldKey(after);
      case 'from':
        return before.from !== after.from;
      case 'to':
        return before.to !== after.to;
      case 'props':
        return propsKey(before.props) !== propsKey(after.props);
      default:
        return false;
    }
  });

const normalizeEntityChangedFields = (fields: SemanticDiagramEntityChangedField[]) =>
  ENTITY_FIELD_ORDER.filter((field) => fields.includes(field));

const normalizeRelationChangedFields = (fields: SemanticDiagramRelationChangedField[]) =>
  RELATION_FIELD_ORDER.filter((field) => fields.includes(field));

const buildEntityDiff = (
  entityId: string,
  beforeNode?: SemanticEntityNode,
  afterNode?: SemanticEntityNode,
): SemanticDiagramEntityDiff => {
  const before = normalizeEntitySnapshot(beforeNode);
  const after = normalizeEntitySnapshot(afterNode);
  if (!before && !after) {
    throw new Error(`Entity "${entityId}" not found in either document`);
  }
  if (!before) {
    return {
      entityId,
      change: 'added',
      after,
      changedFields: [],
    };
  }
  if (!after) {
    return {
      entityId,
      change: 'removed',
      before,
      changedFields: [],
    };
  }

  const changedFields = collectEntityChangedFields(before, after);

  return {
    entityId,
    change: changedFields.length > 0 ? 'changed' : 'unchanged',
    before,
    after,
    changedFields,
  };
};

const buildRelationDiff = (
  relationId: string,
  beforeRelation?: Relation,
  afterRelation?: Relation,
): SemanticDiagramRelationDiff => {
  const before = normalizeRelationSnapshot(beforeRelation);
  const after = normalizeRelationSnapshot(afterRelation);
  if (!before && !after) {
    throw new Error(`Relation "${relationId}" not found in either document`);
  }
  if (!before) {
    return {
      relationId,
      change: 'added',
      after,
      changedFields: [],
    };
  }
  if (!after) {
    return {
      relationId,
      change: 'removed',
      before,
      changedFields: [],
    };
  }

  const changedFields = collectRelationChangedFields(before, after);

  return {
    relationId,
    change: changedFields.length > 0 ? 'changed' : 'unchanged',
    before,
    after,
    changedFields,
  };
};

const sortStrings = (values: Iterable<string>) =>
  [...values].sort((left, right) => left.localeCompare(right));

export function diffSemanticDiagramDocuments(
  params: DiffSemanticDiagramDocumentsParams,
): SemanticDiagramDiff {
  const { before, after } = params;
  const beforeTree = buildEntityTree(before);
  const afterTree = buildEntityTree(after);

  const entityIds = sortStrings(
    new Set([
      ...[...beforeTree.byId.keys()].filter((id) => id !== beforeTree.rootId),
      ...[...afterTree.byId.keys()].filter((id) => id !== afterTree.rootId),
    ]),
  );
  const relationIds = sortStrings(
    new Set([
      ...before.relations.map((relation) => relation.id),
      ...after.relations.map((relation) => relation.id),
    ]),
  );
  const beforeRelationById = new Map(before.relations.map((relation) => [relation.id, relation]));
  const afterRelationById = new Map(after.relations.map((relation) => [relation.id, relation]));

  return {
    kind: 'semantic-diagram-diff',
    version: 1,
    entities: entityIds.map((entityId) =>
      buildEntityDiff(entityId, beforeTree.byId.get(entityId), afterTree.byId.get(entityId)),
    ),
    relations: relationIds.map((relationId) =>
      buildRelationDiff(
        relationId,
        beforeRelationById.get(relationId),
        afterRelationById.get(relationId),
      ),
    ),
  };
}

const buildSideNodeId = (side: Exclude<SemanticDiagramDiffSide, 'merged'>, entityId: string) =>
  `${side}:${entityId}`;

const buildSemanticDiagramDiffEdgeId = (
  side: SemanticDiagramDiffSide,
  relationId: string,
  sourceId: string,
  targetId: string,
) =>
  side === 'merged'
    ? buildCompiledDiagramEdgeId(relationId, sourceId, targetId)
    : `${side}:${relationId}:${sourceId}->${targetId}`;

const resolveRelationDisplayLabel = (
  relation: Relation,
  relationTypeById?: Map<string, SchemaModule['relations'][number]>,
) => {
  if (!relation.type) {
    return relation.label;
  }
  if (relation.type === FREEFORM_RELATION_TYPE) {
    return relation.label ?? FREEFORM_RELATION_TYPE;
  }
  const relationType = relationTypeById?.get(relation.type);
  return (
    relation.label ??
    relationType?.shortLabel ??
    relationType?.label ??
    getSchemaObjectLocalId(relation.type)
  );
};

const orderMergedChildren = (
  beforeChildren: SemanticEntityNode[],
  afterChildren: SemanticEntityNode[],
): string[] => {
  const beforeIds = beforeChildren.map((child) => child.id);
  const afterIds = afterChildren.map((child) => child.id);
  const afterIdSet = new Set(afterIds);
  const orderedIds = [...afterIds];

  for (let index = 0; index < beforeIds.length; index += 1) {
    const beforeId = beforeIds[index];
    if (!beforeId || afterIdSet.has(beforeId)) continue;

    let anchorId: string | undefined;
    for (let anchorIndex = index + 1; anchorIndex < beforeIds.length; anchorIndex += 1) {
      const candidateId = beforeIds[anchorIndex];
      if (candidateId && orderedIds.includes(candidateId)) {
        anchorId = candidateId;
        break;
      }
    }

    if (!anchorId) {
      orderedIds.push(beforeId);
      continue;
    }

    const insertAt = orderedIds.indexOf(anchorId);
    orderedIds.splice(insertAt, 0, beforeId);
  }

  return orderedIds;
};

const buildRelationState = (relation: Relation) =>
  relation.state ?? (relation.type ? undefined : 'undecided');

const getRequired = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

const assertValidDiffResult = <T>(result: ValidationResult<T>): T => {
  if (result.ok && result.value !== undefined) {
    return result.value;
  }
  const message =
    result.diagnostics.map((diagnostic) => diagnostic.message).join('\n') ||
    'Invalid semantic diagram diff';
  throw new Error(message);
};

const buildDiffDiagnostic = (
  code: string,
  message: string,
  options?: {
    phase?: Diagnostic['phase'];
    path?: string;
    entityId?: string;
    relationId?: string;
  },
): Diagnostic =>
  diagramDiagnostic({
    phase: options?.phase ?? 'semantic',
    severity: 'error',
    code,
    message,
    path: options?.path,
    entityId: options?.entityId,
    relationId: options?.relationId,
  });

const materializeAfterDocumentFromDiff = (
  before: SemanticDocument,
  diff: SemanticDiagramDiff,
): SemanticDocument => {
  const entityDiffById = new Map(diff.entities.map((entry) => [entry.entityId, entry]));
  const relationDiffById = new Map(diff.relations.map((entry) => [entry.relationId, entry]));

  const entities: Entity[] = [];
  const seenAddedEntityIds = new Set<string>();
  for (const entity of before.entities) {
    const entry = entityDiffById.get(entity.id);
    if (!entry || entry.change === 'unchanged') {
      entities.push({ ...entity });
      continue;
    }
    if (entry.change === 'removed') {
      continue;
    }
    entities.push({
      ...getRequired(entry.after, `Missing after snapshot for entity "${entry.entityId}"`),
    });
    seenAddedEntityIds.add(entry.entityId);
  }
  for (const entry of diff.entities) {
    if (entry.change !== 'added' || seenAddedEntityIds.has(entry.entityId)) continue;
    entities.push({
      ...getRequired(entry.after, `Missing after snapshot for entity "${entry.entityId}"`),
    });
  }

  const relations: Relation[] = [];
  const seenAddedRelationIds = new Set<string>();
  for (const relation of before.relations) {
    const entry = relationDiffById.get(relation.id);
    if (!entry || entry.change === 'unchanged') {
      relations.push({ ...relation });
      continue;
    }
    if (entry.change === 'removed') {
      continue;
    }
    relations.push({
      ...getRequired(entry.after, `Missing after snapshot for relation "${entry.relationId}"`),
    });
    seenAddedRelationIds.add(entry.relationId);
  }
  for (const entry of diff.relations) {
    if (entry.change !== 'added' || seenAddedRelationIds.has(entry.relationId)) continue;
    relations.push({
      ...getRequired(entry.after, `Missing after snapshot for relation "${entry.relationId}"`),
    });
  }

  return {
    ...before,
    entities,
    relations,
  };
};

const validateEntityDiffAgainstBefore = (
  entry: SemanticDiagramEntityDiff,
  beforeEntityById: Map<string, Entity>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const beforeSnapshot = beforeEntityById.get(entry.entityId);
  switch (entry.change) {
    case 'added':
      if (beforeSnapshot) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_entity_exists',
            `Added entity "${entry.entityId}" already exists in the before document.`,
            { entityId: entry.entityId },
          ),
        );
      }
      break;
    case 'removed':
    case 'changed':
    case 'unchanged': {
      if (!beforeSnapshot) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_entity_missing',
            `Entity "${entry.entityId}" does not exist in the before document.`,
            { entityId: entry.entityId },
          ),
        );
        return diagnostics;
      }
      if (!entry.before) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.invalid_change_shape',
            `Entity "${entry.entityId}" is missing its before snapshot.`,
            { entityId: entry.entityId },
          ),
        );
        return diagnostics;
      }
      if (stableSerialize(beforeSnapshot) !== stableSerialize(entry.before)) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_snapshot_mismatch',
            `Entity "${entry.entityId}" before snapshot does not match the before document.`,
            { entityId: entry.entityId },
          ),
        );
      }
      if (entry.change === 'changed' && entry.after) {
        const actual = collectEntityChangedFields(entry.before, entry.after);
        if (!compareOrderedFields(actual, normalizeEntityChangedFields(entry.changedFields))) {
          diagnostics.push(
            buildDiffDiagnostic(
              'diagram.diff.invalid_changed_fields',
              `Entity "${entry.entityId}" changedFields do not match the provided snapshots.`,
              { entityId: entry.entityId },
            ),
          );
        }
      }
      break;
    }
    default:
      break;
  }

  return diagnostics;
};

const validateRelationDiffAgainstBefore = (
  entry: SemanticDiagramRelationDiff,
  beforeRelationById: Map<string, Relation>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const beforeSnapshot = beforeRelationById.get(entry.relationId);
  switch (entry.change) {
    case 'added':
      if (beforeSnapshot) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_relation_exists',
            `Added relation "${entry.relationId}" already exists in the before document.`,
            { relationId: entry.relationId },
          ),
        );
      }
      break;
    case 'removed':
    case 'changed':
    case 'unchanged': {
      if (!beforeSnapshot) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_relation_missing',
            `Relation "${entry.relationId}" does not exist in the before document.`,
            { relationId: entry.relationId },
          ),
        );
        return diagnostics;
      }
      if (!entry.before) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.invalid_change_shape',
            `Relation "${entry.relationId}" is missing its before snapshot.`,
            { relationId: entry.relationId },
          ),
        );
        return diagnostics;
      }
      if (stableSerialize(beforeSnapshot) !== stableSerialize(entry.before)) {
        diagnostics.push(
          buildDiffDiagnostic(
            'diagram.diff.before_snapshot_mismatch',
            `Relation "${entry.relationId}" before snapshot does not match the before document.`,
            { relationId: entry.relationId },
          ),
        );
      }
      if (entry.change === 'changed' && entry.after) {
        const actual = collectRelationChangedFields(entry.before, entry.after);
        if (!compareOrderedFields(actual, normalizeRelationChangedFields(entry.changedFields))) {
          diagnostics.push(
            buildDiffDiagnostic(
              'diagram.diff.invalid_changed_fields',
              `Relation "${entry.relationId}" changedFields do not match the provided snapshots.`,
              { relationId: entry.relationId },
            ),
          );
        }
      }
      break;
    }
    default:
      break;
  }

  return diagnostics;
};

const detectEntityParentCycles = (entities: Entity[]): string[] => {
  const parentById = new Map(
    entities.map((entity) => [entity.id, entity.parent] as const).filter(([, parent]) => parent),
  );
  const cycleIds = new Set<string>();
  for (const entity of entities) {
    const visiting = new Set<string>();
    let currentId: string | undefined = entity.id;
    while (currentId) {
      if (visiting.has(currentId)) {
        for (const id of visiting) {
          cycleIds.add(id);
        }
        break;
      }
      visiting.add(currentId);
      currentId = parentById.get(currentId);
    }
  }
  return [...cycleIds].sort((left, right) => left.localeCompare(right));
};

const validateMaterializedAfterDocument = (after: SemanticDocument): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const afterEntityIds = new Set(after.entities.map((entity) => entity.id));
  for (const entity of after.entities) {
    if (!entity.parent) continue;
    if (entity.parent === entity.id) {
      diagnostics.push(
        buildDiffDiagnostic(
          'diagram.diff.invalid_parent_reference',
          `Entity "${entity.id}" cannot parent itself in the evolved diagram.`,
          { entityId: entity.id },
        ),
      );
      continue;
    }
    if (!afterEntityIds.has(entity.parent)) {
      diagnostics.push(
        buildDiffDiagnostic(
          'diagram.diff.invalid_parent_reference',
          `Entity "${entity.id}" references missing parent "${entity.parent}" in the evolved diagram.`,
          { entityId: entity.id },
        ),
      );
    }
  }
  for (const entityId of detectEntityParentCycles(after.entities)) {
    diagnostics.push(
      buildDiffDiagnostic(
        'diagram.diff.invalid_parent_cycle',
        `Entity "${entityId}" participates in a parent cycle in the evolved diagram.`,
        { entityId },
      ),
    );
  }

  for (const relation of after.relations) {
    if (!afterEntityIds.has(relation.from)) {
      diagnostics.push(
        buildDiffDiagnostic(
          'diagram.diff.invalid_relation_endpoint',
          `Relation "${relation.id}" references missing source entity "${relation.from}" in the evolved diagram.`,
          { relationId: relation.id },
        ),
      );
    }
    if (!afterEntityIds.has(relation.to)) {
      diagnostics.push(
        buildDiffDiagnostic(
          'diagram.diff.invalid_relation_endpoint',
          `Relation "${relation.id}" references missing target entity "${relation.to}" in the evolved diagram.`,
          { relationId: relation.id },
        ),
      );
    }
  }

  return diagnostics;
};

const validateSemanticDiagramDiffAgainstBefore = (params: {
  before: SemanticDocument;
  diff: SemanticDiagramDiff;
}): ValidationResult<SemanticDiagramDiff> => {
  const { before, diff } = params;
  const beforeTree = buildEntityTree(before);
  const beforeEntityById = new Map(
    [...beforeTree.byId.values()]
      .filter((node) => node.id !== beforeTree.rootId)
      .map((node) => [node.id, normalizeEntitySnapshot(node)] as const),
  );
  const beforeRelationById = new Map(
    before.relations.map((relation) => [relation.id, normalizeRelationSnapshot(relation)] as const),
  );

  const diagnostics = [
    ...diff.entities.flatMap((entry) => validateEntityDiffAgainstBefore(entry, beforeEntityById)),
    ...diff.relations.flatMap((entry) =>
      validateRelationDiffAgainstBefore(entry, beforeRelationById),
    ),
  ];

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const after = materializeAfterDocumentFromDiff(before, diff);
  const afterDiagnostics = validateMaterializedAfterDocument(after);
  if (afterDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(afterDiagnostics),
    };
  }

  return {
    ok: true,
    value: diff,
    diagnostics: [],
  };
};

const compileSemanticDiagramDiffUnionFromDocuments = (params: {
  before: SemanticDocument;
  after: SemanticDocument;
  schema?: SchemaModule;
  diff: SemanticDiagramDiff;
}): SemanticDiagramDiffUnion => {
  const { before, after, schema, diff } = params;
  const beforeTree = buildEntityTree(before);
  const afterTree = buildEntityTree(after);
  const entityDiffById = new Map(diff.entities.map((entry) => [entry.entityId, entry]));
  const relationDiffById = new Map(diff.relations.map((entry) => [entry.relationId, entry]));
  const beforeEntitySnapshotById = new Map(
    [...beforeTree.byId.values()]
      .filter((node) => node.id !== beforeTree.rootId)
      .map((node) => [node.id, normalizeEntitySnapshot(node)] as const),
  );
  const afterEntitySnapshotById = new Map(
    [...afterTree.byId.values()]
      .filter((node) => node.id !== afterTree.rootId)
      .map((node) => [node.id, normalizeEntitySnapshot(node)] as const),
  );
  const beforeRelationSnapshotById = new Map(
    before.relations.map((relation) => [relation.id, normalizeRelationSnapshot(relation)] as const),
  );
  const afterRelationSnapshotById = new Map(
    after.relations.map((relation) => [relation.id, normalizeRelationSnapshot(relation)] as const),
  );
  const relationTypeById = schema
    ? new Map(schema.relations.map((relation) => [relation.id, relation]))
    : undefined;

  const byId = new Map<string, SemanticDiagramDiffNode>();
  const beforeProjectedNodeIdByEntityId = new Map<string, string>([[ROOT_ID, ROOT_ID]]);
  const afterProjectedNodeIdByEntityId = new Map<string, string>([[ROOT_ID, ROOT_ID]]);

  const rootNode: SemanticDiagramDiffNode = {
    id: ROOT_ID,
    entity:
      normalizeEntitySnapshot(afterTree.root) ??
      getRequired(normalizeEntitySnapshot(beforeTree.root), 'Missing semantic root snapshot'),
    before: normalizeEntitySnapshot(beforeTree.root),
    after: normalizeEntitySnapshot(afterTree.root),
    children: [],
    hasDiagramChildren: true,
    diff: {
      side: 'merged',
      change: 'unchanged',
      changedFields: [],
      tombstone: false,
    },
  };
  byId.set(rootNode.id, rootNode);

  const cloneSideSubtree = (
    side: Exclude<SemanticDiagramDiffSide, 'merged'>,
    node: SemanticEntityNode,
    parentInstanceId: string,
  ): SemanticDiagramDiffNode => {
    const entityDiff = getRequired(
      entityDiffById.get(node.id),
      `Missing entity diff entry for "${node.id}"`,
    );
    const beforeSnapshot = beforeEntitySnapshotById.get(node.id);
    const afterSnapshot = afterEntitySnapshotById.get(node.id);
    const instanceId = buildSideNodeId(side, node.id);
    const entity =
      side === 'after'
        ? getRequired(afterSnapshot ?? beforeSnapshot, `Missing after snapshot for "${node.id}"`)
        : getRequired(beforeSnapshot ?? afterSnapshot, `Missing before snapshot for "${node.id}"`);
    const nextNode: SemanticDiagramDiffNode = {
      id: instanceId,
      entity,
      before: beforeSnapshot,
      after: afterSnapshot,
      parentId: parentInstanceId,
      children: [],
      hasDiagramChildren: node.hasChildren,
      diff: {
        side,
        change: entityDiff.change,
        changedFields: entityDiff.changedFields,
        tombstone: side === 'before',
      },
    };
    byId.set(nextNode.id, nextNode);
    if (side === 'before') {
      beforeProjectedNodeIdByEntityId.set(node.id, nextNode.id);
    } else {
      afterProjectedNodeIdByEntityId.set(node.id, nextNode.id);
    }

    const sideTree = side === 'before' ? beforeTree : afterTree;
    for (const child of getChildren(sideTree, node.id)) {
      nextNode.children.push(cloneSideSubtree(side, child, nextNode.id));
    }
    return nextNode;
  };

  const buildMergedChildren = (semanticParentId: string, parentInstanceId: string) => {
    const parentNode = getRequired(
      byId.get(parentInstanceId),
      `Missing parent instance "${parentInstanceId}"`,
    );
    const beforeChildren = getChildren(beforeTree, semanticParentId);
    const afterChildren = getChildren(afterTree, semanticParentId);
    const beforeChildById = new Map(beforeChildren.map((child) => [child.id, child]));
    const afterChildById = new Map(afterChildren.map((child) => [child.id, child]));

    for (const childId of orderMergedChildren(beforeChildren, afterChildren)) {
      const beforeChild = beforeChildById.get(childId);
      const afterChild = afterChildById.get(childId);
      if (beforeChild && afterChild) {
        const entityDiff = getRequired(
          entityDiffById.get(childId),
          `Missing entity diff entry for "${childId}"`,
        );
        const beforeSnapshot = beforeEntitySnapshotById.get(childId);
        const afterSnapshot = afterEntitySnapshotById.get(childId);
        const nextNode: SemanticDiagramDiffNode = {
          id: childId,
          entity: getRequired(
            afterSnapshot ?? beforeSnapshot,
            `Missing merged snapshot for "${childId}"`,
          ),
          before: beforeSnapshot,
          after: afterSnapshot,
          parentId: parentInstanceId,
          children: [],
          hasDiagramChildren: beforeChild.hasChildren || afterChild.hasChildren,
          diff: {
            side: 'merged',
            change: entityDiff.change,
            changedFields: entityDiff.changedFields,
            tombstone: false,
          },
        };
        byId.set(nextNode.id, nextNode);
        beforeProjectedNodeIdByEntityId.set(childId, nextNode.id);
        afterProjectedNodeIdByEntityId.set(childId, nextNode.id);
        parentNode.children.push(nextNode);
        buildMergedChildren(childId, nextNode.id);
        continue;
      }

      if (beforeChild) {
        parentNode.children.push(cloneSideSubtree('before', beforeChild, parentInstanceId));
      }
      if (afterChild) {
        parentNode.children.push(cloneSideSubtree('after', afterChild, parentInstanceId));
      }
    }

    parentNode.hasDiagramChildren = parentNode.children.length > 0 || parentNode.hasDiagramChildren;
  };

  buildMergedChildren(ROOT_ID, rootNode.id);

  const buildProjectedEdge = (
    side: Exclude<SemanticDiagramDiffSide, 'merged'>,
    relation: Relation,
  ): SemanticDiagramDiffEdge => {
    const relationDiff = getRequired(
      relationDiffById.get(relation.id),
      `Missing relation diff entry for "${relation.id}"`,
    );
    const sourceId = getRequired(
      side === 'before'
        ? beforeProjectedNodeIdByEntityId.get(relation.from)
        : afterProjectedNodeIdByEntityId.get(relation.from),
      `Missing ${side} projected node for relation "${relation.id}" source "${relation.from}"`,
    );
    const targetId = getRequired(
      side === 'before'
        ? beforeProjectedNodeIdByEntityId.get(relation.to)
        : afterProjectedNodeIdByEntityId.get(relation.to),
      `Missing ${side} projected node for relation "${relation.id}" target "${relation.to}"`,
    );
    const beforeSnapshot = beforeRelationSnapshotById.get(relation.id);
    const afterSnapshot = afterRelationSnapshotById.get(relation.id);
    const relationSnapshot =
      side === 'after'
        ? getRequired(
            afterSnapshot ?? beforeSnapshot,
            `Missing after relation snapshot for "${relation.id}"`,
          )
        : getRequired(
            beforeSnapshot ?? afterSnapshot,
            `Missing before relation snapshot for "${relation.id}"`,
          );
    return {
      id: buildSemanticDiagramDiffEdgeId(side, relation.id, sourceId, targetId),
      relationId: relation.id,
      sourceId,
      targetId,
      type: relation.type,
      label: resolveRelationDisplayLabel(relation, relationTypeById),
      state: buildRelationState(relation),
      relation: relationSnapshot,
      before: beforeSnapshot,
      after: afterSnapshot,
      diff: {
        side,
        change: relationDiff.change,
        changedFields: relationDiff.changedFields,
      },
    };
  };

  const edges = diff.relations.flatMap((relationDiff) => {
    const beforeRelation = relationDiff.before;
    const afterRelation = relationDiff.after;
    const beforeEdge = beforeRelation ? buildProjectedEdge('before', beforeRelation) : undefined;
    const afterEdge = afterRelation ? buildProjectedEdge('after', afterRelation) : undefined;

    if (
      beforeEdge &&
      afterEdge &&
      beforeEdge.sourceId === afterEdge.sourceId &&
      beforeEdge.targetId === afterEdge.targetId
    ) {
      return [
        {
          id: buildSemanticDiagramDiffEdgeId(
            'merged',
            relationDiff.relationId,
            afterEdge.sourceId,
            afterEdge.targetId,
          ),
          relationId: relationDiff.relationId,
          sourceId: afterEdge.sourceId,
          targetId: afterEdge.targetId,
          type: afterEdge.type,
          label: afterEdge.label,
          state: afterEdge.state,
          relation: afterEdge.relation,
          before: beforeEdge.before,
          after: afterEdge.after,
          diff: {
            side: 'merged',
            change: relationDiff.change,
            changedFields: relationDiff.changedFields,
          },
        } satisfies SemanticDiagramDiffEdge,
      ];
    }

    return [beforeEdge, afterEdge].filter((edge): edge is SemanticDiagramDiffEdge => Boolean(edge));
  });

  edges.sort((left, right) => left.id.localeCompare(right.id));

  const nodeIds = sortStrings(
    [...byId.values()]
      .filter((node) => node.id !== ROOT_ID)
      .filter((node) => node.diff.side !== 'merged' || node.diff.change !== 'unchanged')
      .map((node) => node.id),
  );
  const edgeIds = sortStrings(
    edges
      .filter((edge) => edge.diff.side !== 'merged' || edge.diff.change !== 'unchanged')
      .map((edge) => edge.id),
  );

  return {
    tree: {
      rootId: rootNode.id,
      root: rootNode,
      byId,
      childrenByParent: new Map(
        [...byId.values()]
          .filter((node) => node.children.length > 0)
          .map((node) => [node.id, node.children] as const),
      ),
    },
    edges,
    pointsOfInterest: {
      nodeIds,
      edgeIds,
    },
    diff,
  };
};

export function compileSemanticDiagramDiffUnion(
  params: CompileSemanticDiagramDiffUnionParams,
): SemanticDiagramDiffUnion {
  const { before, schema } = params;
  if (params.diff) {
    const diff = assertValidDiffResult(
      validateSemanticDiagramDiffAgainstBefore({
        before,
        diff: params.diff,
      }),
    );
    const after = materializeAfterDocumentFromDiff(before, diff);
    return compileSemanticDiagramDiffUnionFromDocuments({
      before,
      after,
      schema,
      diff: diffSemanticDiagramDocuments({ before, after }),
    });
  }

  const after = getRequired(
    params.after,
    'compileSemanticDiagramDiffUnion requires either "after" or "diff".',
  );
  const diff = diffSemanticDiagramDocuments({ before, after });
  return compileSemanticDiagramDiffUnionFromDocuments({
    before,
    after,
    schema,
    diff,
  });
}

export function evolveSemanticDiagramDiffUnion(
  params: EvolveSemanticDiagramDiffUnionParams,
): ValidationResult<SemanticDiagramDiffUnion> {
  const { before, diff, schema } = params;
  const validatedDiff = validateSemanticDiagramDiffAgainstBefore({
    before,
    diff,
  });
  if (!validatedDiff.ok || !validatedDiff.value) {
    return {
      ok: false,
      diagnostics: validatedDiff.diagnostics,
    };
  }

  const after = materializeAfterDocumentFromDiff(before, validatedDiff.value);
  return {
    ok: true,
    value: compileSemanticDiagramDiffUnionFromDocuments({
      before,
      after,
      schema,
      diff: diffSemanticDiagramDocuments({ before, after }),
    }),
    diagnostics: [],
  };
}
