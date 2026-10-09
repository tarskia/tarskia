import type { Diagnostic } from '../model/diagnostics';
import type { DiagramView, DiagramViewNodeState } from '../model/types';
import type { DiagramContent, SemanticIndex } from './semantic-index';

/** A named view of a diagram; the diagram's embedded view remains its default. */
export interface SavedDiagramView {
  kind: 'semantic-diagram-saved-view';
  version: 1;
  diagram: { namespace: string; slug: string };
  revision: string;
  title?: string;
  view: DiagramView;
}

export type SavedDiagramViewResult<T = SavedDiagramView> =
  | { ok: true; value: T }
  | { ok: false; diagnostic: Diagnostic };

const MAX_IDS = 5000;
const MAX_ID_LENGTH = 512;
// Accommodates 5000 fully escaped 512-character IDs, while bounding JSON parsing work.
const MAX_JSON_LENGTH = 16 * 1024 * 1024;

/** Accept decoded URL data or JSON text. Never retain untrusted object references. */
export function parseSavedDiagramView(input: unknown): SavedDiagramViewResult {
  let diagnostic: Diagnostic | undefined;
  const reject = (message: string, path: string): never => {
    diagnostic = {
      domain: 'diagram',
      phase: 'parse',
      severity: 'error',
      code: 'saved-view.invalid',
      message,
      path,
    };
    throw null;
  };
  try {
    if (typeof input === 'string') {
      if (input.length > MAX_JSON_LENGTH) reject('Saved view JSON is too large', '$');
      input = JSON.parse(input);
    }
    const object = (
      value: unknown,
      keys: readonly string[],
      path: string,
    ): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        reject('Expected an object', path);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        reject('Expected a plain JSON object', path);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(descriptors).length > keys.length) reject('Unexpected fields', path);
      const allowedKeys = new Set(keys);
      const entries: [string, unknown][] = [];
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) reject('Unexpected field', path);
        const descriptor = descriptors[key as string];
        if (!('value' in descriptor) || !descriptor.enumerable)
          reject('Expected JSON data properties', path);
        entries.push([key as string, descriptor.value]);
      }
      return Object.fromEntries(entries);
    };
    const string = (value: unknown, limit: number, path: string, allowEmpty = false): string => {
      if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > limit)
        reject(`Expected a string of at most ${limit} characters`, path);
      return value as string;
    };
    const ids = new Set<string>();
    const id = (value: unknown, path: string) => {
      const result = string(value, MAX_ID_LENGTH, path);
      ids.add(result);
      if (ids.size > MAX_IDS) reject(`Saved views support at most ${MAX_IDS} IDs`, path);
      return result;
    };
    const record = object(input, ['kind', 'version', 'diagram', 'revision', 'title', 'view'], '$');
    if (record.kind !== 'semantic-diagram-saved-view' || record.version !== 1)
      reject('Unsupported saved-view kind or version', '$');
    const diagram = object(record.diagram, ['namespace', 'slug'], '$.diagram');
    const namespace = string(diagram.namespace, MAX_ID_LENGTH, '$.diagram.namespace');
    const slug = string(diagram.slug, MAX_ID_LENGTH, '$.diagram.slug');
    const revision = string(record.revision, 12, '$.revision');
    if (!/^[0-9a-f]{12}$/.test(revision))
      reject('Expected a 12-character lowercase hexadecimal revision', '$.revision');
    const title =
      record.title === undefined ? undefined : string(record.title, 200, '$.title', true);
    const rawView = object(
      record.view,
      ['kind', 'version', 'scopeRootId', 'nodesById', 'camera'],
      '$.view',
    );
    if (rawView.kind !== 'semantic-diagram-view' || rawView.version !== 3)
      reject('Expected DiagramView version 3', '$.view');
    const view: DiagramView = { kind: 'semantic-diagram-view', version: 3 };
    if (rawView.scopeRootId !== undefined)
      view.scopeRootId = id(rawView.scopeRootId, '$.view.scopeRootId');
    if (rawView.nodesById !== undefined) {
      const rawNodes = rawView.nodesById;
      if (!rawNodes || typeof rawNodes !== 'object' || Array.isArray(rawNodes))
        reject('Expected node flags keyed by ID', '$.view.nodesById');
      const keys = Reflect.ownKeys(rawNodes as object);
      if (keys.length > MAX_IDS)
        reject(`Saved views support at most ${MAX_IDS} IDs`, '$.view.nodesById');
      const nodeKeys = keys.map((key) => id(key, '$.view.nodesById'));
      const nodes = object(rawNodes, nodeKeys, '$.view.nodesById');
      const entries: [string, DiagramViewNodeState][] = [];
      for (const key of nodeKeys) {
        const state = object(nodes[key], ['expanded', 'highlighted'], `$.view.nodesById.${key}`);
        const flags: DiagramViewNodeState = {};
        for (const flag of ['expanded', 'highlighted'] as const) {
          if (state[flag] !== undefined) {
            if (typeof state[flag] !== 'boolean')
              reject('Expected a boolean node flag', `$.view.nodesById.${key}.${flag}`);
            flags[flag] = state[flag] as boolean;
          }
        }
        entries.push([key, flags]);
      }
      view.nodesById = Object.fromEntries(entries);
    }
    if (rawView.camera !== undefined) {
      const camera = object(rawView.camera, ['anchorId', 'rect'], '$.view.camera');
      const rawRect = object(camera.rect, ['x', 'y', 'width', 'height'], '$.view.camera.rect');
      const values = ['x', 'y', 'width', 'height'].map((key) => rawRect[key]);
      if (
        !values.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
        (rawRect.width as number) <= 0 ||
        (rawRect.height as number) <= 0
      )
        reject('Expected a finite positive camera rectangle', '$.view.camera.rect');
      const rect = {
        x: rawRect.x as number,
        y: rawRect.y as number,
        width: rawRect.width as number,
        height: rawRect.height as number,
      };
      view.camera = { rect };
      if (camera.anchorId !== undefined)
        view.camera.anchorId = id(camera.anchorId, '$.view.camera.anchorId');
    }
    return {
      ok: true,
      value: {
        kind: 'semantic-diagram-saved-view',
        version: 1,
        diagram: { namespace, slug },
        revision,
        ...(title !== undefined ? { title } : {}),
        view,
      },
    };
  } catch {
    return {
      ok: false,
      diagnostic: diagnostic ?? {
        domain: 'diagram',
        phase: 'parse',
        severity: 'error',
        code: 'saved-view.invalid',
        message: 'Saved view must be valid JSON data',
      },
    };
  }
}

