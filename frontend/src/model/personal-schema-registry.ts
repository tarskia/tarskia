import { JSON_SCHEMA, load } from 'js-yaml';

import { parseSchema } from '../util/serialization';
import { buildSchemaId } from './schema-ref';
import type { SchemaModule } from './types';
import type { SchemaPublishAssessmentSnapshot } from './validation/schema-publish';

export const USER_SCHEMA_STORE_STORAGE_KEY = 'semantic-diagram-user-schema-store-v0.1';

export interface UserSchemaVersionRecord {
  version: string;
  raw: string;
  publishedAt: string;
  assessment?: SchemaPublishAssessmentSnapshot;
}

export interface UserSchemaDraftRecord {
  raw: string;
  baseVersion?: string;
  valid: boolean;
  updatedAt: string;
}

export interface UserSchemaStream {
  owner: 'user';
  name: string;
  createdAt: string;
  updatedAt: string;
  streamVersion: number;
  versions: UserSchemaVersionRecord[];
  draft?: UserSchemaDraftRecord;
}

export interface UserSchemaStoreSnapshot {
  version: 1;
  streams: UserSchemaStream[];
}

export interface UserSchemaStoreStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

type RawUserSchemaVersionRecord = Partial<UserSchemaVersionRecord>;
type RawUserSchemaDraftRecord = Partial<UserSchemaDraftRecord>;
type RawUserSchemaStream = Partial<UserSchemaStream> & {
  versions?: RawUserSchemaVersionRecord[];
  draft?: RawUserSchemaDraftRecord;
};
type RawUserSchemaStoreSnapshot = Partial<UserSchemaStoreSnapshot> & {
  streams?: RawUserSchemaStream[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const slugifySchemaName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeSchemaName = (value: string) => value.trim().toLowerCase();

const normalizeVersionRecord = (
  candidate: RawUserSchemaVersionRecord,
): UserSchemaVersionRecord | undefined => {
  if (typeof candidate.version !== 'string' || candidate.version.trim().length === 0) {
    return undefined;
  }
  if (typeof candidate.raw !== 'string' || candidate.raw.trim().length === 0) return undefined;
  if (typeof candidate.publishedAt !== 'string' || candidate.publishedAt.trim().length === 0) {
    return undefined;
  }
  return {
    version: candidate.version,
    raw: candidate.raw,
    publishedAt: candidate.publishedAt,
    assessment:
      isRecord(candidate.assessment) && Array.isArray(candidate.assessment.summaryLines)
        ? {
            summaryLines: candidate.assessment.summaryLines
              .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
              .map((line) => line.trim()),
          }
        : undefined,
  };
};

const normalizeDraftRecord = (
  candidate: RawUserSchemaDraftRecord | undefined,
): UserSchemaDraftRecord | undefined => {
  if (!candidate) return undefined;
  if (typeof candidate.raw !== 'string' || candidate.raw.trim().length === 0) return undefined;
  if (typeof candidate.updatedAt !== 'string' || candidate.updatedAt.trim().length === 0) {
    return undefined;
  }
  return {
    raw: candidate.raw,
    baseVersion:
      typeof candidate.baseVersion === 'string' && candidate.baseVersion.trim().length > 0
        ? candidate.baseVersion
        : undefined,
    valid: candidate.valid === true,
    updatedAt: candidate.updatedAt,
  };
};

const normalizeStream = (candidate: RawUserSchemaStream): UserSchemaStream | undefined => {
  if (candidate.owner !== 'user') return undefined;
  if (typeof candidate.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name)) {
    return undefined;
  }

  const createdAt =
    typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0
      ? candidate.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim().length > 0
      ? candidate.updatedAt
      : createdAt;

  return {
    owner: 'user',
    name: candidate.name,
    createdAt,
    updatedAt,
    streamVersion:
      typeof candidate.streamVersion === 'number' &&
      Number.isFinite(candidate.streamVersion) &&
      candidate.streamVersion >= 1
        ? Math.floor(candidate.streamVersion)
        : 1,
    versions: Array.isArray(candidate.versions)
      ? candidate.versions
          .map((entry) => normalizeVersionRecord(entry))
          .filter((entry): entry is UserSchemaVersionRecord => Boolean(entry))
      : [],
    draft: normalizeDraftRecord(candidate.draft),
  };
};

export function createEmptyUserSchemaStoreSnapshot(): UserSchemaStoreSnapshot {
  return {
    version: 1,
    streams: [],
  };
}

export function normalizeUserSchemaStoreSnapshot(candidate: unknown): UserSchemaStoreSnapshot {
  if (!isRecord(candidate)) return createEmptyUserSchemaStoreSnapshot();
  const raw = candidate as RawUserSchemaStoreSnapshot;
  const streams = Array.isArray(raw.streams)
    ? raw.streams
        .map((entry) => normalizeStream(entry))
        .filter((entry): entry is UserSchemaStream => Boolean(entry))
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  return {
    version: 1,
    streams,
  };
}

export const getUserSchemaRef = (stream: Pick<UserSchemaStream, 'owner' | 'name'>) =>
  buildSchemaId({ owner: stream.owner, name: stream.name });

export function suggestUserSchemaName(raw: string): string {
  try {
    const parsed = load(raw, { schema: JSON_SCHEMA });
    if (!isRecord(parsed)) return 'draft-schema';
    const pick = (entries: unknown, field: 'label' | 'id') =>
      Array.isArray(entries)
        ? entries.find(
            (entry) =>
              isRecord(entry) && typeof entry[field] === 'string' && entry[field].trim().length > 0,
          )
        : undefined;
    const type = pick(parsed.types, 'id') ?? pick(parsed.types, 'label');
    if (type && isRecord(type)) {
      return slugifySchemaName(String(type.id ?? type.label)) || 'draft-schema';
    }
    const trait = pick(parsed.traits, 'id') ?? pick(parsed.traits, 'label');
    if (trait && isRecord(trait)) {
      return slugifySchemaName(String(trait.id ?? trait.label)) || 'draft-schema';
    }
    const relation = pick(parsed.relations, 'id') ?? pick(parsed.relations, 'label');
    if (relation && isRecord(relation)) {
      return slugifySchemaName(String(relation.id ?? relation.label)) || 'draft-schema';
    }
  } catch {
    return 'draft-schema';
  }
  return 'draft-schema';
}

export function parseTwoPartVersion(version: string): { major: number; minor: number } | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 1 || minor < 0) {
    return undefined;
  }
  return { major, minor };
}

