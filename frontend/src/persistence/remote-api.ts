import { getMe } from '../api/generated/auth/auth';
import {
  checkpointDiagramStream,
  createDiagramStream,
  getDiagramStream,
  listDiagramStreams,
  saveDiagramDraft,
} from '../api/generated/diagrams/diagrams';
import type {
  DtoDiagramStreamDetailResponse,
  DtoDiagramStreamSummaryResponse,
  DtoMeResponse,
  DtoSchemaStreamDetailResponse,
  DtoSchemaStreamSummaryResponse,
} from '../api/generated/model';
import {
  createSchemaStream,
  getSchemaStream,
  listSchemaStreams,
  publishSchemaVersion,
  saveSchemaDraft,
} from '../api/generated/schemas/schemas';
import type { DiagramStream } from '../model/diagram-store';
import type { UserSchemaStream } from '../model/personal-schema-registry';
import { sanitizeOptionalUuid } from '../util/uuid';
import { mapRemoteDiagramStream, mapRemoteUserSchemaStream } from './remote-mappers';

const readApiErrorMessage = (payload: unknown) => {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
    const error = record.error;
    if (typeof error === 'string' && error.trim().length > 0) {
      return error.trim();
    }
  }
  return undefined;
};

const toRequestOptions = (request?: RequestInit): RequestInit => request ?? {};

export class RemotePersistenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'RemotePersistenceError';
  }
}

export class RemoteDiagramDraftConflictError extends RemotePersistenceError {
  constructor(
    readonly latestStream?: DiagramStream,
    payload?: unknown,
  ) {
    super('Stale diagram stream version.', 409, payload);
    this.name = 'RemoteDiagramDraftConflictError';
  }
}

const assertStatus = <TResponse extends { data?: unknown; status: number }>(
  response: TResponse,
  allowedStatuses: number[],
  fallbackMessage: string,
) => {
  if (allowedStatuses.includes(response.status)) {
    return response;
  }
  throw new RemotePersistenceError(
    readApiErrorMessage(response.data) ?? fallbackMessage,
    response.status,
    response.data,
  );
};

const requireDiagramStream = (stream: DtoDiagramStreamDetailResponse, fallbackMessage: string) => {
  const mapped = mapRemoteDiagramStream(stream);
  if (!mapped) {
    throw new Error(fallbackMessage);
  }
  return mapped;
};

const requireSchemaStream = (stream: DtoSchemaStreamDetailResponse, fallbackMessage: string) => {
  const mapped = mapRemoteUserSchemaStream(stream);
  if (!mapped) {
    throw new Error(fallbackMessage);
  }
  return mapped;
};

export interface DiagramDraftSavePayload {
  name: string;
  raw: string;
  valid: boolean;
  baseRevisionId?: string;
}

export interface SaveRemoteDiagramDraftResult {
  savedRemotely: boolean;
  stream: DiagramStream;
}

export const fetchCurrentMember = async (request?: RequestInit): Promise<DtoMeResponse> => {
  const response = assertStatus(
    await getMe(toRequestOptions(request)),
    [200],
    'Failed to load current member.',
  );
  return response.data;
};

export const listRemoteDiagramStreamSummaries = async (
  request?: RequestInit,
): Promise<DtoDiagramStreamSummaryResponse[]> => {
  const response = assertStatus(
    await listDiagramStreams(toRequestOptions(request)),
    [200],
    'Failed to list diagram streams.',
  );
  return response.data as DtoDiagramStreamSummaryResponse[];
};

export const listRemoteSchemaStreamSummaries = async (
  request?: RequestInit,
): Promise<DtoSchemaStreamSummaryResponse[]> => {
  const response = assertStatus(
    await listSchemaStreams(toRequestOptions(request)),
    [200],
    'Failed to list schema streams.',
  );
  return response.data as DtoSchemaStreamSummaryResponse[];
};

export const getRemoteDiagramStream = async (
  streamId: string,
  request?: RequestInit,
): Promise<DiagramStream> => {
  const response = assertStatus(
    await getDiagramStream(streamId, toRequestOptions(request)),
    [200],
    'Failed to load diagram stream.',
  );
  return requireDiagramStream(response.data, 'Diagram stream response was incomplete.');
};

export const createRemoteDiagramStream = async (
  payload: DiagramDraftSavePayload,
  request?: RequestInit,
): Promise<DiagramStream> => {
  const response = assertStatus(
    await createDiagramStream(
      {
        name: payload.name,
        raw: payload.raw,
        valid: payload.valid,
      },
      toRequestOptions(request),
    ),
    [201],
    'Failed to create diagram stream.',
  );
  return requireDiagramStream(response.data, 'Created diagram stream response was incomplete.');
};

