import { describe, expect, it } from 'vitest';

import {
  createEmptyUserSchemaStoreSnapshot,
  createLocalUserSchemaStore,
  findUserSchemaStreamByName,
  getLatestPublishedVersion,
  getNextTwoPartVersion,
  getPublishedSchemaModules,
  suggestUserSchemaName,
  USER_SCHEMA_STORE_STORAGE_KEY,
} from './personal-schema-registry';

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const paymentsRaw = (version = '1.0') =>
  `
owner: user
name: payments
version: "${version}"
types:
  - id: payments
    label: Payments
relations: []
`.trim();

const ordersRaw = (version = '1.0') =>
  `
owner: user
name: orders
version: "${version}"
types:
  - id: orders
    label: Orders
relations: []
`.trim();

describe('user schema store', () => {
  it('loads an empty snapshot when storage is empty', () => {
    const storage = new MemoryStorage();
    const store = createLocalUserSchemaStore(storage);

    const snapshot = store.load();

    expect(snapshot).toEqual(createEmptyUserSchemaStoreSnapshot());
    expect(storage.getItem(USER_SCHEMA_STORE_STORAGE_KEY)).toContain('"streams":[]');
  });

  it('saves drafts, publishes versions, and clears the working draft on publish', () => {
    const storage = new MemoryStorage();
    const store = createLocalUserSchemaStore(storage);

    let snapshot = createEmptyUserSchemaStoreSnapshot();
    const created = store.saveDraftAsNew({
      snapshot,
      name: 'Payments',
      raw: paymentsRaw(),
      valid: false,
      now: '2026-03-20T10:00:00.000Z',
    });
    snapshot = created.snapshot;

    expect(created.stream.name).toBe('payments');
    expect(created.stream.draft?.valid).toBe(false);

    snapshot = store.publish({
      snapshot,
      name: 'Payments',
      raw: paymentsRaw(),
      version: '1.0',
      assessment: {
        summaryLines: ['Defines 1 type'],
      },
      now: '2026-03-20T10:05:00.000Z',
    });

    let stream = snapshot.streams[0];
    expect(stream?.draft).toBeUndefined();
    expect(stream?.versions).toHaveLength(1);
    expect(stream?.versions[0]?.assessment?.summaryLines).toEqual(['Defines 1 type']);
    expect(stream).toBeDefined();
    if (!stream) {
      throw new Error('expected published stream');
    }
    expect(getLatestPublishedVersion(stream)?.version).toBe('1.0');

    snapshot = store.saveDraft({
      snapshot,
      name: 'Payments',
      raw: paymentsRaw('1.0'),
      valid: true,
      baseVersion: '1.0',
      now: '2026-03-20T10:06:00.000Z',
    });

    stream = snapshot.streams[0];
    expect(stream?.draft?.baseVersion).toBe('1.0');
    expect(stream?.draft?.raw).toContain('name: payments');
  });

  it('creates a fresh published stream when publishing a new schema directly', () => {
    const store = createLocalUserSchemaStore(new MemoryStorage());

    const snapshot = store.publish({
      snapshot: createEmptyUserSchemaStoreSnapshot(),
      name: 'Orders',
      raw: ordersRaw(),
      version: '1.0',
      now: '2026-03-20T10:05:00.000Z',
    });

    expect(snapshot.streams).toHaveLength(1);
    expect(snapshot.streams[0]?.name).toBe('orders');
    expect(snapshot.streams[0]?.draft).toBeUndefined();
    expect(snapshot.streams[0]?.versions[0]?.version).toBe('1.0');
  });

  it('deletes and restores streams by user schema name', () => {
    const store = createLocalUserSchemaStore(new MemoryStorage());
    let snapshot = createEmptyUserSchemaStoreSnapshot();
    snapshot = store.saveDraftAsNew({
      snapshot,
      name: 'Payments',
      raw: paymentsRaw(),
      valid: true,
      now: '2026-03-20T10:00:00.000Z',
    }).snapshot;
    snapshot = store.saveDraftAsNew({
      snapshot,
      name: 'Orders',
      raw: ordersRaw(),
      valid: true,
      now: '2026-03-20T10:01:00.000Z',
    }).snapshot;

    const deleted = store.deleteStream({
      snapshot,
      name: 'Payments',
    });

    expect(deleted.snapshot.streams.map((stream) => stream.name)).toEqual(['orders']);
    expect(deleted.deletedStream?.name).toBe('payments');
    expect(deleted.deletedIndex).toBe(1);
    expect(deleted.deletedStream).toBeDefined();
    if (!deleted.deletedStream) {
      throw new Error('expected deleted stream');
    }

    const restored = store.restoreStream({
      snapshot: deleted.snapshot,
      stream: deleted.deletedStream,
      index: deleted.deletedIndex,
    });

    expect(restored.streams.map((stream) => stream.name)).toEqual(['orders', 'payments']);
  });

  it('finds streams by name case-insensitively and rejects duplicate names', () => {
    const store = createLocalUserSchemaStore(new MemoryStorage());
    const snapshot = store.saveDraftAsNew({
      snapshot: createEmptyUserSchemaStoreSnapshot(),
      name: 'Payments',
      raw: paymentsRaw(),
      valid: true,
      now: '2026-03-20T10:00:00.000Z',
    }).snapshot;

    expect(
      findUserSchemaStreamByName({
        snapshot,
        name: 'PAYMENTS',
      })?.name,
    ).toBe('payments');

    expect(() =>
      store.saveDraftAsNew({
        snapshot,
        name: 'payments',
        raw: paymentsRaw(),
        valid: true,
        now: '2026-03-20T10:10:00.000Z',
      }),
    ).toThrow('A schema named "payments" already exists.');
  });

  it('round-trips persisted snapshots through the local storage adapter', () => {
    const storage = new MemoryStorage();
    const store = createLocalUserSchemaStore(storage);
    const created = store.saveDraftAsNew({
      snapshot: createEmptyUserSchemaStoreSnapshot(),
      name: 'Client Schema',
      raw: `
owner: user
name: client-schema
version: "1.0"
types:
  - id: client
    label: Client
relations: []
`.trim(),
      valid: true,
      now: '2026-03-20T10:00:00.000Z',
    });

    const reloaded = createLocalUserSchemaStore(storage).load();

    expect(reloaded.streams[0]?.name).toBe('client-schema');
    expect(reloaded.streams[0]?.draft?.valid).toBe(true);
    expect(created.stream.name).toBe('client-schema');
  });

  it('suggests slug names from the first declared schema object', () => {
    expect(
      suggestUserSchemaName(
        `
types:
  - id: payment-service
    label: Payment Service
relations: []
`.trim(),
      ),
    ).toBe('payment-service');

    expect(
      suggestUserSchemaName(
        `
traits:
  - id: internal-api
    label: Internal API
types: []
relations: []
`.trim(),
      ),
    ).toBe('internal-api');

    expect(
      suggestUserSchemaName(
        `
relations:
  - id: reads
    label: Reads
types: []
`.trim(),
      ),
    ).toBe('reads');
  });

  it('exposes published user schemas as parsed schema modules', () => {
    const store = createLocalUserSchemaStore(new MemoryStorage());
    const snapshot = store.publish({
      snapshot: createEmptyUserSchemaStoreSnapshot(),
      name: 'Payments',
      raw: paymentsRaw(),
      version: '1.0',
      assessment: {
        summaryLines: ['Defines 1 type'],
      },
      now: '2026-03-20T10:05:00.000Z',
    });

    const published = getPublishedSchemaModules(snapshot);

    expect(published).toHaveLength(1);
    expect(published[0]?.stream.name).toBe('payments');
    expect(published[0]?.module.owner).toBe('user');
    expect(published[0]?.module.name).toBe('payments');
    expect(published[0]?.module.version).toBe('1.0');
  });
});

describe('user schema version helpers', () => {
  it('increments two-part versions', () => {
    expect(getNextTwoPartVersion(undefined, 'minor')).toBe('1.0');
    expect(getNextTwoPartVersion('1.0', 'minor')).toBe('1.1');
    expect(getNextTwoPartVersion('1.4', 'major')).toBe('2.0');
    expect(getNextTwoPartVersion('1.4', 'none')).toBeUndefined();
  });
});
