import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId, CORE_GROUP_TYPE_ID } from './schema-ids';
import {
  resolveDerivedGroupTags,
  resolveEntityEffectiveAndDerivedTags,
  resolveEntityEffectiveTags,
} from './tags';
import type { Entity, SchemaModule } from './types';

const APP_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'application');
const TABLE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'table');
const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'interaction');
const DATA_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'data');
const READS_RELATION_ID = buildQualifiedSchemaObjectId('user/test', 'relations', 'reads');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1.0.0',
  tags: [
    { id: INTERACTION_TAG_ID, label: 'Interaction' },
    { id: DATA_TAG_ID, label: 'Data' },
  ],
  types: [
    { id: APP_TYPE_ID, label: 'Application', defaultTags: [INTERACTION_TAG_ID] },
    { id: TABLE_TYPE_ID, label: 'Table', defaultTags: [DATA_TAG_ID] },
    { id: CORE_GROUP_TYPE_ID, label: 'Group' },
  ],
  relations: [{ id: READS_RELATION_ID, label: 'reads', defaultTags: [DATA_TAG_ID] }],
};

describe('tag helpers', () => {
  it('resolves entity tags from defaults + overrides', () => {
    const entity: Entity = {
      id: 'orders',
      type: TABLE_TYPE_ID,
      tags: ['critical'],
      removeDefaultTags: [DATA_TAG_ID],
    };
    expect(resolveEntityEffectiveTags(schema, entity)).toEqual(['critical']);

    const replaced: Entity = {
      id: 'orders',
      type: TABLE_TYPE_ID,
      replaceDefaultTags: true,
      tags: ['warehouse'],
    };
    expect(resolveEntityEffectiveTags(schema, replaced)).toEqual(['warehouse']);
  });

  it('derives typed-group tags from groupType defaults', () => {
    const group: Entity = {
      id: 'tables',
      type: CORE_GROUP_TYPE_ID,
      props: { mode: 'typed', groupType: TABLE_TYPE_ID },
    };
    expect(resolveDerivedGroupTags(schema, group)).toEqual([DATA_TAG_ID]);
    expect(resolveEntityEffectiveAndDerivedTags(schema, group)).toEqual([DATA_TAG_ID]);
  });

  it('derives mixed-group tags from member majority order', () => {
    const group: Entity = {
      id: 'mixed',
      type: CORE_GROUP_TYPE_ID,
      props: { mode: 'mixed' },
      children: [
        { id: 'api-1', type: APP_TYPE_ID },
        { id: 'table-1', type: TABLE_TYPE_ID },
        { id: 'table-2', type: TABLE_TYPE_ID },
      ],
    };
    expect(resolveDerivedGroupTags(schema, group)).toEqual([DATA_TAG_ID, INTERACTION_TAG_ID]);
  });
});
