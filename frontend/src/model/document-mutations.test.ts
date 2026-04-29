import { describe, expect, it } from 'vitest';
import { removeEntitiesFromDocument } from './document-mutations';
import { buildEntityIndex } from './entity-tree';
import type { SemanticDocument } from './types';

describe('removeEntitiesFromDocument', () => {
  it('removes descendants and prunes relations that reference removed or missing nodes', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'runtime',
          type: 'group',
          children: [
            { id: 'deploy-a', type: 'service' },
            { id: 'deploy-b', type: 'service' },
          ],
        },
        { id: 'api', type: 'application' },
      ],
      relations: [
        { id: 'r-1', type: 'calls', from: 'api', to: 'deploy-a' },
        { id: 'r-2', type: 'calls', from: 'deploy-a', to: 'deploy-b' },
        { id: 'r-3', type: 'calls', from: 'ghost', to: 'api' },
      ],
    };

    const next = removeEntitiesFromDocument(doc, ['runtime']);
    const remainingIds = new Set(buildEntityIndex(next.entities).byId.keys());

    expect(remainingIds.has('runtime')).toBe(false);
    expect(remainingIds.has('deploy-a')).toBe(false);
    expect(remainingIds.has('deploy-b')).toBe(false);
    expect(remainingIds.has('api')).toBe(true);
    expect(next.relations).toEqual([]);
  });
});