export const checkpointRemoteDiagram = async (
  stream: DiagramStream,
  payload: DiagramDraftSavePayload & { summaryLines?: string[] },
  request?: RequestInit,
): Promise<DiagramStream> => {
  const expectedBaseRevisionId = sanitizeOptionalUuid(payload.baseRevisionId);
  const response = assertStatus(
    await checkpointDiagramStream(
      stream.id,
      {
        name: payload.name,
        raw: payload.raw,
        valid: payload.valid,
        expectedBaseRevisionId,
        expectedStreamVersion: stream.streamVersion,
        summaryLines: payload.summaryLines ?? [],
      },
      toRequestOptions(request),
    ),
    [201],
    'Failed to checkpoint diagram stream.',
  );
  return requireDiagramStream(
    response.data,
    'Checkpointed diagram stream response was incomplete.',
  );
};

export const hasSameRemoteDiagramDraft = (
  stream: DiagramStream,
  payload: DiagramDraftSavePayload,
) =>
  stream.draft?.raw === payload.raw &&
  stream.draft.valid === payload.valid &&
  stream.draft.baseRevisionId === payload.baseRevisionId &&
  stream.draft.name === payload.name;

export const saveRemoteDiagramDraftIfChanged = async (
  stream: DiagramStream,
  payload: DiagramDraftSavePayload,
  request?: RequestInit,
): Promise<SaveRemoteDiagramDraftResult> => {
  if (hasSameRemoteDiagramDraft(stream, payload)) {
    return {
      savedRemotely: false,
      stream,
    };
  }

  const expectedBaseRevisionId = sanitizeOptionalUuid(payload.baseRevisionId);
  const response = await saveDiagramDraft(
    stream.id,
    {
      name: payload.name,
      raw: payload.raw,
      valid: payload.valid,
      expectedBaseRevisionId,
      expectedStreamVersion: stream.streamVersion,
    },
    toRequestOptions(request),
  );

  if (response.status === 200) {
    return {
      savedRemotely: true,
      stream: requireDiagramStream(response.data, 'Saved diagram stream response was incomplete.'),
    };
  }

  if (response.status === 409) {
    let latestStream: DiagramStream | undefined;
    try {
      latestStream = await getRemoteDiagramStream(stream.id, request);
    } catch {
      latestStream = undefined;
    }
    throw new RemoteDiagramDraftConflictError(latestStream, response.data);
  }

  throw new RemotePersistenceError(
    readApiErrorMessage(response.data) ?? 'Failed to save diagram draft.',
    response.status,
    response.data,
  );
};

export const getRemoteSchemaStream = async (
  name: string,
  request?: RequestInit,
): Promise<UserSchemaStream> => {
  const response = assertStatus(
    await getSchemaStream(name, toRequestOptions(request)),
    [200],
    'Failed to load schema stream.',
  );
  return requireSchemaStream(response.data, 'Schema stream response was incomplete.');
};

export const createRemoteSchemaStream = async (
  payload: {
    name: string;
    raw: string;
    valid: boolean;
    baseVersion?: string;
  },
  request?: RequestInit,
): Promise<UserSchemaStream> => {
  const response = assertStatus(
    await createSchemaStream(
      {
        name: payload.name,
        raw: payload.raw,
        valid: payload.valid,
        baseVersion: payload.baseVersion,
      },
      toRequestOptions(request),
    ),
    [201],
    'Failed to create schema stream.',
  );
  return requireSchemaStream(response.data, 'Created schema stream response was incomplete.');
};

export const saveRemoteSchemaDraft = async (
  stream: UserSchemaStream,
  payload: {
    raw: string;
    valid: boolean;
    baseVersion?: string;
  },
  request?: RequestInit,
): Promise<UserSchemaStream> => {
  const response = assertStatus(
    await saveSchemaDraft(
      stream.name,
      {
        raw: payload.raw,
        valid: payload.valid,
        baseVersion: payload.baseVersion,
        expectedStreamVersion: stream.streamVersion,
      },
      toRequestOptions(request),
    ),
    [200],
    'Failed to save schema draft.',
  );
  return requireSchemaStream(response.data, 'Saved schema stream response was incomplete.');
};

export const publishRemoteSchemaVersion = async (
  stream: UserSchemaStream,
  payload: {
    raw: string;
    version: string;
    assessment?: unknown;
  },
  request?: RequestInit,
): Promise<UserSchemaStream> => {
  const response = assertStatus(
    await publishSchemaVersion(
      stream.name,
      {
        raw: payload.raw,
        version: payload.version,
        assessment: payload.assessment as number[] | undefined,
        expectedStreamVersion: stream.streamVersion,
      },
      toRequestOptions(request),
    ),
    [201],
    'Failed to publish schema version.',
  );
  return requireSchemaStream(response.data, 'Published schema stream response was incomplete.');
};
