import { describe, expect, it } from 'vitest';
import {
  addEntityToDocument,
  addRelationToDocument,
  duplicateEntityInDocument,
  insertSiblingEntityInDocument,
  moveEntityInDocument,
  removeEntityPropInDocument,
  setEntityPropInDocument,
  updateEntityNameInDocument,
  updateEntityTagsInDocument,
} from './document-commands';
import { buildEntityIndex } from './entity-tree';
import {
  buildQualifiedSchemaObjectId,
  CORE_GROUP_TYPE_ID,
  CORE_TABLE_TYPE_ID,
  getSchemaObjectLocalId,
} from './schema-ids';
import type { Entity, SemanticDocument } from './types';

const SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'service');
const ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'endpoint');
const EXTERNAL_API_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'external-api');
const DATASTORE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'datastore');
const CALLS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'calls');
const GIT_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const createDoc = (entities: Entity[]): SemanticDocument => ({
  version: '1',
  schemaRefs: [],
  entities,
  relations: [],
});

describe('document command helpers', () => {
  it('adds child entities without creating structural relations', () => {
    const doc = createDoc([{ id: 'db', type: DATASTORE_TYPE_ID, children: [] }]);
    let counter = 0;
    const result = addEntityToDocument({
      doc,
      typeId: CORE_TABLE_TYPE_ID,
      parentId: 'db',
      createEntityId: (typeId) => `${getSchemaObjectLocalId(typeId)}-${++counter}`,
      resolveEntityName: () => undefined,
      canContainEntity: () => true,
    });

    const db = result.doc.entities[0];
    expect(result.createdEntityId).toBe('table-1');
    expect(db?.children?.map((child) => child.id)).toEqual(['table-1']);
    expect(result.doc.relations).toEqual([]);
  });

  it('inserts siblings directly after the selected sibling', () => {
    const doc = createDoc([
      { id: 'a', type: SERVICE_TYPE_ID },
      { id: 'b', type: SERVICE_TYPE_ID },
      { id: 'c', type: SERVICE_TYPE_ID },
    ]);
    let counter = 0;
    const result = insertSiblingEntityInDocument({
      doc,
      siblingId: 'a',
      typeId: SERVICE_TYPE_ID,
      createEntityId: (typeId) => `${getSchemaObjectLocalId(typeId)}-${++counter}`,
      resolveEntityName: () => undefined,
    });

    expect(result.createdEntityId).toBe('service-1');
    expect(result.doc.entities.map((entity) => entity.id)).toEqual(['a', 'service-1', 'b', 'c']);
  });

  it('duplicates subtree and duplicates only internal relations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'svc',
          type: SERVICE_TYPE_ID,
          provenance: {
            locations: [
              {
                repo: 'https://github.com/example/repo',
                commit: GIT_COMMIT,
                path: 'src/service.ts',
              },
            ],
          },
          children: [{ id: 'endpoint', type: ENDPOINT_TYPE_ID }],
        },
        { id: 'external', type: EXTERNAL_API_TYPE_ID },
      ],
      relations: [
        {
          id: 'r-internal',
          from: 'svc',
          to: 'endpoint',
          type: CALLS_RELATION_ID,
          provenance: {
            locations: [
              {
                repo: 'https://github.com/example/repo',
                commit: GIT_COMMIT,
                path: 'src/service.ts',
              },
            ],
          },
        },
        { id: 'r-cross', from: 'svc', to: 'external', type: CALLS_RELATION_ID },
      ],
    };
    let counter = 0;
    const result = duplicateEntityInDocument({
      doc,
      entityId: 'svc',
      createEntityId: (typeId) => `${getSchemaObjectLocalId(typeId)}-copy-${++counter}`,
    });

    const index = buildEntityIndex(result.doc.entities);
    expect(result.duplicatedEntityId).toBe('service-copy-1');
    expect(index.byId.has('service-copy-1')).toBe(true);
    expect(index.byId.has('endpoint-copy-2')).toBe(true);
    expect(index.byId.get('service-copy-1')?.provenance).toBeUndefined();
    expect(
      result.doc.relations.some(
        (relation) => relation.from === 'service-copy-1' && relation.to === 'endpoint-copy-2',
      ),
    ).toBe(true);
    expect(
      result.doc.relations.find(
        (relation) => relation.from === 'service-copy-1' && relation.to === 'endpoint-copy-2',
      )?.provenance,
    ).toBeUndefined();
    expect(
      result.doc.relations.some(
        (relation) => relation.from === 'service-copy-1' && relation.to === 'external',
      ),
    ).toBe(false);
  });

  it('moves entities and applies prop/name/tag updates', () => {
    const base = createDoc([
      { id: 'runtime', type: CORE_GROUP_TYPE_ID, children: [{ id: 'svc', type: SERVICE_TYPE_ID }] },
      { id: 'target', type: CORE_GROUP_TYPE_ID },
    ]);
    const serviceEntity = base.entities[0]?.children?.[0];
    expect(serviceEntity).toBeDefined();
    if (!serviceEntity) {
      throw new Error('Expected nested service entity');
    }
    serviceEntity.provenance = {
      locations: [
        {
          repo: 'https://github.com/example/repo',
          commit: GIT_COMMIT,
          path: 'src/svc.ts',
        },
      ],
    };

    const moved = moveEntityInDocument(base, 'svc', 'target');
    const movedIndex = buildEntityIndex(moved.entities);
    expect(movedIndex.parentById.get('svc')).toBe('target');
    expect(movedIndex.byId.get('svc')?.provenance).toBeUndefined();

    const withProp = setEntityPropInDocument(moved, 'svc', 'runtime.replicas', 3);
    const withName = updateEntityNameInDocument(withProp, 'svc', '  Orders API  ');
    const withTags = updateEntityTagsInDocument(withName, 'svc', ['service', 'critical']);
    const withoutProp = removeEntityPropInDocument(withTags, 'svc', 'runtime.replicas');
    const clearedTags = updateEntityTagsInDocument(withoutProp, 'svc', undefined);

    const entity = buildEntityIndex(clearedTags.entities).byId.get('svc');
    expect(entity?.name).toBe('Orders API');
    expect(entity?.props).toBeUndefined();
    expect(entity?.tags).toBeUndefined();
    expect(entity?.provenance).toBeUndefined();
  });

  it('adds relations with undecided state', () => {
    const doc = createDoc([
      { id: 'a', type: SERVICE_TYPE_ID },
      { id: 'b', type: SERVICE_TYPE_ID },
    ]);
    const next = addRelationToDocument({
      doc,
      relationId: 'rel-1',
      from: 'a',
      to: 'b',
    });
    expect(next.relations).toEqual([
      {
        id: 'rel-1',
        from: 'a',
        to: 'b',
        state: 'undecided',
      },
    ]);
  });
});