/** Validation and copying precede serialization, including for nominally typed callers. */
export function serializeSavedDiagramView(input: unknown): SavedDiagramViewResult<string> {
  const parsed = parseSavedDiagramView(input);
  if (parsed.ok === false) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value) };
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map((entry) => (entry === undefined ? 'null' : canonicalJson(entry))).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/** Synchronous non-security FNV-1a revision of parsed semantic content, truncated to 48 bits. */
export function hashDiagramContent(
  content: Pick<DiagramContent, 'entities' | 'relations' | 'schemaRefs'>,
): string {
  const text = canonicalJson({
    entities: content.entities,
    relations: content.relations,
    schemaRefs: content.schemaRefs,
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text))
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return (hash & 0xffffffffffffn).toString(16).padStart(12, '0');
}

export interface SavedDiagramViewReport {
  revisionMatches: boolean;
  droppedIds: string[];
  scopeRootDropped: boolean;
  anchorDropped: boolean;
}

export function applySavedView(
  index: SemanticIndex,
  saved: SavedDiagramView,
  currentRevision: string,
): { view: DiagramView; report: SavedDiagramViewReport } {
  const dropped = new Set<string>();
  const exists = (id: string) => {
    if (index.entityIndex.byId.has(id)) return true;
    dropped.add(id);
    return false;
  };
  const view: DiagramView = { ...saved.view };
  if (saved.view.nodesById)
    view.nodesById = Object.fromEntries(
      Object.entries(saved.view.nodesById)
        .filter(([id]) => exists(id))
        .map(([id, state]) => [id, { ...state }]),
    );
  const scopeRootDropped = saved.view.scopeRootId !== undefined && !exists(saved.view.scopeRootId);
  if (scopeRootDropped) delete view.scopeRootId;
  const anchorDropped =
    saved.view.camera?.anchorId !== undefined && !exists(saved.view.camera.anchorId);
  if (anchorDropped) {
    // Without its anchor, this relative rectangle must not become an absolute framing.
    delete view.camera;
  } else if (saved.view.camera) {
    view.camera = { ...saved.view.camera, rect: { ...saved.view.camera.rect } };
  }
  return {
    view,
    report: {
      revisionMatches: saved.revision === currentRevision,
      droppedIds: [...dropped].sort(),
      scopeRootDropped,
      anchorDropped,
    },
  };
}
