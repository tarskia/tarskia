import { describe, expect, it } from 'vitest';

import { createEntityDisplayTypeResolver } from './entity-display';
import { CORE_GROUP_TYPE_ID } from './schema-ids';
import type { Entity } from './types';

const APPLICATION_TYPE_ID = 'user/test.types.application';
const WORKER_TYPE_ID = 'user/test.types.worker';
const JOB_TYPE_ID = 'user/test.types.job';

const indexEntities = (entities: Entity[]) => {
  const byId = new Map<string, Entity>();
  const parentById = new Map<string, string | undefined>();
  const childrenByParent = new Map<string, Entity[]>();

  const visit = (nodes: Entity[], parentId?: string) => {
    for (const entity of nodes) {
      byId.set(entity.id, entity);
      parentById.set(entity.id, parentId);
      if (entity.children && entity.children.length > 0) {
        childrenByParent.set(entity.id, entity.children);
        visit(entity.children, entity.id);
      }
    }
  };

  visit(entities);
  return { byId, parentById, childrenByParent };
};

describe('createEntityDisplayTypeResolver', () => {
  it('resolves mixed groups from the majority immediate child type', () => {
    const runtime: Entity = {
      id: 'runtime',
      type: CORE_GROUP_TYPE_ID,
      props: { mode: 'mixed' },
      children: [
        { id: 'worker-a', type: WORKER_TYPE_ID, name: 'Worker A' },
        { id: 'job-a', type: JOB_TYPE_ID, name: 'Job A' },
        { id: 'job-b', type: JOB_TYPE_ID, name: 'Job B' },
      ],
    };

    const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver(indexEntities([runtime]));

    expect(resolveEntityDisplayTypeId(runtime)).toBe(JOB_TYPE_ID);
  });

  it('falls back to the parent display type when a mixed group is empty', () => {
    const app: Entity = {
      id: 'app',
      type: APPLICATION_TYPE_ID,
      children: [
        {
          id: 'runtime',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'mixed' },
        },
      ],
    };
    const runtime = app.children?.[0];
    if (!runtime) {
      throw new Error('Expected runtime child');
    }

    const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver(indexEntities([app]));

    expect(resolveEntityDisplayTypeId(runtime)).toBe(APPLICATION_TYPE_ID);
  });
});
