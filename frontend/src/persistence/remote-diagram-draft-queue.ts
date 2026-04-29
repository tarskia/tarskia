import type { DiagramStream } from '../model/diagram-store';
import type { DiagramDraftSavePayload, SaveRemoteDiagramDraftResult } from './remote-api';
import { RemoteDiagramDraftConflictError } from './remote-api';

export interface RemoteDiagramDraftSaveQueue {
  enqueue: (streamId: string, payload: DiagramDraftSavePayload) => void;
  whenIdle: (streamId: string) => Promise<void>;
}

interface QueueState {
  inFlight: boolean;
  pending?: DiagramDraftSavePayload;
  idleResolvers: Array<() => void>;
}

export interface CreateRemoteDiagramDraftSaveQueueOptions {
  applyOptimisticDraft?: (streamId: string, payload: DiagramDraftSavePayload) => void;
  getStream: (streamId: string) => DiagramStream | undefined;
  onConflict: (streamId: string, latestStream?: DiagramStream) => void;
  onError: (message: string) => void;
  onSaved: (stream: DiagramStream) => void;
  saveDraft: (
    stream: DiagramStream,
    payload: DiagramDraftSavePayload,
  ) => Promise<SaveRemoteDiagramDraftResult>;
}

const createQueueState = (): QueueState => ({
  inFlight: false,
  idleResolvers: [],
});

export const createRemoteDiagramDraftSaveQueue = (
  options: CreateRemoteDiagramDraftSaveQueueOptions,
): RemoteDiagramDraftSaveQueue => {
  const queueByStreamId = new Map<string, QueueState>();
  const authoritativeStreamById = new Map<string, DiagramStream>();

  const getQueueState = (streamId: string) => {
    const existing = queueByStreamId.get(streamId);
    if (existing) {
      return existing;
    }
    const created = createQueueState();
    queueByStreamId.set(streamId, created);
    return created;
  };

  const resolveIdle = (streamId: string) => {
    const entry = getQueueState(streamId);
    if (entry.inFlight || entry.pending) {
      return;
    }
    const resolvers = entry.idleResolvers.splice(0, entry.idleResolvers.length);
    for (const resolve of resolvers) {
      resolve();
    }
  };

  const getAuthoritativeStream = (streamId: string) => {
    const current = options.getStream(streamId);
    const authoritative = authoritativeStreamById.get(streamId);
    if (!current) {
      return authoritative;
    }
    if (!authoritative || current.streamVersion > authoritative.streamVersion) {
      authoritativeStreamById.set(streamId, current);
      return current;
    }
    return authoritative;
  };

  const flush = async (streamId: string) => {
    const entry = getQueueState(streamId);
    if (entry.inFlight) {
      return;
    }

    entry.inFlight = true;
    try {
      while (entry.pending) {
        const payload = entry.pending;
        entry.pending = undefined;
        const stream = getAuthoritativeStream(streamId);
        if (!stream) {
          continue;
        }

        try {
          const result = await options.saveDraft(stream, payload);
          if (result.savedRemotely) {
            authoritativeStreamById.set(streamId, result.stream);
            options.onSaved(result.stream);
          }
        } catch (error) {
          if (error instanceof RemoteDiagramDraftConflictError) {
            if (error.latestStream) {
              authoritativeStreamById.set(streamId, error.latestStream);
            }
            options.onConflict(streamId, error.latestStream);
            entry.pending = undefined;
            break;
          }

          const message = error instanceof Error ? error.message : 'Draft autosave failed.';
          options.onError(message);
          entry.pending = undefined;
          break;
        }
      }
    } finally {
      entry.inFlight = false;
      resolveIdle(streamId);
    }
  };

  return {
    enqueue(streamId, payload) {
      getAuthoritativeStream(streamId);
      const entry = getQueueState(streamId);
      entry.pending = payload;
      options.applyOptimisticDraft?.(streamId, payload);
      void flush(streamId);
    },
    whenIdle(streamId) {
      const entry = getQueueState(streamId);
      if (!entry.inFlight && !entry.pending) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        entry.idleResolvers.push(resolve);
      });
    },
  };
};