export type SchemaVersionBump = 'none' | 'minor' | 'major';

export function getNextTwoPartVersion(
  currentVersion: string | undefined,
  bump: SchemaVersionBump,
): string | undefined {
  if (bump === 'none') return undefined;
  if (!currentVersion) return '1.0';
  const parsed = parseTwoPartVersion(currentVersion);
  if (!parsed) return undefined;
  if (bump === 'major') {
    return `${parsed.major + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor + 1}`;
}

const sortVersionsDescending = (left: string, right: string) => {
  const leftParsed = parseTwoPartVersion(left);
  const rightParsed = parseTwoPartVersion(right);
  if (!leftParsed || !rightParsed) {
    return right.localeCompare(left);
  }
  if (leftParsed.major !== rightParsed.major) {
    return rightParsed.major - leftParsed.major;
  }
  return rightParsed.minor - leftParsed.minor;
};

export function getLatestPublishedVersion(
  stream: UserSchemaStream,
): UserSchemaVersionRecord | undefined {
  return [...stream.versions].sort((left, right) =>
    sortVersionsDescending(left.version, right.version),
  )[0];
}

export function findUserSchemaStreamByName(params: {
  snapshot: UserSchemaStoreSnapshot;
  name: string;
  excludeName?: string;
}): UserSchemaStream | undefined {
  const normalizedName = normalizeSchemaName(params.name);
  if (normalizedName.length === 0) return undefined;
  return params.snapshot.streams.find(
    (stream) =>
      normalizeSchemaName(stream.name) === normalizedName &&
      normalizeSchemaName(stream.name) !== normalizeSchemaName(params.excludeName ?? ''),
  );
}

const replaceSnapshot = (
  storage: UserSchemaStoreStorageLike,
  storageKey: string,
  snapshot: UserSchemaStoreSnapshot,
) => {
  storage.setItem(storageKey, JSON.stringify(snapshot));
  return snapshot;
};

export interface CreateUserSchemaStreamResult {
  snapshot: UserSchemaStoreSnapshot;
  stream: UserSchemaStream;
}

export interface DeleteUserSchemaStreamResult {
  snapshot: UserSchemaStoreSnapshot;
  deletedStream?: UserSchemaStream;
  deletedIndex: number;
}

export interface UserSchemaStore {
  load(): UserSchemaStoreSnapshot;
  saveDraftAsNew(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    valid: boolean;
    baseVersion?: string;
    now?: string;
  }): CreateUserSchemaStreamResult;
  saveDraft(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    valid: boolean;
    baseVersion?: string;
    now?: string;
  }): UserSchemaStoreSnapshot;
  publish(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    version: string;
    assessment?: SchemaPublishAssessmentSnapshot;
    now?: string;
  }): UserSchemaStoreSnapshot;
  deleteStream(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
  }): DeleteUserSchemaStreamResult;
  restoreStream(params: {
    snapshot: UserSchemaStoreSnapshot;
    stream: UserSchemaStream;
    index?: number;
  }): UserSchemaStoreSnapshot;
}

