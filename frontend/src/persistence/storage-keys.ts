import { ACTIVE_DIAGRAM_ID_STORAGE_KEY, DIAGRAM_STORE_STORAGE_KEY } from '../model/diagram-store';
import { USER_SCHEMA_STORE_STORAGE_KEY } from '../model/personal-schema-registry';
import { SCHEMA_EDITOR_SESSION_STORAGE_KEY } from '../model/schema-editor-session-store';

export const ANIMATION_SETTINGS_STORAGE_KEY = 'semantic-diagram-animation-settings-v0.1';
export const NODE_VISUAL_MODE_STORAGE_KEY = 'semantic-diagram-node-visual-mode-v0.1';

const GUEST_STORAGE_NAMESPACE = 'guest';
const GUEST_STORAGE_MIGRATION_MARKER_KEY = `${GUEST_STORAGE_NAMESPACE}:storage-migrated-v1`;

const LEGACY_STORAGE_KEYS = [
  DIAGRAM_STORE_STORAGE_KEY,
  ACTIVE_DIAGRAM_ID_STORAGE_KEY,
  USER_SCHEMA_STORE_STORAGE_KEY,
  SCHEMA_EDITOR_SESSION_STORAGE_KEY,
  ANIMATION_SETTINGS_STORAGE_KEY,
  NODE_VISUAL_MODE_STORAGE_KEY,
] as const;

type ScopedStorageNamespace = `user:${string}` | typeof GUEST_STORAGE_NAMESPACE;

export interface ScopedStorageKeys {
  animationSettings: string;
  activeDiagramId: string;
  diagramStore: string;
  nodeVisualMode: string;
  schemaEditorSession: string;
  userSchemaStore: string;
}

export const getGuestStorageNamespace = (): ScopedStorageNamespace => GUEST_STORAGE_NAMESPACE;

export const getUserStorageNamespace = (principalId: string): ScopedStorageNamespace =>
  `user:${principalId}`;

export const getScopedStorageKey = (namespace: ScopedStorageNamespace, key: string) =>
  `${namespace}:${key}`;

export const getScopedStorageKeys = (namespace: ScopedStorageNamespace): ScopedStorageKeys => ({
  animationSettings: getScopedStorageKey(namespace, ANIMATION_SETTINGS_STORAGE_KEY),
  activeDiagramId: getScopedStorageKey(namespace, ACTIVE_DIAGRAM_ID_STORAGE_KEY),
  diagramStore: getScopedStorageKey(namespace, DIAGRAM_STORE_STORAGE_KEY),
  nodeVisualMode: getScopedStorageKey(namespace, NODE_VISUAL_MODE_STORAGE_KEY),
  schemaEditorSession: getScopedStorageKey(namespace, SCHEMA_EDITOR_SESSION_STORAGE_KEY),
  userSchemaStore: getScopedStorageKey(namespace, USER_SCHEMA_STORE_STORAGE_KEY),
});

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const migrateLegacyGuestStorage = (storage: StorageLike) => {
  if (storage.getItem(GUEST_STORAGE_MIGRATION_MARKER_KEY) === '1') {
    return;
  }

  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    const guestKey = getScopedStorageKey(GUEST_STORAGE_NAMESPACE, legacyKey);
    const existingGuestValue = storage.getItem(guestKey);
    if (existingGuestValue !== null) {
      continue;
    }
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue !== null) {
      storage.setItem(guestKey, legacyValue);
    }
  }

  storage.setItem(GUEST_STORAGE_MIGRATION_MARKER_KEY, '1');
};
