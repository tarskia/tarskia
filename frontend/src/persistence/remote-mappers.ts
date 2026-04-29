import type {
  DtoDiagramRevisionDetailResponse,
  DtoDiagramStreamDetailResponse,
  DtoSchemaStreamDetailResponse,
} from '../api/generated/model';
import {
  DEFAULT_DIAGRAM_OWNER_SCOPE,
  type DiagramOwnerScope,
  type DiagramRevision,
  type DiagramStoreSnapshot,
  type DiagramStream,
  normalizeDiagramStoreSnapshot,
  slugifyDiagramName,
} from '../model/diagram-store';
import type { UserSchemaStoreSnapshot, UserSchemaStream } from '../model/personal-schema-registry';
import { normalizeUserSchemaStoreSnapshot } from '../model/personal-schema-registry';
import type { SchemaPublishAssessmentSnapshot } from '../model/validation/schema-publish';

const FALLBACK_TIMESTAMP = new Date(0).toISOString();

const toDiagramScope = (scopeKind?: string): DiagramOwnerScope =>
  scopeKind === 'team' ? { kind: 'team', id: 'team', label: 'Team' } : DEFAULT_DIAGRAM_OWNER_SCOPE;

const toDiagramRevision = (
  revision: DtoDiagramRevisionDetailResponse,
): DiagramRevision | undefined => {
  if (!revision.id || !revision.raw || !revision.checkpointedAt) {
    return undefined;
  }

  return {
    id: revision.id,
    name: revision.name || '',
    parentRevisionId: revision.parentRevisionId || undefined,
    raw: revision.raw,
    checkpointedAt: revision.checkpointedAt,
    valid: revision.valid !== false,
    summaryLines: Array.isArray(revision.summaryLines)
      ? revision.summaryLines.filter((line): line is string => typeof line === 'string')
      : [],
  };
};

const parseAssessment = (assessment: unknown): SchemaPublishAssessmentSnapshot | undefined => {
  if (!assessment) return undefined;
  if (
    typeof assessment === 'object' &&
    assessment !== null &&
    Array.isArray((assessment as { summaryLines?: unknown }).summaryLines)
  ) {
    return {
      summaryLines: (assessment as { summaryLines: unknown[] }).summaryLines.filter(
        (line): line is string => typeof line === 'string' && line.trim().length > 0,
      ),
    };
  }
  if (typeof assessment === 'string') {
    try {
      return parseAssessment(JSON.parse(assessment));
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(assessment) && assessment.every((value) => typeof value === 'number')) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(assessment));
      return parseAssessment(decoded);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const mapRemoteDiagramStream = (
  stream: DtoDiagramStreamDetailResponse,
): DiagramStream | undefined => {
  if (!stream.id || !stream.name) {
    return undefined;
  }

  return {
    id: stream.id,
    name: stream.name,
    slug: (slugifyDiagramName(stream.name || '') || stream.id).toLowerCase(),
    scope: toDiagramScope(stream.scopeKind),
    createdAt: stream.createdAt || FALLBACK_TIMESTAMP,
    updatedAt: stream.updatedAt || stream.createdAt || FALLBACK_TIMESTAMP,
    streamVersion: Math.max(1, Math.floor(stream.streamVersion ?? 1)),
    headRevisionId: stream.revisions?.[stream.revisions.length - 1]?.id || undefined,
    draft:
      stream.draft?.raw && stream.draft.updatedAt
        ? {
            raw: stream.draft.raw,
            name: stream.draft.name || stream.name,
            baseRevisionId: stream.draft.baseRevisionId || undefined,
            updatedAt: stream.draft.updatedAt,
            valid: stream.draft.valid === true,
          }
        : undefined,
    revisions:
      stream.revisions
        ?.map((revision) => toDiagramRevision(revision))
        .filter((revision): revision is DiagramRevision => Boolean(revision)) ?? [],
  };
};

export const mapRemoteDiagramSnapshot = (
  streams: DtoDiagramStreamDetailResponse[],
): DiagramStoreSnapshot =>
  normalizeDiagramStoreSnapshot({
    streams: streams
      .map((stream) => mapRemoteDiagramStream(stream))
      .filter((stream): stream is DiagramStream => Boolean(stream)),
  });

export const mapRemoteUserSchemaStream = (
  stream: DtoSchemaStreamDetailResponse,
): UserSchemaStream | undefined => {
  if (!stream.name) {
    return undefined;
  }

  return {
    owner: 'user',
    name: stream.name,
    createdAt: stream.createdAt || FALLBACK_TIMESTAMP,
    updatedAt: stream.updatedAt || stream.createdAt || FALLBACK_TIMESTAMP,
    streamVersion: Math.max(1, Math.floor(stream.streamVersion ?? 1)),
    versions:
      stream.versions
        ?.filter((version): version is NonNullable<typeof version> => Boolean(version))
        .flatMap((version) => {
          if (!version.version || !version.raw || !version.publishedAt) {
            return [];
          }
          return [
            {
              version: version.version,
              raw: version.raw,
              publishedAt: version.publishedAt,
              assessment: parseAssessment(version.assessment),
            },
          ];
        }) ?? [],
    draft:
      stream.draft?.raw && stream.draft.updatedAt
        ? {
            raw: stream.draft.raw,
            baseVersion: stream.draft.baseVersion || undefined,
            valid: stream.draft.valid === true,
            updatedAt: stream.draft.updatedAt,
          }
        : undefined,
  };
};

export const mapRemoteUserSchemaSnapshot = (
  streams: DtoSchemaStreamDetailResponse[],
): UserSchemaStoreSnapshot =>
  normalizeUserSchemaStoreSnapshot({
    version: 1,
    streams: streams
      .map((stream) => mapRemoteUserSchemaStream(stream))
      .filter((stream): stream is UserSchemaStream => Boolean(stream)),
  });
