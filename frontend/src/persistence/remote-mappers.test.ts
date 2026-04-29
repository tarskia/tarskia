import { describe, expect, it } from 'vitest';

import { mapRemoteDiagramStream } from './remote-mappers';

describe('remote mappers', () => {
  it('maps checkpointed diagram revisions with name and validity', () => {
    const stream = mapRemoteDiagramStream({
      id: 'diagram-1',
      name: 'Payments',
      scopeKind: 'team',
      createdAt: '2026-04-13T11:59:00.000Z',
      updatedAt: '2026-04-13T12:00:00.000Z',
      streamVersion: 4,
      draft: {
        raw: 'metadata:\n  name: Payments draft\n',
        name: 'Payments draft',
        baseRevisionId: 'revision-2',
        updatedAt: '2026-04-13T12:01:00.000Z',
        valid: false,
      },
      revisions: [
        {
          id: 'revision-1',
          name: 'Payments',
          raw: 'metadata:\n  name: Payments\n',
          checkpointedAt: '2026-04-13T12:00:00.000Z',
          valid: true,
          summaryLines: ['Initial checkpoint'],
        },
        {
          id: 'revision-2',
          name: 'Payments v2',
          raw: 'metadata:\n  name: Payments v2\n',
          checkpointedAt: '2026-04-13T12:05:00.000Z',
          valid: false,
          summaryLines: ['Introduced draft-breaking change'],
          parentRevisionId: 'revision-1',
        },
      ],
    });

    expect(stream).toBeDefined();
    expect(stream?.scope.kind).toBe('team');
    expect(stream?.headRevisionId).toBe('revision-2');
    expect(stream?.revisions[1]).toEqual({
      id: 'revision-2',
      name: 'Payments v2',
      raw: 'metadata:\n  name: Payments v2\n',
      checkpointedAt: '2026-04-13T12:05:00.000Z',
      valid: false,
      summaryLines: ['Introduced draft-breaking change'],
      parentRevisionId: 'revision-1',
    });
  });
});
