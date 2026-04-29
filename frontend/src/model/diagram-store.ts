import { createId } from '../util/id';
import { parseSourceDocument } from '../util/serialization';

export const DIAGRAM_STORE_STORAGE_KEY = 'semantic-diagram-store-v0.1';
export const ACTIVE_DIAGRAM_ID_STORAGE_KEY = 'semantic-diagram-active-id-v0.1';
export const DEFAULT_DIAGRAM_NAME = 'Untitled diagram';

export interface DiagramOwnerScope {
  kind: 'personal' | 'team';
  id: string;
  label: string;
}

export const DEFAULT_DIAGRAM_OWNER_SCOPE: DiagramOwnerScope = {
  kind: 'personal',
  id: 'local',
  label: 'Personal',
};

export interface DiagramRevision {
  id: string;
  name: string;
  parentRevisionId?: string;
  raw: string;
  checkpointedAt: string;
  valid: boolean;
  summaryLines: string[];
}

export interface DiagramDraft {
  raw: string;
  name: string;
  baseRevisionId?: string;
  updatedAt: string;
  valid: boolean;
}

export interface DiagramStream {
  id: string;
  name: string;
  slug: string;
  scope: DiagramOwnerScope;
  createdAt: string;
  updatedAt: string;
  streamVersion: number;
  headRevisionId?: string;
  draft?: DiagramDraft;
  revisions: DiagramRevision[];
}

export interface DiagramStoreSnapshot {
  streams: DiagramStream[];
}

export interface DiagramStoreStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

type RawDiagramRevision = Partial<DiagramRevision>;
type RawDiagramDraft = Partial<DiagramDraft>;
type RawDiagramStream = Partial<DiagramStream> & {
  revisions?: RawDiagramRevision[];
  draft?: RawDiagramDraft;
};
type RawDiagramStoreSnapshot = Partial<DiagramStoreSnapshot> & {
  streams?: RawDiagramStream[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeNameInput = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
const normalizeNameKey = (value: string) => normalizeNameInput(value).toLowerCase();
export const slugifyDiagramName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const readDiagramNameFromRaw = (raw: string) => {
  try {
    return normalizeNameInput(parseSourceDocument(raw).metadata?.name);
  } catch {
    return '';
  }
};

const resolveDiagramDisplayName = (name: string | undefined, raw?: string) =>
  normalizeNameInput(name) || (raw ? readDiagramNameFromRaw(raw) : '') || DEFAULT_DIAGRAM_NAME;

const normalizeScope = (candidate: unknown): DiagramOwnerScope => {
  if (!isRecord(candidate)) return DEFAULT_DIAGRAM_OWNER_SCOPE;
  const kind = candidate.kind === 'team' ? 'team' : 'personal';
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : DEFAULT_DIAGRAM_OWNER_SCOPE.id;
  const label =
    typeof candidate.label === 'string' && candidate.label.trim().length > 0
      ? candidate.label.trim()
      : kind === 'team'
        ? 'Team'
        : DEFAULT_DIAGRAM_OWNER_SCOPE.label;
  return { kind, id, label };
};

const normalizeDraft = (candidate: RawDiagramDraft | undefined): DiagramDraft | undefined => {
  if (!candidate) return undefined;
  if (typeof candidate.raw !== 'string' || candidate.raw.trim().length === 0) return undefined;
  if (typeof candidate.updatedAt !== 'string' || candidate.updatedAt.trim().length === 0) {
    return undefined;
  }
  return {
    raw: candidate.raw,
    name: resolveDiagramDisplayName(
      typeof candidate.name === 'string' ? candidate.name : undefined,
      candidate.raw,
    ),
    baseRevisionId:
      typeof candidate.baseRevisionId === 'string' && candidate.baseRevisionId.trim().length > 0
        ? candidate.baseRevisionId
        : undefined,
    updatedAt: candidate.updatedAt,
    valid: candidate.valid === true,
  };
};

const normalizeRevision = (candidate: RawDiagramRevision): DiagramRevision | undefined => {
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) return undefined;
  if (typeof candidate.raw !== 'string' || candidate.raw.trim().length === 0) return undefined;
  if (
    typeof candidate.checkpointedAt !== 'string' ||
    candidate.checkpointedAt.trim().length === 0
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    name: resolveDiagramDisplayName(
      typeof candidate.name === 'string' ? candidate.name : undefined,
      candidate.raw,
    ),
    parentRevisionId:
      typeof candidate.parentRevisionId === 'string' && candidate.parentRevisionId.trim().length > 0
        ? candidate.parentRevisionId
        : undefined,
    raw: candidate.raw,
    checkpointedAt: candidate.checkpointedAt,
    valid: candidate.valid !== false,
    summaryLines: Array.isArray(candidate.summaryLines)
      ? candidate.summaryLines.filter(
          (line): line is string => typeof line === 'string' && line.trim().length > 0,
        )
      : [],
  };
};

const resolveStreamSlug = (
  candidate: RawDiagramStream,
  fallbackName: string,
  fallbackId: string,
) => {
  const explicitSlug =
    typeof candidate.slug === 'string' && candidate.slug.trim().length > 0
      ? candidate.slug.trim().toLowerCase()
      : '';
  return (
    explicitSlug || slugifyDiagramName(fallbackName) || slugifyDiagramName(fallbackId) || fallbackId
  );
};

const normalizeStream = (candidate: RawDiagramStream): DiagramStream | undefined => {
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) return undefined;
  const createdAt =
    typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0
      ? candidate.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim().length > 0
      ? candidate.updatedAt
      : createdAt;
  const revisions = Array.isArray(candidate.revisions)
    ? candidate.revisions
        .map((entry) => normalizeRevision(entry))
        .filter((entry): entry is DiagramRevision => Boolean(entry))
    : [];
  const headRevisionId =
    typeof candidate.headRevisionId === 'string' &&
    revisions.some((revision) => revision.id === candidate.headRevisionId)
      ? candidate.headRevisionId
      : revisions[revisions.length - 1]?.id;
  const draft = normalizeDraft(candidate.draft);
  return {
    id: candidate.id,
    name: resolveDiagramDisplayName(
      typeof candidate.name === 'string' ? candidate.name : draft?.name,
      draft?.raw ?? revisions[revisions.length - 1]?.raw,
    ),
    slug: resolveStreamSlug(
      candidate,
      resolveDiagramDisplayName(
        typeof candidate.name === 'string' ? candidate.name : draft?.name,
        draft?.raw ?? revisions[revisions.length - 1]?.raw,
      ),
      candidate.id,
    ),
    scope: normalizeScope(candidate.scope),
    createdAt,
    updatedAt,
    streamVersion:
      typeof candidate.streamVersion === 'number' &&
      Number.isFinite(candidate.streamVersion) &&
      candidate.streamVersion >= 1
        ? Math.floor(candidate.streamVersion)
        : 1,
    headRevisionId,
    draft,
    revisions,
  };
};