export class LocalUserSchemaStore implements UserSchemaStore {
  constructor(
    private readonly storage: UserSchemaStoreStorageLike,
    private readonly storageKey = USER_SCHEMA_STORE_STORAGE_KEY,
  ) {}

  load(): UserSchemaStoreSnapshot {
    const stored = this.storage.getItem(this.storageKey);
    if (!stored) {
      const next = createEmptyUserSchemaStoreSnapshot();
      return replaceSnapshot(this.storage, this.storageKey, next);
    }
    try {
      const next = normalizeUserSchemaStoreSnapshot(JSON.parse(stored));
      return replaceSnapshot(this.storage, this.storageKey, next);
    } catch {
      const next = createEmptyUserSchemaStoreSnapshot();
      return replaceSnapshot(this.storage, this.storageKey, next);
    }
  }

  saveDraftAsNew(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    valid: boolean;
    baseVersion?: string;
    now?: string;
  }): CreateUserSchemaStreamResult {
    const name = slugifySchemaName(params.name) || suggestUserSchemaName(params.raw);
    const existing = findUserSchemaStreamByName({
      snapshot: params.snapshot,
      name,
    });
    if (existing) {
      throw new Error(`A schema named "${name}" already exists.`);
    }

    const now = params.now ?? new Date().toISOString();
    const stream: UserSchemaStream = {
      owner: 'user',
      name,
      createdAt: now,
      updatedAt: now,
      streamVersion: 1,
      versions: [],
      draft: {
        raw: params.raw,
        valid: params.valid,
        baseVersion: params.baseVersion,
        updatedAt: now,
      },
    };
    const next = {
      ...params.snapshot,
      streams: [...params.snapshot.streams, stream].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, next),
      stream,
    };
  }

  saveDraft(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    valid: boolean;
    baseVersion?: string;
    now?: string;
  }): UserSchemaStoreSnapshot {
    const name = slugifySchemaName(params.name) || suggestUserSchemaName(params.raw);
    const now = params.now ?? new Date().toISOString();
    const existing = findUserSchemaStreamByName({ snapshot: params.snapshot, name });
    if (existing) {
      const next = {
        ...params.snapshot,
        streams: params.snapshot.streams.map((stream) =>
          stream.name === existing.name
            ? {
                ...stream,
                updatedAt: now,
                streamVersion: stream.streamVersion + 1,
                draft: {
                  raw: params.raw,
                  valid: params.valid,
                  baseVersion: params.baseVersion,
                  updatedAt: now,
                },
              }
            : stream,
        ),
      };
      return replaceSnapshot(this.storage, this.storageKey, next);
    }
    return this.saveDraftAsNew(params).snapshot;
  }

  publish(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
    raw: string;
    version: string;
    assessment?: SchemaPublishAssessmentSnapshot;
    now?: string;
  }): UserSchemaStoreSnapshot {
    const name = slugifySchemaName(params.name) || suggestUserSchemaName(params.raw);
    const now = params.now ?? new Date().toISOString();
    const existing = findUserSchemaStreamByName({ snapshot: params.snapshot, name });
    if (!existing) {
      const stream: UserSchemaStream = {
        owner: 'user',
        name,
        createdAt: now,
        updatedAt: now,
        streamVersion: 1,
        versions: [
          {
            version: params.version,
            raw: params.raw,
            publishedAt: now,
            assessment: params.assessment,
          },
        ],
        draft: undefined,
      };
      return replaceSnapshot(this.storage, this.storageKey, {
        ...params.snapshot,
        streams: [...params.snapshot.streams, stream].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      });
    }

    const next = {
      ...params.snapshot,
      streams: params.snapshot.streams.map((stream) =>
        stream.name === existing.name
          ? {
              ...stream,
              updatedAt: now,
              streamVersion: stream.streamVersion + 1,
              versions: [
                ...stream.versions.filter((entry) => entry.version !== params.version),
                {
                  version: params.version,
                  raw: params.raw,
                  publishedAt: now,
                  assessment: params.assessment,
                },
              ].sort((left, right) => sortVersionsDescending(left.version, right.version)),
              draft: undefined,
            }
          : stream,
      ),
    };
    return replaceSnapshot(this.storage, this.storageKey, next);
  }

  deleteStream(params: {
    snapshot: UserSchemaStoreSnapshot;
    name: string;
  }): DeleteUserSchemaStreamResult {
    const name = slugifySchemaName(params.name);
    const deletedIndex = params.snapshot.streams.findIndex((stream) => stream.name === name);
    if (deletedIndex < 0) {
      return {
        snapshot: params.snapshot,
        deletedIndex: -1,
      };
    }
    const deletedStream = params.snapshot.streams[deletedIndex];
    const next = {
      ...params.snapshot,
      streams: params.snapshot.streams.filter((stream) => stream.name !== name),
    };
    return {
      snapshot: replaceSnapshot(this.storage, this.storageKey, next),
      deletedStream,
      deletedIndex,
    };
  }

  restoreStream(params: {
    snapshot: UserSchemaStoreSnapshot;
    stream: UserSchemaStream;
    index?: number;
  }): UserSchemaStoreSnapshot {
    const nextStreams = [...params.snapshot.streams];
    const normalizedIndex =
      typeof params.index === 'number' && params.index >= 0 && params.index <= nextStreams.length
        ? params.index
        : nextStreams.length;
    nextStreams.splice(normalizedIndex, 0, params.stream);
    return replaceSnapshot(this.storage, this.storageKey, {
      ...params.snapshot,
      streams: nextStreams,
    });
  }
}

export function getPublishedSchemaModules(snapshot: UserSchemaStoreSnapshot): Array<{
  stream: UserSchemaStream;
  version: UserSchemaVersionRecord;
  module: SchemaModule;
}> {
  return snapshot.streams.flatMap((stream) =>
    stream.versions.map((version) => ({
      stream,
      version,
      module: {
        ...parseSchema(version.raw),
        owner: 'user',
        name: stream.name,
        version: version.version,
      },
    })),
  );
}

export const createLocalUserSchemaStore = (storage: UserSchemaStoreStorageLike) =>
  new LocalUserSchemaStore(storage);
