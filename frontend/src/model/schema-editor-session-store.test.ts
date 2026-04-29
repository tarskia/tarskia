import { describe, expect, it } from 'vitest';

import {
  createLocalSchemaEditorSessionStore,
  SCHEMA_EDITOR_SESSION_STORAGE_KEY,
} from './schema-editor-session-store';

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe('schema editor session store', () => {
  it('returns the fallback draft when no prior session exists', () => {
    const store = createLocalSchemaEditorSessionStore(new MemoryStorage());

    expect(store.load('types: []')).toEqual({
      editorText: 'types: []',
      restoredFromStorage: false,
    });
  });

  it('round-trips scratch draft metadata through storage', () => {
    const storage = new MemoryStorage();
    const store = createLocalSchemaEditorSessionStore(storage);

    store.save({
      draftName: 'forked-payments',
      nameTouched: true,
      editorText: 'types:\n  - id: payment-worker',
    });

    expect(storage.getItem(SCHEMA_EDITOR_SESSION_STORAGE_KEY)).toContain(
      '"draftName":"forked-payments"',
    );
    expect(store.load('types: []')).toEqual({
      draftName: 'forked-payments',
      nameTouched: true,
      editorText: 'types:\n  - id: payment-worker',
      restoredFromStorage: true,
    });
  });

  it('falls back cleanly when stored editor text is poisoned', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SCHEMA_EDITOR_SESSION_STORAGE_KEY,
      JSON.stringify({
        schemaRef: 'user/payments',
        baseVersion: '1.0',
        draftName: 'Payments',
        nameTouched: true,
        editorText: 'undefined',
      }),
    );
    const store = createLocalSchemaEditorSessionStore(storage);

    expect(store.load('types: []')).toEqual({
      schemaRef: 'user/payments',
      baseVersion: '1.0',
      draftName: 'Payments',
      nameTouched: true,
      editorText: 'types: []',
      restoredFromStorage: true,
    });
  });
});