export const createEmptyDiagramStoreSnapshot = (): DiagramStoreSnapshot => ({
  streams: [],
});

export const normalizeDiagramStoreSnapshot = (candidate: unknown): DiagramStoreSnapshot => {
  if (!isRecord(candidate)) return createEmptyDiagramStoreSnapshot();
  const raw = candidate as RawDiagramStoreSnapshot;
  const streams = Array.isArray(raw.streams)
    ? raw.streams
        .map((stream) => normalizeStream(stream))
        .filter((stream): stream is DiagramStream => Boolean(stream))
    : [];
  const seenSlugs = new Set<string>();
  return {
    streams: streams.map((stream) => {
      let slug = stream.slug;
      let nonce = 2;
      while (seenSlugs.has(slug)) {
        slug = `${stream.slug}-${nonce}`;
        nonce += 1;
      }
      seenSlugs.add(slug);
      return slug === stream.slug ? stream : { ...stream, slug };
    }),
  };
};

export const resolveDiagramStreamName = (params: {
  snapshot: DiagramStoreSnapshot;
  name?: string;
  excludeStreamId?: string;
}) => resolveDiagramDisplayName(params.name);

export const findDiagramStreamByName = (params: {
  snapshot: DiagramStoreSnapshot;
  name: string;
  excludeStreamId?: string;
}) =>
  params.snapshot.streams.find(
    (stream) =>
      normalizeNameKey(stream.name) === normalizeNameKey(params.name) &&
      stream.id !== params.excludeStreamId,
  );

