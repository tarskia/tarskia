import { describe, expect, it } from 'vitest';
import {
  duplicateEntityById,
  moveEntityById,
  normalizeEntityNameInput,
  removeEntityPropById,
  setEntityPropById,
  updateEntityNameById,
} from './entity-tree';
import type { Entity } from './types';

describe('entity-tree naming updates', () => {
  it('normalizes blank name input to undefined', () => {
    expect(normalizeEntityNameInput('')).toBeUndefined();
    expect(normalizeEntityNameInput('   ')).toBeUndefined();
    expect(normalizeEntityNameInput('api')).toBe('api');
    expect(normalizeEntityNameInput('  api  ')).toBe('api');
  });

  it('clears an optional name when inspector input is emptied', () => {
    const entities: Entity[] = [{ id: 'api-1', type: 'api', name: 'Checkout API' }];
    const updated = updateEntityNameById(entities, 'api-1', '   ');
    expect(updated[0]?.name).toBeUndefined();
  });

  it('sets and removes top-level properties', () => {
    const entities: Entity[] = [{ id: 'api-1', type: 'api', props: { method: 'POST' } }];
    const withAdded = setEntityPropById(entities, 'api-1', 'path', '/orders');
    const props = withAdded[0]?.props as Record<string, unknown> | undefined;
    expect(props?.method).toBe('POST');
    expect(props?.path).toBe('/orders');

    const withRemoved = removeEntityPropById(withAdded, 'api-1', 'method');
    const removedProps = withRemoved[0]?.props as Record<string, unknown> | undefined;
    expect(removedProps?.method).toBeUndefined();
    expect(removedProps?.path).toBe('/orders');
  });

  it('sets and removes nested dot-path properties', () => {
    const entities: Entity[] = [{ id: 'db-1', type: 'relational-db', props: {} }];
    const withNested = setEntityPropById(entities, 'db-1', 'hosting.provider', 'aws');
    const props = withNested[0]?.props as Record<string, unknown> | undefined;
    const hosting = props?.hosting as Record<string, unknown> | undefined;
    expect(hosting?.provider).toBe('aws');

    const removedNested = removeEntityPropById(withNested, 'db-1', 'hosting.provider');
    const removedProps = removedNested[0]?.props as Record<string, unknown> | undefined;
    expect(removedProps?.hosting).toBeUndefined();
  });

  it('moves an entity to a new parent', () => {
    const entities: Entity[] = [
      {
        id: 'app',
        type: 'application',
        children: [{ id: 'svc-a', type: 'service' }],
      },
      {
        id: 'api',
        type: 'api',
      },
    ];
    const moved = moveEntityById(entities, 'svc-a', 'api');
    const appChildren = moved[0]?.children ?? [];
    const apiChildren = moved[1]?.children ?? [];
    expect(appChildren).toHaveLength(0);
    expect(apiChildren.map((entity) => entity.id)).toEqual(['svc-a']);
  });

  it('duplicates a subtree with fresh ids', () => {
    const entities: Entity[] = [
      {
        id: 'table-1',
        type: 'table',
        children: [{ id: 'column-1', type: 'column' }],
      },
    ];
    const ids = ['table-2', 'column-2'];
    const duplicated = duplicateEntityById(entities, 'table-1', () => {
      const next = ids.shift();
      if (!next) throw new Error('ran out of test ids');
      return next;
    });
    expect(duplicated.entities).toHaveLength(2);
    expect(duplicated.duplicatedRootId).toBe('table-2');
    expect(duplicated.idMap.get('table-1')).toBe('table-2');
    expect(duplicated.idMap.get('column-1')).toBe('column-2');
    const clone = duplicated.entities[1];
    expect(clone?.id).toBe('table-2');
    expect(clone?.children?.[0]?.id).toBe('column-2');
  });
});
