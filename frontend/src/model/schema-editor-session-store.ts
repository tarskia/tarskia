export const SCHEMA_EDITOR_SESSION_STORAGE_KEY = 'semantic-diagram-schema-editor-session-v0.1';

export interface SchemaEditorSessionRecord {
  schemaRef?: string;
  baseVersion?: string;
  draftName?: string;
  nameTouched?: boolean;
  editorText: string;
}

export interface LoadedSchemaEditorSessionRecord extends SchemaEditorSessionRecord {
  restoredFromStorage: boolean;
}

export interface SchemaEditorSessionStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface SchemaEditorSessionStore {
  load(fallbackText: string): LoadedSchemaEditorSessionRecord;
  save(session: SchemaEditorSessionRecord): void;
}

export class LocalSchemaEditorSessionStore implements SchemaEditorSessionStore {
  constructor(
    private readonly storage: SchemaEditorSessionStorageLike,
    private readonly storageKey = SCHEMA_EDITOR_SESSION_STORAGE_KEY,
  ) {}

  load(fallbackText: string): LoadedSchemaEditorSessionRecord {
    const stored = this.storage.getItem(this.storageKey);
    if (!stored) {
      return {
        editorText: fallbackText,
        restoredFromStorage: false,
      };
    }
    try {
      const parsed = JSON.parse(stored) as Partial<SchemaEditorSessionRecord> | null;
      return {
        schemaRef:
          typeof parsed?.schemaRef === 'string' && parsed.schemaRef.trim().length > 0
            ? parsed.schemaRef
            : undefined,
        baseVersion:
          typeof parsed?.baseVersion === 'string' && parsed.baseVersion.trim().length > 0
            ? parsed.baseVersion
            : undefined,
        draftName:
          typeof parsed?.draftName === 'string' && parsed.draftName.trim().length > 0
            ? parsed.draftName
            : undefined,
        nameTouched: parsed?.nameTouched === true,
        editorText:
          typeof parsed?.editorText === 'string' &&
          parsed.editorText.trim().length > 0 &&
          parsed.editorText !== 'undefined' &&
          parsed.editorText !== 'null'
            ? parsed.editorText
            : fallbackText,
        restoredFromStorage: true,
      };
    } catch {
      return {
        editorText: fallbackText,
        restoredFromStorage: false,
      };
    }
  }

  save(session: SchemaEditorSessionRecord) {
    this.storage.setItem(this.storageKey, JSON.stringify(session));
  }
}

export const createLocalSchemaEditorSessionStore = (storage: SchemaEditorSessionStorageLike) =>
  new LocalSchemaEditorSessionStore(storage);