export const findDiagramStreamBySlug = (params: {
  snapshot: DiagramStoreSnapshot;
  slug: string;
  excludeStreamId?: string;
}) =>
  params.snapshot.streams.find(
    (stream) =>
      stream.slug === params.slug.trim().toLowerCase() && stream.id !== params.excludeStreamId,
  );

export const getDiagramHeadRevision = (stream: DiagramStream): DiagramRevision | undefined =>
  stream.headRevisionId
    ? stream.revisions.find((revision) => revision.id === stream.headRevisionId)
    : undefined;

export const getCurrentDiagramBaseRevisionId = (stream: DiagramStream) =>
  stream.draft?.baseRevisionId ?? stream.headRevisionId;

const replaceSnapshot = (
  storage: DiagramStoreStorageLike,
  storageKey: string,
  snapshot: DiagramStoreSnapshot,
) => {
  storage.setItem(storageKey, JSON.stringify(snapshot));
  return snapshot;
};

const replaceStream = (
  snapshot: DiagramStoreSnapshot,
  nextStream: DiagramStream,
): DiagramStoreSnapshot => ({
  streams: snapshot.streams.map((stream) => (stream.id === nextStream.id ? nextStream : stream)),
});

const ensureBaseRevisionMatches = (stream: DiagramStream, expectedBaseRevisionId?: string) => {
  if (expectedBaseRevisionId === undefined) return;
  if (getCurrentDiagramBaseRevisionId(stream) !== expectedBaseRevisionId) {
    throw new Error('Stale diagram base revision.');
  }
};

export interface DiagramStore {
  load(): DiagramStoreSnapshot;
  loadActiveDiagramId(): string | undefined;
  saveActiveDiagramId(id: string | undefined): void;
  createStream(params: {
    snapshot: DiagramStoreSnapshot;
    name?: string;
    slug?: string;
    raw: string;
    valid: boolean;
    baseRevisionId?: string;
    scope?: DiagramOwnerScope;
    now?: string;
  }): { snapshot: DiagramStoreSnapshot; stream: DiagramStream };
  saveDraft(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    name?: string;
    raw: string;
    valid: boolean;
    expectedBaseRevisionId?: string;
    now?: string;
  }): { snapshot: DiagramStoreSnapshot; stream: DiagramStream };
  checkpoint(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    name?: string;
    raw: string;
    valid: boolean;
    expectedBaseRevisionId?: string;
    summaryLines: string[];
    now?: string;
  }): { snapshot: DiagramStoreSnapshot; stream: DiagramStream; revision: DiagramRevision };
  restoreDraft(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    revisionId: string;
    now?: string;
  }): { snapshot: DiagramStoreSnapshot; stream: DiagramStream };
}

export class LocalDiagramStore implements DiagramStore {
  constructor(
    private readonly storage: DiagramStoreStorageLike,
    private readonly storageKey = DIAGRAM_STORE_STORAGE_KEY,
    private readonly activeDiagramStorageKey = ACTIVE_DIAGRAM_ID_STORAGE_KEY,
  ) {}

  load(): DiagramStoreSnapshot {
    const stored = this.storage.getItem(this.storageKey);
    let snapshot = createEmptyDiagramStoreSnapshot();
    if (stored) {
      try {
        snapshot = normalizeDiagramStoreSnapshot(JSON.parse(stored) as unknown);
      } catch {
        snapshot = createEmptyDiagramStoreSnapshot();
      }
    }
    replaceSnapshot(this.storage, this.storageKey, snapshot);
    return snapshot;
  }

  loadActiveDiagramId(): string | undefined {
    const stored = this.storage.getItem(this.activeDiagramStorageKey);
    return stored && stored.trim().length > 0 ? stored.trim() : undefined;
  }

  saveActiveDiagramId(id: string | undefined) {
    this.storage.setItem(this.activeDiagramStorageKey, id?.trim() ?? '');
  }

