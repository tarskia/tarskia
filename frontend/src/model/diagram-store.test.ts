import { describe, expect, it } from 'vitest';
import { serializeDocument } from '../util/serialization';
import {
  ACTIVE_DIAGRAM_ID_STORAGE_KEY,
  createEmptyDiagramStoreSnapshot,
  DEFAULT_DIAGRAM_OWNER_SCOPE,
  DIAGRAM_STORE_STORAGE_KEY,
  findDiagramStreamByName,
  getCurrentDiagramBaseRevisionId,
  getDiagramHeadRevision,
  LocalDiagramStore,
  resolveDiagramStreamName,
} from './diagram-store';
import { buildSchemaActivation } from './schema-ref';
import type { SemanticDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const buildDoc = (name = 'Payments'): SemanticDocument => ({
  version: '0.1.0',
  schemaRefs: [act('core/web-app@0.3')],
  metadata: { name },
  entities: [{ id: 'service-payments', type: 'core/web-app.types.application', name: 'Payments' }],
  relations: [],
});

describe('diagram store', () => {
  it('loads an empty snapshot when storage is empty', () => {
    const storage = new MemoryStorage();
    const store = new LocalDiagramStore(storage);

    expect(store.load()).toEqual(createEmptyDiagramStoreSnapshot());
    expect(storage.getItem(DIAGRAM_STORE_STORAGE_KEY)).toContain('"streams":[]');
  });

  it('creates streams, persists active ids, and allows duplicate names', () => {
    const storage = new MemoryStorage();
    const store = new LocalDiagramStore(storage);
    let snapshot = createEmptyDiagramStoreSnapshot();

    const created = store.createStream({
      snapshot,
      name: 'Payments',
      raw: serializeDocument(buildDoc('Payments')),
      valid: true,
      now: '2026-03-25T09:00:00.000Z',
    });
    snapshot = created.snapshot;

    const duplicate = store.createStream({
      snapshot,
      name: 'payments',
      raw: serializeDocument(buildDoc('payments')),
      valid: true,
      now: '2026-03-25T09:01:00.000Z',
    });

    expect(created.stream.name).toBe('Payments');
    expect(created.stream.scope).toEqual(DEFAULT_DIAGRAM_OWNER_SCOPE);
    expect(duplicate.stream.name).toBe('payments');

    store.saveActiveDiagramId(duplicate.stream.id);
    expect(store.loadActiveDiagramId()).toBe(duplicate.stream.id);
    expect(storage.getItem(ACTIVE_DIAGRAM_ID_STORAGE_KEY)).toBe(duplicate.stream.id);
  });

  it('saves drafts, checkpoints, and updates base revision ids', () => {
    const storage = new MemoryStorage();
    const store = new LocalDiagramStore(storage);
    const created = store.createStream({
      snapshot: createEmptyDiagramStoreSnapshot(),
      name: 'Payments',
      raw: serializeDocument(buildDoc('Payments')),
      valid: true,
      now: '2026-03-25T09:00:00.000Z',
    });

    let snapshot = created.snapshot;
    const savedDraft = store.saveDraft({
      snapshot,
      streamId: created.stream.id,
      name: 'Payments',
      raw: serializeDocument({
        ...buildDoc('Payments'),
        entities: [
          { id: 'service-payments', type: 'core/web-app.types.application', name: 'Payments' },
          { id: 'api-payments', type: 'core/web-app.types.api', name: 'Payments API' },
        ],
      }),
      valid: true,
      expectedBaseRevisionId: undefined,
      now: '2026-03-25T09:05:00.000Z',
    });
    snapshot = savedDraft.snapshot;

    const checkpointed = store.checkpoint({
      snapshot,
      streamId: created.stream.id,
      raw: savedDraft.stream.draft?.raw ?? '',
      valid: true,
      expectedBaseRevisionId: undefined,
      summaryLines: ['Added 1 entity'],
      now: '2026-03-25T09:06:00.000Z',
    });
    snapshot = checkpointed.snapshot;

    const stream = snapshot.streams[0];
    if (!stream) {
      throw new Error('Expected saved stream');
    }
    expect(stream?.headRevisionId).toBe(checkpointed.revision.id);
    expect(checkpointed.revision.parentRevisionId).toBeUndefined();
    expect(stream?.draft?.baseRevisionId).toBe(checkpointed.revision.id);
    expect(getDiagramHeadRevision(stream)?.id).toBe(checkpointed.revision.id);
    expect(getCurrentDiagramBaseRevisionId(stream)).toBe(checkpointed.revision.id);
  });

  it('keeps rename pending on the draft until checkpoint and restores revisions into the single draft', () => {
    const storage = new MemoryStorage();
    const store = new LocalDiagramStore(storage);
    let snapshot = createEmptyDiagramStoreSnapshot();
    const created = store.createStream({
      snapshot,
      name: 'Payments',
      raw: serializeDocument(buildDoc('Payments')),
      valid: true,
      now: '2026-03-25T09:00:00.000Z',
    });
    snapshot = created.snapshot;

    const firstCheckpoint = store.checkpoint({
      snapshot,
      streamId: created.stream.id,
      raw: serializeDocument(buildDoc('Payments')),
      valid: false,
      summaryLines: ['Initial checkpoint for Payments'],
      now: '2026-03-25T09:01:00.000Z',
    });
    snapshot = firstCheckpoint.snapshot;

    const renamedDraft = store.saveDraft({
      snapshot,
      streamId: created.stream.id,
      name: 'Core Payments',
      raw: serializeDocument(buildDoc('Core Payments')),
      valid: true,
      expectedBaseRevisionId: firstCheckpoint.revision.id,
      now: '2026-03-25T09:02:00.000Z',
    });
    snapshot = renamedDraft.snapshot;

    expect(snapshot.streams[0]?.id).toBe(created.stream.id);
    expect(snapshot.streams[0]?.name).toBe('Payments');
    expect(snapshot.streams[0]?.draft?.name).toBe('Core Payments');

    const renamedCheckpoint = store.checkpoint({
      snapshot,
      streamId: created.stream.id,
      name: renamedDraft.stream.draft?.name,
      raw: renamedDraft.stream.draft?.raw ?? '',
      valid: true,
      expectedBaseRevisionId: firstCheckpoint.revision.id,
      summaryLines: ['Renamed diagram'],
      now: '2026-03-25T09:02:30.000Z',
    });
    snapshot = renamedCheckpoint.snapshot;

    expect(snapshot.streams[0]?.id).toBe(created.stream.id);
    expect(snapshot.streams[0]?.name).toBe('Core Payments');

    const restored = store.restoreDraft({
      snapshot,
      streamId: created.stream.id,
      revisionId: firstCheckpoint.revision.id,
      now: '2026-03-25T09:03:00.000Z',
    });

    expect(restored.stream.id).toBe(created.stream.id);
    expect(restored.stream.draft?.baseRevisionId).toBe(firstCheckpoint.revision.id);
    expect(restored.stream.name).toBe('Core Payments');
    expect(restored.stream.draft?.name).toBe('Payments');
    expect(restored.stream.draft?.raw).toContain('name: Payments');
    expect(restored.stream.draft?.valid).toBe(false);
  });

  it('rejects stale base revision ids', () => {
    const storage = new MemoryStorage();
    const store = new LocalDiagramStore(storage);
    const created = store.createStream({
      snapshot: createEmptyDiagramStoreSnapshot(),
      name: 'Payments',
      raw: serializeDocument(buildDoc('Payments')),
      valid: true,
      now: '2026-03-25T09:00:00.000Z',
    });

    const checkpointed = store.checkpoint({
      snapshot: created.snapshot,
      streamId: created.stream.id,
      raw: serializeDocument(buildDoc('Payments')),
      valid: true,
      expectedBaseRevisionId: undefined,
      summaryLines: ['Initial checkpoint for Payments'],
      now: '2026-03-25T09:01:00.000Z',
    });

    expect(() =>
      store.saveDraft({
        snapshot: checkpointed.snapshot,
        streamId: created.stream.id,
        name: 'Payments',
        raw: serializeDocument(buildDoc('Payments')),
        valid: true,
        expectedBaseRevisionId: 'stale-revision',
        now: '2026-03-25T09:02:00.000Z',
      }),
    ).toThrow('Stale diagram base revision.');
  });

  it('finds streams case-insensitively and resolves normalized display names', () => {
    const snapshot = {
      streams: [
        {
          id: 'diagram-1',
          name: 'Payments',
          slug: 'payments',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          streamVersion: 1,
          revisions: [],
        },
      ],
    };

    expect(findDiagramStreamByName({ snapshot, name: 'payments' })?.id).toBe('diagram-1');
    expect(
      resolveDiagramStreamName({
        snapshot,
        name: '  Payments   ',
      }),
    ).toBe('Payments');
  });
});