  createStream(params: {
    snapshot: DiagramStoreSnapshot;
    name?: string;
    slug?: string;
    raw: string;
    valid: boolean;
    baseRevisionId?: string;
    scope?: DiagramOwnerScope;
    now?: string;
  }) {
    const now = params.now ?? new Date().toISOString();
    const name = resolveDiagramDisplayName(params.name, params.raw);
    const requestedSlug = params.slug?.trim().toLowerCase();
    let slug =
      requestedSlug && requestedSlug.length > 0
        ? requestedSlug
        : slugifyDiagramName(name) || createId('diagram-slug');
    let nonce = 2;
    while (params.snapshot.streams.some((stream) => stream.slug === slug)) {
      slug = `${requestedSlug || slugifyDiagramName(name) || 'diagram'}-${nonce}`;
      nonce += 1;
    }
    const stream: DiagramStream = {
      id: createId('diagram'),
      name,
      slug,
      scope: params.scope ?? DEFAULT_DIAGRAM_OWNER_SCOPE,
      createdAt: now,
      updatedAt: now,
      streamVersion: 1,
      draft: {
        raw: params.raw,
        name,
        baseRevisionId: params.baseRevisionId,
        updatedAt: now,
        valid: params.valid,
      },
      revisions: [],
    };
    const nextSnapshot = {
      streams: [...params.snapshot.streams, stream],
    };
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, nextSnapshot),
      stream,
    };
  }

  saveDraft(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    name?: string;
    raw: string;
    valid: boolean;
    expectedBaseRevisionId?: string;
    now?: string;
  }) {
    const stream = params.snapshot.streams.find((entry) => entry.id === params.streamId);
    if (!stream) {
      throw new Error(`Unknown diagram stream ${params.streamId}`);
    }
    ensureBaseRevisionMatches(stream, params.expectedBaseRevisionId);
    const now = params.now ?? new Date().toISOString();
    const draftName = resolveDiagramDisplayName(params.name, params.raw);
    const nextStream: DiagramStream = {
      ...stream,
      updatedAt: now,
      streamVersion: stream.streamVersion + 1,
      draft: {
        raw: params.raw,
        name: draftName,
        baseRevisionId: params.expectedBaseRevisionId ?? getCurrentDiagramBaseRevisionId(stream),
        updatedAt: now,
        valid: params.valid,
      },
    };
    const nextSnapshot = replaceStream(params.snapshot, nextStream);
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, nextSnapshot),
      stream: nextStream,
    };
  }

  checkpoint(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    name?: string;
    raw: string;
    valid: boolean;
    expectedBaseRevisionId?: string;
    summaryLines: string[];
    now?: string;
  }) {
    const stream = params.snapshot.streams.find((entry) => entry.id === params.streamId);
    if (!stream) {
      throw new Error(`Unknown diagram stream ${params.streamId}`);
    }
    ensureBaseRevisionMatches(stream, params.expectedBaseRevisionId);
    const now = params.now ?? new Date().toISOString();
    const nextName = resolveDiagramDisplayName(params.name ?? stream.draft?.name, params.raw);
    const revision: DiagramRevision = {
      id: createId('revision'),
      name: nextName,
      parentRevisionId: stream.headRevisionId,
      raw: params.raw,
      checkpointedAt: now,
      valid: params.valid,
      summaryLines: params.summaryLines,
    };
    const nextStream: DiagramStream = {
      ...stream,
      name: nextName,
      headRevisionId: revision.id,
      updatedAt: now,
      streamVersion: stream.streamVersion + 1,
      revisions: [...stream.revisions, revision],
      draft: {
        raw: params.raw,
        name: nextName,
        baseRevisionId: revision.id,
        updatedAt: now,
        valid: params.valid,
      },
    };
    const nextSnapshot = replaceStream(params.snapshot, nextStream);
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, nextSnapshot),
      stream: nextStream,
      revision,
    };
  }

  restoreDraft(params: {
    snapshot: DiagramStoreSnapshot;
    streamId: string;
    revisionId: string;
    now?: string;
  }) {
    const stream = params.snapshot.streams.find((entry) => entry.id === params.streamId);
    if (!stream) {
      throw new Error(`Unknown diagram stream ${params.streamId}`);
    }
    const revision = stream.revisions.find((entry) => entry.id === params.revisionId);
    if (!revision) {
      throw new Error(`Unknown diagram revision ${params.revisionId}`);
    }
    const now = params.now ?? new Date().toISOString();
    const nextStream: DiagramStream = {
      ...stream,
      updatedAt: now,
      streamVersion: stream.streamVersion + 1,
      draft: {
        raw: revision.raw,
        name: revision.name,
        baseRevisionId: revision.id,
        updatedAt: now,
        valid: revision.valid,
      },
    };
    const nextSnapshot = replaceStream(params.snapshot, nextStream);
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, nextSnapshot),
      stream: nextStream,
    };
  }
}
