import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  checkpointDiagramStream,
  createDiagramStream,
  restoreDiagramDraft,
  saveDiagramDraft,
} from '../api/generated/diagrams/diagrams';
import {
  createSchemaStream,
  deleteSchemaStream,
  publishSchemaVersion,
  saveSchemaDraft,
} from '../api/generated/schemas/schemas';
import { type AnimationSettings, cloneAnimationSettings } from '../diagram/animation-settings';
import { isNodeVisualMode, type NodeVisualMode } from '../node-visual-mode';
import { saveRemoteDiagramDraftIfChanged } from '../persistence/remote-api';
import { createRemoteDiagramDraftSaveQueue } from '../persistence/remote-diagram-draft-queue';
import { mapRemoteDiagramStream, mapRemoteUserSchemaStream } from '../persistence/remote-mappers';
import {
  getGuestStorageNamespace,
  getScopedStorageKeys,
  getUserStorageNamespace,
  migrateLegacyGuestStorage,
} from '../persistence/storage-keys';
import type { RemoteWorkspaceState } from '../persistence/useRemoteWorkspace';
import type { Entity, SemanticDocument } from '../semantic';
import {
  buildDiagramCheckpointSummary,
  buildDiagramViewForSearchReveal,
  buildSchemaId,
  buildSchemaVersionCatalog,
  CORE_GROUP_TYPE_ID,
  commitHistory,
  compileDiagramViewState,
  createEmptyDiagramStoreSnapshot,
  createHistory,
  DEFAULT_DIAGRAM_OWNER_SCOPE,
  type DiagramStoreSnapshot,
  type DiagramStream,
  type DocumentHistory,
  diagnosticsToMessages,
  findUserSchemaStreamByName,
  getCurrentDiagramBaseRevisionId,
  getDiagramHeadRevision,
  getLatestPublishedVersion,
  getNextTwoPartVersion,
  getPublishedSchemaModules,
  getSchemaObjectLocalId,
  getUserSchemaRef,
  hasMeaningfulDiagramCheckpointChanges,
  LocalDiagramStore,
  LocalSchemaEditorSessionStore,
  LocalUserSchemaStore,
  parseAndValidateSchemaModule,
  parseSchemaRef,
  parseSemanticSourceDocument,
  parseTwoPartVersion,
  redoHistory,
  resolveDiagramStreamName,
  resolveTypeDef,
  schemaReferenceSections,
  searchDiagramText,
  serializeDocument,
  serializeSourceDocument,
  slugifyDiagramName,
  slugifySchemaName,
  suggestUserSchemaName,
  traitMatches,
  typeMatches,
  type UserSchemaStoreSnapshot,
  type UserSchemaStream,
  undoHistory,
  useDiagramSemanticRuntime,
} from '../semantic';
import { semanticBootstrap } from '../semantic/bootstrap';
import type { AppSession } from '../session/useAppSession';
import { sanitizeOptionalUuid } from '../util/uuid';
import { buildPaletteViewModel } from './buildPaletteViewModel';
import { buildSchemaOptionViews } from './buildToolbarViewModels';
import { reconcileBundledStarterArtifacts } from './bundled-starter-reconciliation';
import { ensureDiagramView } from './diagram-view';
import type { FailedPreparedImportedDiagram } from './imported-diagram';
import { prepareImportedDiagram } from './imported-diagram';
import {
  createBlankDiagramDocument,
  type LoadedDiagramDoc,
  loadDiagramDocFromRaw,
} from './loadDiagramDocFromRaw';
import {
  canRedoNewDiagramTransition,
  canUndoNewDiagramTransition,
  type DiagramSessionState,
  type NewDiagramTransition,
  redoNewDiagramTransition,
  undoNewDiagramTransition,
} from './new-diagram-transition';
import type { SchemaAuthoringDerivedState } from './schema-authoring-support';
import type { SchemaCookbookRange } from './schema-cookbook';
import {
  buildDefaultEditorSchemaDraftText,
  buildSchemaDraftFromEditorText,
  toEditorSchemaDraftText,
} from './schema-editor-draft';
import { useShellEffects } from './useShellEffects';
import { useShellSchemaAndTagControls } from './useShellSchemaAndTagControls';
import type { WorkspaceDiagramRuntimeHandle } from './workspace-diagram-types';

const TRACE_SELECTION_TRANSITIONS = false;
const AUTO_IMPORT_GUEST_WORKSPACE = false;
const stripDiagramFileExtension = (name: string) => name.replace(/\.[^.]+$/, '').trim();
type ReferencePanelMode = 'cookbook' | 'dependencies' | 'reference' | 'schemas' | undefined;

interface UseAppShellControllerArgs {
  remoteWorkspace: RemoteWorkspaceState;
  session: Exclude<AppSession, { mode: 'loading' }>;
}

const formatTimestampLabel = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const now = new Date();
  const includeYear = parsed.getUTCFullYear() !== now.getUTCFullYear();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(parsed);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const day = getPart('day');
  const month = getPart('month');
  const year = getPart('year');
  const hour = getPart('hour');
  const minute = getPart('minute');

  if (!day || !month || !hour || !minute) {
    return formatter.format(parsed);
  }

  return `${day} ${month}${year ? ` ${year}` : ''}, ${hour}:${minute}`;
};
const shortenOpaqueId = (value: string, length = 12) =>
  value.length <= length ? value : value.slice(0, length);
const resolveActivatedSchemaRuntime = (
  schemaVersionCatalog: ReturnType<typeof buildSchemaVersionCatalog>,
  activations?: SemanticDocument['schemaRefs'],
) => semanticBootstrap.resolveActivatedSchemaRuntime(schemaVersionCatalog, activations);
const resolveActivatedSchema = (
  schemaVersionCatalog: ReturnType<typeof buildSchemaVersionCatalog>,
  activations?: SemanticDocument['schemaRefs'],
) =>
  resolveActivatedSchemaRuntime(schemaVersionCatalog, activations).runtime.resolved.effectiveSchema;
const { primaryStarter, bundledStarters, builtInSchemaCatalogEntries, builtInSchemaOptions } =
  semanticBootstrap;
// The shell consumes trusted bundled assets through semanticBootstrap.
// User-controlled diagrams and schemas still go through runtime validation below.
const primaryStarterDocument = primaryStarter.document;
const parseSchemaRefId = (ref: string) => buildSchemaId(parseSchemaRef(ref));
const parseSchemaRefVersion = (ref: string) => parseSchemaRef(ref).version;

const extractEditorSchemaImports = (refs?: SemanticDocument['schemaRefs']) =>
  (refs ?? []).map((activation) => activation.schema);

const withSchemaModuleIdentity = (
  module: NonNullable<ReturnType<typeof parseAndValidateSchemaModule>['value']>,
  schemaRef: string,
  version: string,
) => ({
  ...module,
  owner: parseSchemaRef(schemaRef).owner,
  name: parseSchemaRef(schemaRef).name,
  version,
});

const buildDefaultSchemaDraft = (schemaRefs?: SemanticDocument['schemaRefs']) => {
  const refs = extractEditorSchemaImports(schemaRefs);
  const editorText = buildDefaultEditorSchemaDraftText(refs);
  const fallbackVersions = new Map(
    refs
      .map((ref) => {
        const parsed = parseSchemaRef(ref);
        const schemaRef = buildSchemaId(parsed);
        return parsed.version ? ([schemaRef, parsed.version] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
  return buildSchemaDraftFromEditorText({
    editorText,
    identity: { owner: 'user', name: 'draft-schema' },
    version: '1.0',
    fallbackVersionsBySchemaId: fallbackVersions,
  });
};

function sortUserSchemaStreams(streams: UserSchemaStream[]) {
  return [...streams].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

const withDocumentName = (doc: SemanticDocument, name: string): SemanticDocument => {
  if (doc.metadata?.name === name) return doc;
  return {
    ...doc,
    metadata: {
      ...doc.metadata,
      name,
    },
  };
};

const createDiagramStoreDoc = (params: {
  snapshot: ReturnType<typeof createEmptyDiagramStoreSnapshot>;
  doc: SemanticDocument;
  excludeStreamId?: string;
}) => {
  const nextName = resolveDiagramStreamName({
    snapshot: params.snapshot,
    name: params.doc.metadata?.name,
    excludeStreamId: params.excludeStreamId,
  });
  return withDocumentName(params.doc, nextName);
};

type SchemaAuthoringSupportModule = typeof import('./schema-authoring-support');

const createPendingSchemaAuthoringState = (): SchemaAuthoringDerivedState => {
  const skippedStage = {
    status: 'skipped' as const,
    diagnostics: [],
  };
  return {
    schemaDraftValidation: {
      parse: skippedStage,
      authored: skippedStage,
      closure: skippedStage,
      materialization: skippedStage,
      resolved: skippedStage,
      diagnostics: [],
      ok: false,
    },
    schemaPublishAssessment: undefined,
    suggestedPublishedVersion: undefined,
    publishAssessmentSnapshot: undefined,
    canPublish: false,
    canInsertCookbook: false,
    schemaDependencies: [],
    cookbookDisabledReason: 'Schema tools are loading.',
    schemaCardTone: 'pending',
    schemaCardLines: ['Loading schema tools…'],
    diagramStateTone: 'pending',
    diagramStateLines: ['Schema tools are loading…'],
    schemaCookbookRecipes: [],
    publishedDiagramImpact: undefined,
    publishedDiagramActionDisabled: true,
    publishedDiagramActionDisabledReason: 'Schema tools are loading.',
  };
};

const findDiagramRevisionVersionNumber = (
  stream: DiagramStream | undefined,
  revisionId: string | undefined,
) => {
  if (!stream || !revisionId) return undefined;
  const index = stream.revisions.findIndex((revision) => revision.id === revisionId);
  return index >= 0 ? index + 1 : undefined;
};

const asFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function loadAnimationSettings(storageKey: string): AnimationSettings {
  const defaults = cloneAnimationSettings();
  const stored = localStorage.getItem(storageKey);
  if (!stored) return defaults;

  try {
    const parsed = JSON.parse(stored) as Partial<AnimationSettings> | null;
    const timeline = parsed?.timelineMs;
    const viewport = parsed?.viewport;
    return {
      timelineMs: {
        right: asFiniteNumber(timeline?.right, defaults.timelineMs.right),
        pause: asFiniteNumber(timeline?.pause, defaults.timelineMs.pause),
        width: asFiniteNumber(timeline?.width, defaults.timelineMs.width),
        down: asFiniteNumber(timeline?.down, defaults.timelineMs.down),
        height: asFiniteNumber(timeline?.height, defaults.timelineMs.height),
        children: asFiniteNumber(timeline?.children, defaults.timelineMs.children),
      },
      fadeInMultiplier: asFiniteNumber(parsed?.fadeInMultiplier, defaults.fadeInMultiplier),
      transitionSpeedMultiplier: asFiniteNumber(
        parsed?.transitionSpeedMultiplier,
        defaults.transitionSpeedMultiplier,
      ),
      viewport: {
        padding: asFiniteNumber(viewport?.padding, defaults.viewport.padding),
        collapsePadding: asFiniteNumber(
          viewport?.collapsePadding,
          defaults.viewport.collapsePadding,
        ),
        cameraDuration: asFiniteNumber(viewport?.cameraDuration, defaults.viewport.cameraDuration),
        fitDuration: asFiniteNumber(viewport?.fitDuration, defaults.viewport.fitDuration),
      },
    };
  } catch {
    return defaults;
  }
}

function loadNodeVisualMode(storageKey: string): NodeVisualMode {
  if (typeof window === 'undefined') return 'default';
  const stored = window.localStorage.getItem(storageKey);
  return isNodeVisualMode(stored) ? stored : 'default';
}

export function useAppShellController({ session, remoteWorkspace }: UseAppShellControllerArgs) {
  const guestStorageKeys = useMemo(() => getScopedStorageKeys(getGuestStorageNamespace()), []);
  const storageKeys = useMemo(
    () =>
      getScopedStorageKeys(
        session.mode === 'authenticated'
          ? getUserStorageNamespace(session.principalId)
          : getGuestStorageNamespace(),
      ),
    [session],
  );

  useEffect(() => {
    migrateLegacyGuestStorage(localStorage);
  }, []);

  const userSchemaStore = useMemo(
    () => new LocalUserSchemaStore(localStorage, storageKeys.userSchemaStore),
    [storageKeys.userSchemaStore],
  );
  const guestUserSchemaStore = useMemo(
    () => new LocalUserSchemaStore(localStorage, guestStorageKeys.userSchemaStore),
    [guestStorageKeys.userSchemaStore],
  );
  const diagramStore = useMemo(
    () =>
      new LocalDiagramStore(localStorage, storageKeys.diagramStore, storageKeys.activeDiagramId),
    [storageKeys.activeDiagramId, storageKeys.diagramStore],
  );
  const guestDiagramStore = useMemo(
    () =>
      new LocalDiagramStore(
        localStorage,
        guestStorageKeys.diagramStore,
        guestStorageKeys.activeDiagramId,
      ),
    [guestStorageKeys.activeDiagramId, guestStorageKeys.diagramStore],
  );
  const schemaEditorSessionStore = useMemo(
    () => new LocalSchemaEditorSessionStore(localStorage, storageKeys.schemaEditorSession),
    [storageKeys.schemaEditorSession],
  );
  const _guestSchemaEditorSessionStore = useMemo(
    () => new LocalSchemaEditorSessionStore(localStorage, guestStorageKeys.schemaEditorSession),
    [guestStorageKeys.schemaEditorSession],
  );

  const [userSchemaSnapshot, setUserSchemaSnapshot] = useState<UserSchemaStoreSnapshot>(() =>
    session.mode === 'authenticated' ? remoteWorkspace.schemaSnapshot : userSchemaStore.load(),
  );
  const allPublishedUserSchemaVersions = useMemo(
    () => getPublishedSchemaModules(userSchemaSnapshot),
    [userSchemaSnapshot],
  );
  const publishedUserSchemas = useMemo(
    () =>
      [...userSchemaSnapshot.streams]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .flatMap((stream) => {
          const latestVersion = getLatestPublishedVersion(stream);
          if (!latestVersion) return [];
          const parsed = parseAndValidateSchemaModule(latestVersion.raw);
          if (!parsed.ok || !parsed.value) return [];
          return [
            {
              stream,
              version: latestVersion,
              module: withSchemaModuleIdentity(
                parsed.value,
                getUserSchemaRef(stream),
                latestVersion.version,
              ),
            },
          ];
        }),
    [userSchemaSnapshot.streams],
  );
  const schemaVersionCatalog = useMemo(
    () =>
      buildSchemaVersionCatalog([
        ...builtInSchemaCatalogEntries,
        ...allPublishedUserSchemaVersions.map(({ stream, version, module }) => ({
          schemaId: getUserSchemaRef(stream),
          version: version.version,
          raw: version.raw,
          module,
        })),
      ]),
    [allPublishedUserSchemaVersions],
  );
  const initialDiagramSession = useMemo(() => {
    let snapshot =
      session.mode === 'authenticated' ? remoteWorkspace.diagramSnapshot : diagramStore.load();
    const reconciled = reconcileBundledStarterArtifacts({
      snapshot,
      starters: bundledStarters,
    });
    if (reconciled.changed) {
      snapshot = reconciled.snapshot;
      if (session.mode === 'guest') {
        localStorage.setItem(storageKeys.diagramStore, JSON.stringify(snapshot));
      }
    }
    const storedActiveDiagramId = diagramStore.loadActiveDiagramId();
    const activeStream =
      snapshot.streams.find((stream) => stream.id === storedActiveDiagramId) ?? snapshot.streams[0];
    if (!activeStream) {
      diagramStore.saveActiveDiagramId(undefined);
      return {
        snapshot: createEmptyDiagramStoreSnapshot(),
        activeDiagramId: undefined,
        doc: primaryStarterDocument,
        sourceDiagnostics: [] as LoadedDiagramDoc['sourceDiagnostics'],
      };
    }
    diagramStore.saveActiveDiagramId(activeStream.id);
    const loaded = loadDiagramDocFromRaw({
      raw:
        activeStream.draft?.raw ??
        getDiagramHeadRevision(activeStream)?.raw ??
        serializeDocument(primaryStarterDocument),
      streamName: activeStream.name,
      sourceLabel: activeStream.slug,
      snapshot,
    });
    return {
      snapshot,
      activeDiagramId: activeStream.id,
      doc: loaded.doc,
      sourceDiagnostics: loaded.sourceDiagnostics,
    };
  }, [diagramStore, remoteWorkspace.diagramSnapshot, session.mode, storageKeys.diagramStore]);
  const [diagramSnapshot, setDiagramSnapshot] = useState(initialDiagramSession.snapshot);
  const [activeDiagramId, setActiveDiagramId] = useState<string | undefined>(
    initialDiagramSession.activeDiagramId,
  );
  const [history, setHistory] = useState<DocumentHistory<SemanticDocument>>(() => {
    return createHistory(initialDiagramSession.doc);
  });
  const [sourceDiagramDiagnostics, setSourceDiagramDiagnostics] = useState<
    LoadedDiagramDoc['sourceDiagnostics']
  >(initialDiagramSession.sourceDiagnostics);
  const doc = history.present;
  const loadActiveDiagramFromRaw = useCallback(
    (raw: string, stream: Pick<DiagramStream, 'name' | 'slug'>) =>
      loadDiagramDocFromRaw({
        raw,
        streamName: stream.name,
        sourceLabel: stream.slug,
        snapshot: diagramSnapshotRef.current,
      }),
    [],
  );
  const applyLoadedDiagramHistory = useCallback((loaded: LoadedDiagramDoc) => {
    setHistory(createHistory(loaded.doc));
    setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
  }, []);
  const activeDiagramStream = useMemo(
    () => diagramSnapshot.streams.find((stream) => stream.id === activeDiagramId),
    [activeDiagramId, diagramSnapshot.streams],
  );
  const _queryClient = useQueryClient();
  const isRemotePersistence = session.mode === 'authenticated';
  const diagramSnapshotRef = useRef(diagramSnapshot);

  useEffect(() => {
    diagramSnapshotRef.current = diagramSnapshot;
  }, [diagramSnapshot]);
  useEffect(() => {
    if (!activeDiagramStream) {
      setSourceDiagramDiagnostics([]);
      return;
    }
    const loaded = loadActiveDiagramFromRaw(
      activeDiagramStream.draft?.raw ??
        getDiagramHeadRevision(activeDiagramStream)?.raw ??
        serializeDocument(primaryStarterDocument),
      activeDiagramStream,
    );
    setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
  }, [activeDiagramStream, loadActiveDiagramFromRaw]);

  const upsertDiagramStreamSnapshot = useCallback(
    (snapshot: DiagramStoreSnapshot, nextStream: DiagramStream): DiagramStoreSnapshot => ({
      streams: snapshot.streams.some((stream) => stream.id === nextStream.id)
        ? snapshot.streams.map((stream) => (stream.id === nextStream.id ? nextStream : stream))
        : [...snapshot.streams, nextStream],
    }),
    [],
  );
  const replaceUserSchemaStreamSnapshot = useCallback(
    (snapshot: UserSchemaStoreSnapshot, nextStream: UserSchemaStream): UserSchemaStoreSnapshot => ({
      ...snapshot,
      streams: snapshot.streams.some((stream) => stream.name === nextStream.name)
        ? snapshot.streams.map((stream) => (stream.name === nextStream.name ? nextStream : stream))
        : [...snapshot.streams, nextStream].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
    }),
    [],
  );
  const deleteUserSchemaStreamFromSnapshot = useCallback(
    (snapshot: UserSchemaStoreSnapshot, name: string): UserSchemaStoreSnapshot => ({
      ...snapshot,
      streams: snapshot.streams.filter((stream) => stream.name !== name),
    }),
    [],
  );
  const toRemoteAssessment = useCallback(
    (assessment: unknown) => assessment as number[] | undefined,
    [],
  );
  const replayRemoteSchemaStream = useCallback(
    async (stream: UserSchemaStream): Promise<UserSchemaStream | undefined> => {
      const versionsAscending = [...stream.versions].sort((left, right) => {
        const leftParts = parseTwoPartVersion(left.version);
        const rightParts = parseTwoPartVersion(right.version);
        if (!leftParts || !rightParts) {
          return left.version.localeCompare(right.version);
        }
        if (leftParts.major !== rightParts.major) {
          return leftParts.major - rightParts.major;
        }
        return leftParts.minor - rightParts.minor;
      });

      let currentStream: UserSchemaStream | undefined;
      for (const version of versionsAscending) {
        const response = await publishSchemaVersion(stream.name, {
          raw: version.raw,
          version: version.version,
          assessment: toRemoteAssessment(version.assessment),
          expectedStreamVersion: currentStream?.streamVersion,
        });
        if (response.status !== 201) {
          return currentStream;
        }
        currentStream = mapRemoteUserSchemaStream(response.data);
      }

      if (!stream.draft) {
        return currentStream;
      }

      if (!currentStream) {
        const created = await createSchemaStream({
          name: stream.name,
          raw: stream.draft.raw,
          valid: stream.draft.valid,
          baseVersion: stream.draft.baseVersion,
        });
        return created.status === 201 ? mapRemoteUserSchemaStream(created.data) : undefined;
      }

      const saved = await saveSchemaDraft(stream.name, {
        raw: stream.draft.raw,
        valid: stream.draft.valid,
        baseVersion: stream.draft.baseVersion,
        expectedStreamVersion: currentStream.streamVersion,
      });
      return saved.status === 200 ? mapRemoteUserSchemaStream(saved.data) : currentStream;
    },
    [toRemoteAssessment],
  );
  const guestImportMarkersStorageKey =
    session.mode === 'authenticated'
      ? `${getUserStorageNamespace(session.principalId)}:guest-import-markers-v1`
      : undefined;
  const loadGuestImportMarkers = useCallback(() => {
    if (!guestImportMarkersStorageKey) {
      return {
        diagramIds: [] as string[],
        schemaNames: [] as string[],
      };
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(guestImportMarkersStorageKey) ?? '{}') as {
        diagramIds?: string[];
        schemaNames?: string[];
      };
      return {
        diagramIds: Array.isArray(parsed.diagramIds)
          ? parsed.diagramIds.filter((value): value is string => typeof value === 'string')
          : [],
        schemaNames: Array.isArray(parsed.schemaNames)
          ? parsed.schemaNames.filter((value): value is string => typeof value === 'string')
          : [],
      };
    } catch {
      return {
        diagramIds: [] as string[],
        schemaNames: [] as string[],
      };
    }
  }, [guestImportMarkersStorageKey]);
  const saveGuestImportMarkers = useCallback(
    (markers: { diagramIds: string[]; schemaNames: string[] }) => {
      if (!guestImportMarkersStorageKey) return;
      localStorage.setItem(guestImportMarkersStorageKey, JSON.stringify(markers));
    },
    [guestImportMarkersStorageKey],
  );
  const rewriteImportedDiagramRaw = useCallback(
    (raw: string, renamedSchemaNames: Map<string, string>) => {
      if (renamedSchemaNames.size === 0) return raw;
      try {
        const parsed = parseSemanticSourceDocument(raw);
        return serializeSourceDocument({
          ...parsed,
          schemaRefs: (parsed.schemaRefs ?? []).map((activation) => {
            const parsedRef = parseSchemaRef(activation.schema);
            if (parsedRef.owner !== 'user') return activation;
            const renamed = renamedSchemaNames.get(parsedRef.name);
            if (!renamed) return activation;
            const nextRef = buildSchemaId({ owner: parsedRef.owner, name: renamed });
            return {
              ...activation,
              schema: parsedRef.version ? `${nextRef}@${parsedRef.version}` : nextRef,
            };
          }),
        });
      } catch {
        return raw;
      }
    },
    [],
  );
  const replayRemoteDiagramStream = useCallback(
    async (
      stream: DiagramStream,
      renamedSchemaNames: Map<string, string>,
    ): Promise<DiagramStream | undefined> => {
      const rewrittenRevisions = stream.revisions.map((revision) => ({
        ...revision,
        raw: rewriteImportedDiagramRaw(revision.raw, renamedSchemaNames),
      }));
      let currentStream: DiagramStream | undefined;

      if (rewrittenRevisions.length > 0) {
        const firstRevision = rewrittenRevisions[0];
        const firstDoc = parseSemanticSourceDocument(firstRevision.raw);
        const created = await createDiagramStream({
          name: firstDoc.metadata?.name ?? stream.name,
          raw: firstRevision.raw,
          valid: true,
        });
        if (created.status !== 201) {
          return undefined;
        }
        currentStream = mapRemoteDiagramStream(created.data);
        if (!currentStream) {
          return undefined;
        }
        for (const revision of rewrittenRevisions) {
          const revisionDoc = parseSemanticSourceDocument(revision.raw);
          const checkpointed = await checkpointDiagramStream(currentStream.id, {
            name: revisionDoc.metadata?.name ?? stream.name,
            raw: revision.raw,
            valid: true,
            summaryLines: revision.summaryLines,
            expectedStreamVersion: currentStream.streamVersion,
          });
          if (checkpointed.status !== 201) {
            return currentStream;
          }
          currentStream = mapRemoteDiagramStream(checkpointed.data) ?? currentStream;
        }
      }

      if (!stream.draft) {
        return currentStream;
      }

      if (!currentStream) {
        const created = await createDiagramStream({
          name: stream.draft.name || stream.name,
          raw: rewriteImportedDiagramRaw(stream.draft.raw, renamedSchemaNames),
          valid: stream.draft.valid,
        });
        return created.status === 201 ? mapRemoteDiagramStream(created.data) : undefined;
      }

      const rewrittenDraftRaw = rewriteImportedDiagramRaw(stream.draft.raw, renamedSchemaNames);
      const saved = await saveDiagramDraft(currentStream.id, {
        name: stream.draft.name || stream.name,
        raw: rewrittenDraftRaw,
        valid: stream.draft.valid,
        expectedBaseRevisionId: sanitizeOptionalUuid(currentStream.draft?.baseRevisionId),
        expectedStreamVersion: currentStream.streamVersion,
      });
      return saved.status === 200 ? mapRemoteDiagramStream(saved.data) : currentStream;
    },
    [rewriteImportedDiagramRaw],
  );
  const commitDoc = useCallback(
    (
      updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
      options?: { undoable?: boolean },
    ) => {
      setHistory((previous) => commitHistory(previous, updater, options));
    },
    [],
  );
  const optimisticallyPersistRemoteDiagramDraft = useCallback(
    (
      streamId: string,
      payload: { baseRevisionId?: string; name: string; raw: string; valid: boolean },
    ) => {
      const now = new Date().toISOString();
      setDiagramSnapshot((previous) => ({
        streams: previous.streams.map((stream) =>
          stream.id === streamId
            ? {
                ...stream,
                updatedAt: now,
                draft: {
                  raw: payload.raw,
                  name: payload.name,
                  baseRevisionId: payload.baseRevisionId,
                  updatedAt: now,
                  valid: payload.valid,
                },
              }
            : stream,
        ),
      }));
    },
    [],
  );
  const remoteDraftSaveQueue = useMemo(
    () =>
      createRemoteDiagramDraftSaveQueue({
        applyOptimisticDraft: optimisticallyPersistRemoteDiagramDraft,
        getStream: (streamId) =>
          diagramSnapshotRef.current.streams.find((candidate) => candidate.id === streamId),
        onConflict: (_streamId, latestStream) => {
          if (latestStream) {
            setDiagramSnapshot((previous) => upsertDiagramStreamSnapshot(previous, latestStream));
          }
          setDocumentNoticeLines([
            'This diagram was updated elsewhere. Reloaded the latest remote draft.',
          ]);
        },
        onError: (message) => {
          setDocumentNoticeLines([message]);
        },
        onSaved: (stream) => {
          setDiagramSnapshot((previous) => upsertDiagramStreamSnapshot(previous, stream));
        },
        saveDraft: (stream, payload) => saveRemoteDiagramDraftIfChanged(stream, payload),
      }),
    [optimisticallyPersistRemoteDiagramDraft, upsertDiagramStreamSnapshot],
  );
  const enqueueRemoteDraftSave = useCallback(
    (
      streamId: string,
      payload: { baseRevisionId?: string; name: string; raw: string; valid: boolean },
    ) => {
      remoteDraftSaveQueue.enqueue(streamId, payload);
    },
    [remoteDraftSaveQueue],
  );
  const initialSchemaDraftState = useMemo(() => {
    const fallbackRaw = buildDefaultSchemaDraft(doc.schemaRefs);
    const fallbackText = toEditorSchemaDraftText(fallbackRaw);
    const draftSession = schemaEditorSessionStore.load(fallbackText);
    const sessionDraftName =
      typeof draftSession.draftName === 'string' && draftSession.draftName.trim().length > 0
        ? draftSession.draftName
        : undefined;

    if (draftSession.restoredFromStorage && !draftSession.schemaRef) {
      const editorText = draftSession.editorText;
      return {
        editorText,
        name: sessionDraftName ?? suggestUserSchemaName(editorText),
        nameTouched: draftSession.nameTouched === true && Boolean(sessionDraftName),
        schemaRef: undefined,
        baseVersion: undefined,
      };
    }

    const sortedStreams = sortUserSchemaStreams(userSchemaSnapshot.streams);
    const selectedStream = draftSession.schemaRef
      ? userSchemaSnapshot.streams.find(
          (stream) => getUserSchemaRef(stream) === draftSession.schemaRef,
        )
      : sortedStreams[0];
    if (selectedStream) {
      const schemaRef = getUserSchemaRef(selectedStream);
      const selectedVersion = draftSession.baseVersion
        ? selectedStream.versions.find((version) => version.version === draftSession.baseVersion)
        : undefined;
      const latestVersion = selectedVersion ?? getLatestPublishedVersion(selectedStream);
      const baseRaw =
        selectedStream.draft?.raw ?? latestVersion?.raw ?? buildDefaultSchemaDraft(doc.schemaRefs);
      const baseText = toEditorSchemaDraftText(baseRaw);
      const usingSessionStream = draftSession.schemaRef === schemaRef;
      return {
        editorText: usingSessionStream ? draftSession.editorText : baseText,
        name: usingSessionStream ? (sessionDraftName ?? selectedStream.name) : selectedStream.name,
        nameTouched: usingSessionStream ? draftSession.nameTouched === true : false,
        schemaRef,
        baseVersion: selectedStream.draft?.baseVersion ?? latestVersion?.version,
      };
    }

    const editorText = draftSession.editorText;
    return {
      editorText,
      name: sessionDraftName ?? suggestUserSchemaName(editorText),
      nameTouched: draftSession.nameTouched === true && Boolean(sessionDraftName),
      schemaRef: undefined,
      baseVersion: undefined,
    };
  }, [doc.schemaRefs, schemaEditorSessionStore, userSchemaSnapshot.streams]);
  const [schemaDraftEditorText, setSchemaDraftEditorText] = useState<string>(
    initialSchemaDraftState.editorText,
  );
  const [schemaDraftName, setSchemaDraftName] = useState<string>(initialSchemaDraftState.name);
  const [schemaDraftNameTouched, setSchemaDraftNameTouched] = useState(
    initialSchemaDraftState.nameTouched,
  );
  const [loadedDraftSchemaRef, setLoadedDraftSchemaRef] = useState<string | undefined>(
    initialSchemaDraftState.schemaRef,
  );
  const [loadedDraftSchemaBaseVersion, setLoadedDraftSchemaBaseVersion] = useState<
    string | undefined
  >(initialSchemaDraftState.baseVersion);
  const [debouncedSchemaDraftText, setDebouncedSchemaDraftText] = useState(schemaDraftEditorText);
  const [documentNoticeLines, setDocumentNoticeLines] = useState<string[]>([]);
  const [schemaDraftNotice, setSchemaDraftNotice] = useState<string | undefined>();
  const [schemaCookbookNoticeLines, setSchemaCookbookNoticeLines] = useState<string[]>([]);
  const [schemaDraftHighlights, setSchemaDraftHighlights] = useState<SchemaCookbookRange[]>([]);
  const [referencePanelMode, setReferencePanelMode] = useState<ReferencePanelMode>(() =>
    userSchemaSnapshot.streams.filter((stream) => stream.versions.length > 0).length === 0
      ? 'cookbook'
      : undefined,
  );
  const [schemaAuthoringSupport, setSchemaAuthoringSupport] =
    useState<SchemaAuthoringSupportModule | null>(null);
  const [recentlyDeletedSchemaStream, setRecentlyDeletedSchemaStream] = useState<
    | {
        stream: UserSchemaStream;
        index: number;
        wasLoaded: boolean;
        previousBaseVersion?: string;
      }
    | undefined
  >();
  const [guestImportConflictNames, setGuestImportConflictNames] = useState<string[]>([]);
  const [guestImportConflictDismissed, setGuestImportConflictDismissed] = useState(false);
  const [guestImportNotice, setGuestImportNotice] = useState<string | undefined>();
  const [isImportingGuestWorkspace, setIsImportingGuestWorkspace] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSchemaDraftText(schemaDraftEditorText);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [schemaDraftEditorText]);

  useEffect(() => {
    if (loadedDraftSchemaRef || schemaDraftNameTouched) return;
    setSchemaDraftName(suggestUserSchemaName(schemaDraftEditorText));
  }, [loadedDraftSchemaRef, schemaDraftEditorText, schemaDraftNameTouched]);

  const loadedDraftSchemaStream = useMemo(
    () =>
      loadedDraftSchemaRef
        ? userSchemaSnapshot.streams.find(
            (stream) => getUserSchemaRef(stream) === loadedDraftSchemaRef,
          )
        : undefined,
    [loadedDraftSchemaRef, userSchemaSnapshot.streams],
  );
  const loadedDraftPublishedVersion = useMemo(() => {
    if (!loadedDraftSchemaStream) return undefined;
    if (loadedDraftSchemaBaseVersion) {
      return loadedDraftSchemaStream.versions.find(
        (version) => version.version === loadedDraftSchemaBaseVersion,
      );
    }
    return getLatestPublishedVersion(loadedDraftSchemaStream);
  }, [loadedDraftSchemaBaseVersion, loadedDraftSchemaStream]);
  const latestCatalogVersionBySchemaRef = useMemo(() => {
    const next = new Map<string, string>();
    for (const entry of schemaVersionCatalog.entries) {
      const previous = next.get(entry.schemaId);
      if (!previous) {
        next.set(entry.schemaId, entry.version);
        continue;
      }
      const previousParts = previous.split('.').map((part) => Number.parseInt(part, 10));
      const nextParts = entry.version.split('.').map((part) => Number.parseInt(part, 10));
      if (
        nextParts.every((part) => Number.isInteger(part)) &&
        previousParts.every((part) => Number.isInteger(part)) &&
        (nextParts[0] > previousParts[0] ||
          (nextParts[0] === previousParts[0] && (nextParts[1] ?? 0) > (previousParts[1] ?? 0)))
      ) {
        next.set(entry.schemaId, entry.version);
      }
    }
    return next;
  }, [schemaVersionCatalog.entries]);
  const normalizedDraftSchemaName =
    slugifySchemaName(schemaDraftName) || suggestUserSchemaName(schemaDraftEditorText);
  const conflictingNamedStream = useMemo(
    () =>
      findUserSchemaStreamByName({
        snapshot: userSchemaSnapshot,
        name: normalizedDraftSchemaName,
        excludeName: loadedDraftSchemaStream?.name,
      }),
    [loadedDraftSchemaStream?.name, normalizedDraftSchemaName, userSchemaSnapshot],
  );
  const isForkingSchemaByName =
    Boolean(loadedDraftSchemaStream) && normalizedDraftSchemaName !== loadedDraftSchemaStream?.name;
  const publishMode =
    loadedDraftSchemaStream && loadedDraftPublishedVersion && !isForkingSchemaByName
      ? 'update'
      : 'initial';
  const nextDraftAssessmentSchemaId =
    publishMode === 'update' && loadedDraftSchemaStream
      ? getUserSchemaRef(loadedDraftSchemaStream)
      : buildSchemaId({ owner: 'user', name: normalizedDraftSchemaName || 'draft-schema' });
  const nextDraftAssessmentVersion =
    publishMode === 'update' && loadedDraftPublishedVersion
      ? loadedDraftPublishedVersion.version
      : '1.0';
  const schemaDraftBaseRaw = useMemo(() => {
    if (loadedDraftSchemaStream?.draft?.raw) return loadedDraftSchemaStream.draft.raw;
    if (loadedDraftPublishedVersion?.raw) return loadedDraftPublishedVersion.raw;
    return buildDefaultSchemaDraft(doc.schemaRefs);
  }, [doc.schemaRefs, loadedDraftPublishedVersion?.raw, loadedDraftSchemaStream?.draft?.raw]);
  const schemaDraftRaw = useMemo(
    () =>
      buildSchemaDraftFromEditorText({
        editorText: schemaDraftEditorText,
        identity: parseSchemaRef(nextDraftAssessmentSchemaId),
        version: nextDraftAssessmentVersion,
        previousRaw: schemaDraftBaseRaw,
        fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
      }),
    [
      latestCatalogVersionBySchemaRef,
      nextDraftAssessmentSchemaId,
      nextDraftAssessmentVersion,
      schemaDraftBaseRaw,
      schemaDraftEditorText,
    ],
  );
  const debouncedSchemaDraftRaw = useMemo(
    () =>
      buildSchemaDraftFromEditorText({
        editorText: debouncedSchemaDraftText,
        identity: parseSchemaRef(nextDraftAssessmentSchemaId),
        version: nextDraftAssessmentVersion,
        previousRaw: schemaDraftBaseRaw,
        fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
      }),
    [
      debouncedSchemaDraftText,
      latestCatalogVersionBySchemaRef,
      nextDraftAssessmentSchemaId,
      nextDraftAssessmentVersion,
      schemaDraftBaseRaw,
    ],
  );

  const semanticRuntime = useDiagramSemanticRuntime({
    doc,
    schemaVersionCatalog,
    sourceDiagnostics: sourceDiagramDiagnostics,
  });
  const activeRawSchemaSet = semanticRuntime.schemaRuntimeResult.raw;
  const schemaRuntime = semanticRuntime.schemaRuntime;
  const schema = semanticRuntime.schema;
  const diagramDocumentDiagnostics = useMemo(
    () => semanticRuntime.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [semanticRuntime.diagnostics],
  );
  const diagramDocumentValid = diagramDocumentDiagnostics.length === 0;
  const draftSchemaPending = debouncedSchemaDraftText !== schemaDraftEditorText;
  // Schema authoring is split off the always-on canvas path. Until that bundle loads, the shell
  // keeps the editor in an explicit pending state instead of recomputing validation eagerly.
  const schemaAuthoringState = useMemo(
    () =>
      schemaAuthoringSupport
        ? schemaAuthoringSupport.buildSchemaAuthoringState({
            debouncedSchemaDraftRaw,
            schemaDraftRaw,
            schemaDraftBaseRaw,
            schemaDraftEditorText,
            schemaVersionCatalog,
            nextDraftAssessmentSchemaId,
            nextDraftAssessmentVersion,
            draftSchemaPending,
            latestCatalogVersionBySchemaRef,
            publishMode,
            loadedDraftSchemaStream,
            loadedDraftPublishedVersion,
            doc,
            schema,
            isForkingSchemaByName,
            resolveActivatedSchema,
          })
        : createPendingSchemaAuthoringState(),
    [
      debouncedSchemaDraftRaw,
      doc,
      draftSchemaPending,
      isForkingSchemaByName,
      latestCatalogVersionBySchemaRef,
      loadedDraftPublishedVersion,
      loadedDraftSchemaStream,
      nextDraftAssessmentSchemaId,
      nextDraftAssessmentVersion,
      publishMode,
      schema,
      schemaAuthoringSupport,
      schemaDraftBaseRaw,
      schemaDraftEditorText,
      schemaDraftRaw,
      schemaVersionCatalog,
    ],
  );
  const schemaAuthoringReady = schemaAuthoringSupport !== null;
  const {
    schemaDraftValidation,
    schemaPublishAssessment,
    suggestedPublishedVersion,
    publishAssessmentSnapshot,
    canPublish,
    canInsertCookbook,
    schemaDependencies,
    cookbookDisabledReason,
    schemaCardTone,
    schemaCardLines,
    diagramStateTone,
    diagramStateLines,
    schemaCookbookRecipes: availableSchemaCookbookRecipes,
  } = schemaAuthoringState;
  const schemaDraftVersionLabel = loadedDraftPublishedVersion
    ? `v${loadedDraftPublishedVersion.version}`
    : 'v1.0';
  const userSchemaOptions = useMemo(
    () =>
      publishedUserSchemas.map(({ stream, version }) => ({
        id: getUserSchemaRef(stream),
        label: stream.name,
        version: version.version,
        owner: 'user' as const,
      })),
    [publishedUserSchemas],
  );
  const schemaOptions = useMemo(
    () => [...userSchemaOptions, ...builtInSchemaOptions],
    [userSchemaOptions],
  );
  const schemaManagerStreams = useMemo(() => {
    const diagramSchemaIds = new Set(
      doc.schemaRefs.map((activation) => buildSchemaId(parseSchemaRef(activation.schema))),
    );
    const selectedSchemaRefs = new Set(doc.schemaRefs.map((activation) => activation.schema));
    const sortVersions = (left: string, right: string) => {
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

    return [...userSchemaSnapshot.streams]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((stream) => {
        const latestVersion = getLatestPublishedVersion(stream);
        const schemaRef = getUserSchemaRef(stream);
        const inUse = diagramSchemaIds.has(schemaRef);
        return {
          schemaRef,
          name: stream.name,
          updatedAtLabel: formatTimestampLabel(stream.updatedAt),
          latestVersion: latestVersion?.version,
          hasDraft: Boolean(stream.draft),
          draftBaseVersion: stream.draft?.baseVersion,
          draftUpdatedAtLabel: stream.draft
            ? formatTimestampLabel(stream.draft.updatedAt)
            : undefined,
          isEditing: loadedDraftSchemaRef === schemaRef,
          inUse,
          deleteDisabled: inUse,
          deleteDisabledReason: inUse
            ? 'This schema is currently selected for the diagram.'
            : undefined,
          versions: [...stream.versions]
            .sort((left, right) => sortVersions(left.version, right.version))
            .map((version) => ({
              key: `${schemaRef}@${version.version}`,
              version: version.version,
              publishedAtLabel: formatTimestampLabel(version.publishedAt),
              summaryLines: version.assessment?.summaryLines ?? [],
              previewText: version.raw,
              isLatest: version.version === latestVersion?.version,
              isAppliedToDiagram: selectedSchemaRefs.has(`${schemaRef}@${version.version}`),
            })),
        };
      });
  }, [doc.schemaRefs, loadedDraftSchemaRef, userSchemaSnapshot.streams]);
  const entityIndex = semanticRuntime.entityIndex;
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [diagramSearchQuery, setDiagramSearchQuery] = useState('');
  const focusRootId = doc.view?.scopeRootId;
  const diagramSearchMatches = useMemo(
    () => searchDiagramText({ doc, schema, query: diagramSearchQuery }),
    [diagramSearchQuery, doc, schema],
  );
  const [newDiagramTransition, setNewDiagramTransition] = useState<
    NewDiagramTransition<SemanticDocument, DiagramStoreSnapshot> | undefined
  >();
  const traceSelection = useCallback((event: string, payload?: Record<string, unknown>) => {
    if (!TRACE_SELECTION_TRANSITIONS) return;
    const stamp = new Date().toISOString();
    if (payload) {
      console.log(`[selection-transition] ${stamp} ${event}`, payload);
      return;
    }
    console.log(`[selection-transition] ${stamp} ${event}`);
  }, []);
  const setSelectedEntity = useCallback((id: string | undefined) => {
    setSelectedEntityId(id);
  }, []);
  const setSelectedEdge = useCallback((id: string | undefined) => {
    setSelectedEdgeId(id);
  }, []);
  const clearNewDiagramTransition = useCallback(() => {
    setNewDiagramTransition(undefined);
  }, []);
  const captureDiagramSession = useCallback(
    (
      snapshot = diagramSnapshot,
      currentHistory = history,
      nextActiveDiagramId = activeDiagramId,
    ): DiagramSessionState<SemanticDocument, DiagramStoreSnapshot> => ({
      snapshot,
      activeDiagramId: nextActiveDiagramId,
      history: currentHistory,
      noticeLines: documentNoticeLines,
      selectedEntityId,
      selectedEdgeId,
    }),
    [
      activeDiagramId,
      diagramSnapshot,
      documentNoticeLines,
      history,
      selectedEdgeId,
      selectedEntityId,
    ],
  );
  const applyDiagramSession = useCallback(
    (session: DiagramSessionState<SemanticDocument, DiagramStoreSnapshot>) => {
      setDiagramSnapshot(session.snapshot);
      setActiveDiagramId(session.activeDiagramId);
      setHistory(session.history);
      setDocumentNoticeLines(session.noticeLines);
      setSelectedEntity(session.selectedEntityId);
      setSelectedEdge(session.selectedEdgeId);
    },
    [setSelectedEdge, setSelectedEntity],
  );
  const canUndo =
    history.past.length > 0 || canUndoNewDiagramTransition(newDiagramTransition, history);
  const canRedo =
    history.future.length > 0 || canRedoNewDiagramTransition(newDiagramTransition, history);
  const undo = useCallback(() => {
    if (history.past.length > 0) {
      setHistory((previous) => undoHistory(previous));
      return;
    }
    const restored = undoNewDiagramTransition(newDiagramTransition, history);
    if (!restored) return;
    applyDiagramSession(restored.session);
    setNewDiagramTransition(restored.transition);
  }, [applyDiagramSession, history, newDiagramTransition]);
  const redo = useCallback(() => {
    if (history.future.length > 0) {
      setHistory((previous) => redoHistory(previous));
      return;
    }
    const restored = redoNewDiagramTransition(newDiagramTransition, history);
    if (!restored) return;
    applyDiagramSession(restored.session);
    setNewDiagramTransition(restored.transition);
  }, [applyDiagramSession, history, newDiagramTransition]);

  useEffect(() => {
    setNewDiagramTransition((previous) => {
      if (
        !previous ||
        previous.position !== 'after' ||
        previous.after.activeDiagramId !== activeDiagramId
      ) {
        return previous;
      }

      if (
        previous.after.snapshot === diagramSnapshot &&
        previous.after.history === history &&
        previous.after.noticeLines === documentNoticeLines &&
        previous.after.selectedEntityId === selectedEntityId &&
        previous.after.selectedEdgeId === selectedEdgeId
      ) {
        return previous;
      }

      return {
        ...previous,
        after: {
          ...previous.after,
          snapshot: diagramSnapshot,
          activeDiagramId,
          history,
          noticeLines: documentNoticeLines,
          selectedEntityId,
          selectedEdgeId,
        },
      };
    });
  }, [
    activeDiagramId,
    diagramSnapshot,
    documentNoticeLines,
    history,
    selectedEdgeId,
    selectedEntityId,
  ]);

  const canContain = useCallback(
    (parentType: string, childType: string) => {
      const parentDef = resolveTypeDef(schema, parentType);
      const containment = parentDef?.containment;
      if (!containment) return false;
      const typeOk = containment.allowedChildTypes
        ? typeMatches(schema, childType, containment.allowedChildTypes)
        : true;
      const traitOk = containment.allowedChildTraits
        ? traitMatches(schema, childType, containment.allowedChildTraits)
        : true;
      return typeOk && traitOk;
    },
    [schema],
  );

  const canContainEntity = useCallback(
    (parent: Entity, childType: string) => {
      if (!canContain(parent.type, childType)) return false;
      if (parent.type !== CORE_GROUP_TYPE_ID) return true;
      const props = parent.props as Record<string, unknown> | undefined;
      if (props?.mode !== 'typed') return true;
      const groupType = typeof props.groupType === 'string' ? props.groupType.trim() : '';
      if (!groupType) return true;
      return childType === groupType;
    },
    [canContain],
  );

  const isNameRequired = useCallback(
    (typeId: string) => Boolean(resolveTypeDef(schema, typeId)?.naming?.required),
    [schema],
  );
  const resolveDefaultEntityName = useCallback(
    (typeId: string, requestedName: string | undefined, existingCount: number) => {
      const normalized = requestedName?.trim();
      if (normalized && normalized.length > 0) {
        return normalized;
      }
      if (!isNameRequired(typeId)) {
        return undefined;
      }
      return `${getSchemaObjectLocalId(typeId)} ${existingCount + 1}`;
    },
    [isNameRequired],
  );

  const [skipTransitions, _setSkipTransitions] = useState(false);
  const [showSchemaEditor, setShowSchemaEditor] = useState(false);
  const [showDebug, _setShowDebug] = useState(false);
  const [nodeVisualMode, setNodeVisualMode] = useState<NodeVisualMode>(() =>
    loadNodeVisualMode(storageKeys.nodeVisualMode),
  );
  const [animationSettings, _setAnimationSettings] = useState<AnimationSettings>(() =>
    loadAnimationSettings(storageKeys.animationSettings),
  );

  useEffect(() => {
    if (!showSchemaEditor) return;
    let cancelled = false;
    void import('./schema-authoring-support').then((module) => {
      if (!cancelled) {
        setSchemaAuthoringSupport(module);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showSchemaEditor]);

  const workspaceDiagramRuntimeRef = useRef<WorkspaceDiagramRuntimeHandle | null>(null);
  const {
    selectedSchemaIds,
    schemaLockReasons,
    schemaToggleBlockReasons,
    toggleSchemaSelection: toggleSchemaSelectionRaw,
  } = useShellSchemaAndTagControls({
    doc,
    entityIndex,
    relations: doc.relations,
    commitDoc,
    schemaOptions,
    rawSchemaSet: activeRawSchemaSet,
    schemaRuntime,
    resolveActivatedSchema: (activations?: SemanticDocument['schemaRefs']) =>
      resolveActivatedSchema(schemaVersionCatalog, activations),
  });
  const showInspector = Boolean(selectedEntityId || selectedEdgeId);
  // The shell adapts semantic state into presentation models so UI/canvas components stay dumb.
  const paletteViewModel = useMemo(() => buildPaletteViewModel(schema), [schema]);
  const schemaOptionViews = useMemo(
    () =>
      buildSchemaOptionViews({
        availableSchemas: schemaOptions,
        selectedSchemaIds,
        schemaLockReasons,
        schemaToggleBlockReasons,
      }),
    [schemaLockReasons, schemaOptions, schemaToggleBlockReasons, selectedSchemaIds],
  );
  const compiledViewState = useMemo(() => compileDiagramViewState({ doc, schema }), [doc, schema]);
  const visibleCompiledNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of compiledViewState.tree.byId.keys()) {
      if (id !== compiledViewState.tree.rootId) {
        ids.add(id);
      }
    }
    return ids;
  }, [compiledViewState.tree.byId, compiledViewState.tree.rootId]);
  const workspaceDiagramModel = useMemo(
    () => ({
      doc,
      viewportSessionKey: activeDiagramId ?? 'workspace:empty',
      schema,
      schemaRuntime,
      entityIndex,
      selectedEntityId,
      selectedEdgeId,
      focusRootId,
      searchMatches:
        diagramSearchMatches.query.length > 0
          ? {
              matchingEntityIds: diagramSearchMatches.matchingEntityIds,
              matchingRelationIds: diagramSearchMatches.matchingRelationIds,
            }
          : undefined,
      nodeVisualMode,
      showDebug,
      animationSettings,
      skipTransitions,
      showInspector,
      availableSchemas: schemaOptionViews,
      onToggleSchema: toggleSchemaSelectionRaw,
      canContainEntity,
      resolveDefaultEntityName,
      commitDoc,
      setSelectedEntity,
      setSelectedEdge,
      traceSelection,
    }),
    [
      animationSettings,
      activeDiagramId,
      canContainEntity,
      commitDoc,
      doc,
      entityIndex,
      focusRootId,
      nodeVisualMode,
      resolveDefaultEntityName,
      schema,
      schemaRuntime,
      schemaOptionViews,
      selectedEdgeId,
      selectedEntityId,
      setSelectedEdge,
      setSelectedEntity,
      showDebug,
      showInspector,
      skipTransitions,
      toggleSchemaSelectionRaw,
      traceSelection,
      diagramSearchMatches.matchingEntityIds,
      diagramSearchMatches.matchingRelationIds,
      diagramSearchMatches.query.length,
    ],
  );

  const documentForOutput = doc;
  const serializedDocumentForOutput = useMemo(
    () => serializeDocument(documentForOutput),
    [documentForOutput],
  );
  const updateDiagramName = useCallback(
    (next: string) => {
      commitDoc(
        (previous) => ({
          ...previous,
          metadata: {
            ...previous.metadata,
            name: next,
          },
        }),
        { undoable: false },
      );
      setDocumentNoticeLines([]);
    },
    [commitDoc],
  );
  const activeDiagramBaseRevisionId = activeDiagramStream
    ? getCurrentDiagramBaseRevisionId(activeDiagramStream)
    : undefined;
  const pendingDiagramName = useMemo(
    () =>
      resolveDiagramStreamName({
        snapshot: diagramSnapshot,
        name: doc.metadata?.name,
        excludeStreamId: activeDiagramStream?.id,
      }),
    [activeDiagramStream?.id, diagramSnapshot, doc.metadata?.name],
  );
  useShellEffects({
    animationSettingsStorageKey: storageKeys.animationSettings,
    nodeVisualModeStorageKey: storageKeys.nodeVisualMode,
    animationSettings,
    nodeVisualMode,
    doc,
    commitDoc,
    selectedEntityId,
    selectedEdgeId,
    setSelectedEntity,
    setSelectedEdge,
    canUndo,
    canRedo,
    undo,
    redo,
  });

  useEffect(() => {
    diagramStore.saveActiveDiagramId(activeDiagramId);
  }, [activeDiagramId, diagramStore]);

  useEffect(() => {
    void activeDiagramId;
    setDiagramSearchQuery('');
  }, [activeDiagramId]);

  useEffect(() => {
    if (!focusRootId) return;
    if (entityIndex.byId.has(focusRootId)) return;
    commitDoc(
      (previous) => ({
        ...previous,
        view: {
          ...ensureDiagramView(previous.view),
          scopeRootId: undefined,
        },
      }),
      { undoable: false },
    );
  }, [commitDoc, entityIndex.byId, focusRootId]);

  useEffect(() => {
    if (!focusRootId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      commitDoc(
        (previous) => ({
          ...previous,
          view: {
            ...ensureDiagramView(previous.view),
            scopeRootId: undefined,
          },
        }),
        { undoable: false },
      );
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commitDoc, focusRootId]);

  useEffect(() => {
    schemaEditorSessionStore.save({
      schemaRef: loadedDraftSchemaRef,
      baseVersion: loadedDraftSchemaBaseVersion,
      draftName: schemaDraftName,
      nameTouched: schemaDraftNameTouched,
      editorText: schemaDraftEditorText,
    });
  }, [
    loadedDraftSchemaBaseVersion,
    loadedDraftSchemaRef,
    schemaDraftEditorText,
    schemaDraftName,
    schemaDraftNameTouched,
    schemaEditorSessionStore,
  ]);

  const runGuestWorkspaceImport = useCallback(
    async (renameConflicts: boolean) => {
      if (!isRemotePersistence) return;
      setIsImportingGuestWorkspace(true);
      try {
        const markers = loadGuestImportMarkers();
        const guestSchemaSnapshot = guestUserSchemaStore.load();
        const guestDiagramSnapshot = guestDiagramStore.load();
        const pendingSchemas = guestSchemaSnapshot.streams.filter(
          (stream) => !markers.schemaNames.includes(stream.name),
        );
        const pendingDiagrams = guestDiagramSnapshot.streams.filter(
          (stream) => !markers.diagramIds.includes(stream.id),
        );

        const renamedSchemaNames = new Map<string, string>();
        if (renameConflicts) {
          for (const stream of pendingSchemas) {
            if (!userSchemaSnapshot.streams.some((candidate) => candidate.name === stream.name)) {
              continue;
            }
            let suffix = 1;
            let candidateName = `${stream.name}-imported`;
            while (
              userSchemaSnapshot.streams.some((candidate) => candidate.name === candidateName) ||
              pendingSchemas.some(
                (candidate) => candidate !== stream && candidate.name === candidateName,
              )
            ) {
              suffix += 1;
              candidateName = `${stream.name}-imported-${suffix}`;
            }
            renamedSchemaNames.set(stream.name, candidateName);
          }
        }

        let nextSchemaSnapshot = userSchemaSnapshot;
        let nextDiagramSnapshot = diagramSnapshot;
        let importedSchemaCount = 0;
        let importedDiagramCount = 0;
        for (const stream of pendingSchemas) {
          const imported = await replayRemoteSchemaStream(
            renamedSchemaNames.has(stream.name)
              ? {
                  ...stream,
                  name: renamedSchemaNames.get(stream.name) ?? stream.name,
                }
              : stream,
          );
          if (!imported) continue;
          nextSchemaSnapshot = replaceUserSchemaStreamSnapshot(nextSchemaSnapshot, imported);
          markers.schemaNames.push(stream.name);
          importedSchemaCount += 1;
        }
        for (const stream of pendingDiagrams) {
          const imported = await replayRemoteDiagramStream(stream, renamedSchemaNames);
          if (!imported) continue;
          nextDiagramSnapshot = upsertDiagramStreamSnapshot(nextDiagramSnapshot, imported);
          markers.diagramIds.push(stream.id);
          importedDiagramCount += 1;
        }

        setUserSchemaSnapshot(nextSchemaSnapshot);
        setDiagramSnapshot(nextDiagramSnapshot);
        saveGuestImportMarkers({
          diagramIds: [...new Set(markers.diagramIds)],
          schemaNames: [...new Set(markers.schemaNames)],
        });
        localStorage.setItem(
          guestStorageKeys.userSchemaStore,
          JSON.stringify({
            ...guestSchemaSnapshot,
            streams: guestSchemaSnapshot.streams.filter(
              (stream) => !markers.schemaNames.includes(stream.name),
            ),
          }),
        );
        localStorage.setItem(
          guestStorageKeys.diagramStore,
          JSON.stringify({
            streams: guestDiagramSnapshot.streams.filter(
              (stream) => !markers.diagramIds.includes(stream.id),
            ),
          }),
        );
        if (
          !localStorage.getItem(storageKeys.schemaEditorSession) &&
          localStorage.getItem(guestStorageKeys.schemaEditorSession)
        ) {
          localStorage.setItem(
            storageKeys.schemaEditorSession,
            localStorage.getItem(guestStorageKeys.schemaEditorSession) ?? '',
          );
        }
        setGuestImportConflictNames([]);
        setGuestImportConflictDismissed(false);
        if (importedSchemaCount > 0 || importedDiagramCount > 0) {
          setGuestImportNotice(
            `Imported ${importedDiagramCount} diagram${importedDiagramCount === 1 ? '' : 's'} and ${importedSchemaCount} schema${importedSchemaCount === 1 ? '' : 's'} from this browser.`,
          );
        }
      } finally {
        setIsImportingGuestWorkspace(false);
      }
    },
    [
      diagramSnapshot,
      guestDiagramStore,
      guestStorageKeys.diagramStore,
      guestStorageKeys.schemaEditorSession,
      guestStorageKeys.userSchemaStore,
      guestUserSchemaStore,
      isRemotePersistence,
      loadGuestImportMarkers,
      replayRemoteDiagramStream,
      replayRemoteSchemaStream,
      replaceUserSchemaStreamSnapshot,
      saveGuestImportMarkers,
      storageKeys.schemaEditorSession,
      upsertDiagramStreamSnapshot,
      userSchemaSnapshot,
    ],
  );

  useEffect(() => {
    if (!AUTO_IMPORT_GUEST_WORKSPACE) {
      return;
    }
    if (!isRemotePersistence || isImportingGuestWorkspace) return;
    const markers = loadGuestImportMarkers();
    const pendingSchemas = guestUserSchemaStore
      .load()
      .streams.filter((stream) => !markers.schemaNames.includes(stream.name));
    const pendingDiagrams = guestDiagramStore
      .load()
      .streams.filter((stream) => !markers.diagramIds.includes(stream.id));
    if (pendingSchemas.length === 0 && pendingDiagrams.length === 0) {
      if (guestImportConflictNames.length > 0) {
        setGuestImportConflictNames([]);
      }
      return;
    }
    const conflicts = pendingSchemas
      .filter((stream) =>
        userSchemaSnapshot.streams.some((candidate) => candidate.name === stream.name),
      )
      .map((stream) => stream.name);
    if (conflicts.length > 0) {
      if (!guestImportConflictDismissed) {
        setGuestImportConflictNames(conflicts);
      }
      return;
    }
    if (guestImportConflictNames.length === 0) {
      void runGuestWorkspaceImport(false);
    }
  }, [
    guestDiagramStore,
    guestImportConflictDismissed,
    guestImportConflictNames.length,
    guestUserSchemaStore,
    isImportingGuestWorkspace,
    isRemotePersistence,
    loadGuestImportMarkers,
    runGuestWorkspaceImport,
    userSchemaSnapshot.streams,
  ]);

  const searchTotalMatches =
    diagramSearchMatches.matchingEntityIds.size + diagramSearchMatches.matchingRelationIds.size;
  const visibleSearchEntityMatchCount = useMemo(
    () =>
      [...diagramSearchMatches.matchingEntityIds].filter((id) => visibleCompiledNodeIds.has(id))
        .length,
    [diagramSearchMatches.matchingEntityIds, visibleCompiledNodeIds],
  );
  const visibleSearchRelationMatchCount = useMemo(
    () =>
      doc.relations.filter(
        (relation) =>
          diagramSearchMatches.matchingRelationIds.has(relation.id) &&
          visibleCompiledNodeIds.has(relation.from) &&
          visibleCompiledNodeIds.has(relation.to),
      ).length,
    [diagramSearchMatches.matchingRelationIds, doc.relations, visibleCompiledNodeIds],
  );
  const searchHiddenMatches = Math.max(
    0,
    searchTotalMatches - visibleSearchEntityMatchCount - visibleSearchRelationMatchCount,
  );
  const clearDiagramSearch = useCallback(() => {
    setDiagramSearchQuery('');
  }, []);
  const clearWorkspaceDiagramTransientState = useCallback(() => {
    workspaceDiagramRuntimeRef.current?.clearTransientState();
  }, []);
  const revealDiagramSearchResults = useCallback(() => {
    if (searchTotalMatches === 0) {
      return;
    }
    const diagramRuntime = workspaceDiagramRuntimeRef.current;
    diagramRuntime?.flushUserGesture();
    diagramRuntime?.setPendingStructuralTransitionIntent({
      direction: 'in',
      focus: { kind: 'global' },
      allowNonExpansionViewChanges: true,
    });
    commitDoc(
      (previous) => ({
        ...previous,
        view: buildDiagramViewForSearchReveal({
          doc: previous,
          matchingEntityIds: diagramSearchMatches.matchingEntityIds,
          matchingRelationIds: diagramSearchMatches.matchingRelationIds,
        }),
      }),
      { undoable: false },
    );
  }, [
    commitDoc,
    diagramSearchMatches.matchingEntityIds,
    diagramSearchMatches.matchingRelationIds,
    searchTotalMatches,
  ]);

  const persistActiveDiagramDraft = useCallback(
    (snapshotOverride = diagramSnapshot) => {
      if (!activeDiagramStream) {
        return { snapshot: snapshotOverride, normalizedName: doc.metadata?.name };
      }
      const currentDraft = activeDiagramStream.draft;
      if (
        currentDraft?.raw === serializedDocumentForOutput &&
        currentDraft.valid === diagramDocumentValid &&
        currentDraft.baseRevisionId === activeDiagramBaseRevisionId &&
        currentDraft.name === pendingDiagramName
      ) {
        return { snapshot: snapshotOverride, normalizedName: currentDraft.name };
      }
      if (isRemotePersistence) {
        enqueueRemoteDraftSave(activeDiagramStream.id, {
          name: pendingDiagramName,
          raw: serializedDocumentForOutput,
          valid: diagramDocumentValid,
          baseRevisionId: activeDiagramBaseRevisionId,
        });
        return {
          snapshot: snapshotOverride,
          normalizedName: pendingDiagramName,
        };
      }
      const saved = diagramStore.saveDraft({
        snapshot: snapshotOverride,
        streamId: activeDiagramStream.id,
        name: pendingDiagramName,
        raw: serializedDocumentForOutput,
        valid: diagramDocumentValid,
        expectedBaseRevisionId: activeDiagramBaseRevisionId,
      });
      return {
        snapshot: saved.snapshot,
        normalizedName: saved.stream.draft?.name ?? pendingDiagramName,
      };
    },
    [
      activeDiagramBaseRevisionId,
      activeDiagramStream,
      diagramStore,
      diagramDocumentValid,
      diagramSnapshot,
      doc.metadata?.name,
      enqueueRemoteDraftSave,
      isRemotePersistence,
      pendingDiagramName,
      serializedDocumentForOutput,
    ],
  );

  useEffect(() => {
    if (!activeDiagramStream) return;
    const currentDraft = activeDiagramStream.draft;
    if (
      currentDraft?.raw === serializedDocumentForOutput &&
      currentDraft.valid === diagramDocumentValid &&
      currentDraft.baseRevisionId === activeDiagramBaseRevisionId &&
      currentDraft.name === pendingDiagramName
    ) {
      return;
    }
    const persisted = persistActiveDiagramDraft();
    if (persisted.snapshot !== diagramSnapshot) {
      setDiagramSnapshot(persisted.snapshot);
    }
  }, [
    activeDiagramBaseRevisionId,
    activeDiagramStream,
    diagramDocumentValid,
    diagramSnapshot,
    pendingDiagramName,
    persistActiveDiagramDraft,
    serializedDocumentForOutput,
  ]);

  const loadDiagramStream = useCallback(
    (streamId: string) => {
      const persisted = persistActiveDiagramDraft();
      if (persisted.snapshot !== diagramSnapshot) {
        setDiagramSnapshot(persisted.snapshot);
      }
      const nextStream = persisted.snapshot.streams.find((stream) => stream.id === streamId);
      if (!nextStream) return;
      const raw =
        nextStream.draft?.raw ??
        getDiagramHeadRevision(nextStream)?.raw ??
        serializeDocument(primaryStarterDocument);
      clearWorkspaceDiagramTransientState();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      clearNewDiagramTransition();
      setActiveDiagramId(nextStream.id);
      setDocumentNoticeLines([]);
      applyLoadedDiagramHistory(loadActiveDiagramFromRaw(raw, nextStream));
    },
    [
      applyLoadedDiagramHistory,
      clearNewDiagramTransition,
      clearWorkspaceDiagramTransientState,
      diagramSnapshot,
      loadActiveDiagramFromRaw,
      persistActiveDiagramDraft,
      diagramSnapshot.streams,
      setSelectedEdge,
      setSelectedEntity,
    ],
  );

  const createNewDiagram = useCallback(async () => {
    const persisted = persistActiveDiagramDraft();
    const previousSession = captureDiagramSession(persisted.snapshot);
    const nextDoc = createBlankDiagramDocument(primaryStarterDocument.version);
    if (isRemotePersistence) {
      const response = await createDiagramStream({
        name: nextDoc.metadata?.name,
        raw: serializeDocument(nextDoc),
        valid: true,
      });
      if (response.status !== 201) {
        setDocumentNoticeLines([`Failed to create diagram (${response.status}).`]);
        return;
      }
      const mapped = mapRemoteDiagramStream(response.data);
      if (!mapped) {
        setDocumentNoticeLines(['Failed to load the created diagram.']);
        return;
      }
      const loaded = loadActiveDiagramFromRaw(
        mapped.draft?.raw ?? serializeDocument(nextDoc),
        mapped,
      );
      const nextHistory = createHistory(loaded.doc);
      const nextNoticeLines = [`Started ${mapped.name}.`];
      const nextSnapshot = upsertDiagramStreamSnapshot(persisted.snapshot, mapped);
      clearWorkspaceDiagramTransientState();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      setDiagramSnapshot(nextSnapshot);
      setActiveDiagramId(mapped.id);
      setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
      setDocumentNoticeLines(nextNoticeLines);
      setHistory(nextHistory);
      setNewDiagramTransition({
        before: previousSession,
        after: {
          snapshot: nextSnapshot,
          activeDiagramId: mapped.id,
          history: nextHistory,
          noticeLines: nextNoticeLines,
        },
        position: 'after',
      });
      return;
    }
    const created = diagramStore.createStream({
      snapshot: persisted.snapshot,
      name: nextDoc.metadata?.name,
      slug: slugifyDiagramName(nextDoc.metadata?.name ?? '') || undefined,
      raw: serializeDocument(nextDoc),
      valid: true,
      scope: activeDiagramStream?.scope ?? DEFAULT_DIAGRAM_OWNER_SCOPE,
    });
    const loaded = loadActiveDiagramFromRaw(
      created.stream.draft?.raw ?? serializeDocument(nextDoc),
      created.stream,
    );
    const nextHistory = createHistory(loaded.doc);
    const nextNoticeLines = [`Started ${created.stream.name}.`];
    clearWorkspaceDiagramTransientState();
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
    setDiagramSnapshot(created.snapshot);
    setActiveDiagramId(created.stream.id);
    setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
    setDocumentNoticeLines(nextNoticeLines);
    setHistory(nextHistory);
    setNewDiagramTransition({
      before: previousSession,
      after: {
        snapshot: created.snapshot,
        activeDiagramId: created.stream.id,
        history: nextHistory,
        noticeLines: nextNoticeLines,
      },
      position: 'after',
    });
  }, [
    activeDiagramStream?.scope,
    captureDiagramSession,
    clearWorkspaceDiagramTransientState,
    diagramStore,
    isRemotePersistence,
    loadActiveDiagramFromRaw,
    persistActiveDiagramDraft,
    setSelectedEdge,
    setSelectedEntity,
    upsertDiagramStreamSnapshot,
  ]);

  const saveAsNewDiagram = useCallback(async () => {
    if (!diagramDocumentValid) return;
    clearNewDiagramTransition();
    if (isRemotePersistence) {
      const createdResponse = await createDiagramStream({
        name: pendingDiagramName,
        raw: serializedDocumentForOutput,
        valid: true,
      });
      if (createdResponse.status !== 201) {
        setDocumentNoticeLines([`Failed to create diagram (${createdResponse.status}).`]);
        return;
      }
      const createdStream = mapRemoteDiagramStream(createdResponse.data);
      if (!createdStream) {
        setDocumentNoticeLines(['Failed to load the created diagram.']);
        return;
      }
      const checkpointResponse = await checkpointDiagramStream(createdStream.id, {
        name: pendingDiagramName,
        raw: serializedDocumentForOutput,
        valid: true,
        summaryLines: buildDiagramCheckpointSummary({
          nextRaw: serializedDocumentForOutput,
        }),
        expectedStreamVersion: createdStream.streamVersion,
      });
      const checkpointedStream =
        checkpointResponse.status === 201
          ? mapRemoteDiagramStream(checkpointResponse.data)
          : undefined;
      const nextStream = checkpointedStream ?? createdStream;
      clearWorkspaceDiagramTransientState();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      setDiagramSnapshot((previous) => upsertDiagramStreamSnapshot(previous, nextStream));
      setActiveDiagramId(nextStream.id);
      const loaded = loadActiveDiagramFromRaw(
        nextStream.draft?.raw ?? serializedDocumentForOutput,
        nextStream,
      );
      setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
      setDocumentNoticeLines(
        checkpointedStream
          ? [`Saved ${nextStream.name} as version 1.`]
          : [`Saved ${nextStream.name} as a remote draft.`],
      );
      setHistory(createHistory(loaded.doc));
      return;
    }
    const created = diagramStore.createStream({
      snapshot: diagramSnapshot,
      name: pendingDiagramName,
      slug: slugifyDiagramName(pendingDiagramName) || undefined,
      raw: serializedDocumentForOutput,
      valid: true,
      scope: activeDiagramStream?.scope ?? DEFAULT_DIAGRAM_OWNER_SCOPE,
    });
    const checkpointed = diagramStore.checkpoint({
      snapshot: created.snapshot,
      streamId: created.stream.id,
      name: pendingDiagramName,
      raw: serializedDocumentForOutput,
      valid: true,
      summaryLines: buildDiagramCheckpointSummary({
        nextRaw: serializedDocumentForOutput,
      }),
    });
    clearWorkspaceDiagramTransientState();
    setSelectedEntity(undefined);
    setSelectedEdge(undefined);
    setDiagramSnapshot(checkpointed.snapshot);
    setActiveDiagramId(checkpointed.stream.id);
    setDocumentNoticeLines([`Saved ${checkpointed.stream.name} as version 1.`]);
    const loaded = loadActiveDiagramFromRaw(
      checkpointed.stream.draft?.raw ?? serializedDocumentForOutput,
      checkpointed.stream,
    );
    setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
    setHistory(createHistory(loaded.doc));
  }, [
    activeDiagramStream?.scope,
    clearNewDiagramTransition,
    clearWorkspaceDiagramTransientState,
    diagramDocumentValid,
    diagramSnapshot,
    diagramStore,
    isRemotePersistence,
    loadActiveDiagramFromRaw,
    pendingDiagramName,
    serializedDocumentForOutput,
    setSelectedEdge,
    setSelectedEntity,
    upsertDiagramStreamSnapshot,
  ]);

  const restoreDiagramRevision = useCallback(
    async (revisionId: string) => {
      if (!activeDiagramStream) return;
      clearNewDiagramTransition();
      if (isRemotePersistence) {
        const response = await restoreDiagramDraft(activeDiagramStream.id, {
          revisionId,
          expectedStreamVersion: activeDiagramStream.streamVersion,
        });
        if (response.status !== 200) {
          setDocumentNoticeLines([`Failed to restore version (${response.status}).`]);
          return;
        }
        const mapped = mapRemoteDiagramStream(response.data);
        if (!mapped) {
          setDocumentNoticeLines(['Failed to load the restored draft.']);
          return;
        }
        const versionNumber = findDiagramRevisionVersionNumber(activeDiagramStream, revisionId);
        clearWorkspaceDiagramTransientState();
        setSelectedEntity(undefined);
        setSelectedEdge(undefined);
        setDiagramSnapshot((previous) => upsertDiagramStreamSnapshot(previous, mapped));
        const loaded = loadActiveDiagramFromRaw(
          mapped.draft?.raw ?? serializeDocument(primaryStarterDocument),
          mapped,
        );
        setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
        setHistory(createHistory(loaded.doc));
        setDocumentNoticeLines([
          `Restored version ${versionNumber ?? shortenOpaqueId(revisionId)} to the draft.`,
        ]);
        return;
      }
      const restored = diagramStore.restoreDraft({
        snapshot: diagramSnapshot,
        streamId: activeDiagramStream.id,
        revisionId,
      });
      const revision = restored.stream.revisions.find((entry) => entry.id === revisionId);
      const versionNumber = findDiagramRevisionVersionNumber(activeDiagramStream, revisionId);
      clearWorkspaceDiagramTransientState();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      setDiagramSnapshot(restored.snapshot);
      const loaded = loadActiveDiagramFromRaw(
        revision?.raw ?? restored.stream.draft?.raw ?? serializeDocument(primaryStarterDocument),
        restored.stream,
      );
      setSourceDiagramDiagnostics(loaded.sourceDiagnostics);
      setHistory(createHistory(loaded.doc));
      setDocumentNoticeLines([
        `Restored version ${versionNumber ?? shortenOpaqueId(revisionId)} to the draft.`,
      ]);
    },
    [
      activeDiagramStream,
      clearNewDiagramTransition,
      clearWorkspaceDiagramTransientState,
      diagramSnapshot,
      diagramStore,
      isRemotePersistence,
      loadActiveDiagramFromRaw,
      setSelectedEdge,
      setSelectedEntity,
      upsertDiagramStreamSnapshot,
    ],
  );

  const activeDiagramHeadRevision = activeDiagramStream
    ? getDiagramHeadRevision(activeDiagramStream)
    : undefined;
  const activeDiagramHeadVersionNumber = activeDiagramHeadRevision
    ? findDiagramRevisionVersionNumber(activeDiagramStream, activeDiagramHeadRevision.id)
    : undefined;
  const activeDiagramBaseVersionNumber = findDiagramRevisionVersionNumber(
    activeDiagramStream,
    activeDiagramBaseRevisionId,
  );
  const nextDiagramCheckpointVersionNumber = (activeDiagramStream?.revisions.length ?? 0) + 1;
  const hasPendingDiagramNameChange =
    Boolean(activeDiagramStream) && pendingDiagramName !== activeDiagramStream?.name;
  const diagramHasUnpublishedChanges = activeDiagramHeadRevision
    ? activeDiagramHeadRevision.raw !== serializedDocumentForOutput
    : true;
  const documentCheckpointSummaryLines = useMemo(
    () =>
      buildDiagramCheckpointSummary({
        previousRaw: activeDiagramHeadRevision?.raw,
        nextRaw: serializedDocumentForOutput,
      }),
    [activeDiagramHeadRevision?.raw, serializedDocumentForOutput],
  );
  const diagramHasMeaningfulUnpublishedChanges =
    !activeDiagramHeadRevision ||
    hasMeaningfulDiagramCheckpointChanges(documentCheckpointSummaryLines);
  const hasPresentationOnlyDiagramChanges =
    Boolean(activeDiagramHeadRevision) &&
    diagramHasUnpublishedChanges &&
    !diagramHasMeaningfulUnpublishedChanges;
  const documentCheckpointDisabledReason = !activeDiagramStream
    ? 'No active diagram.'
    : !diagramDocumentValid
      ? diagnosticsToMessages(diagramDocumentDiagnostics).join('\n')
      : activeDiagramHeadRevision && !diagramHasMeaningfulUnpublishedChanges
        ? 'No meaningful unpublished changes to checkpoint.'
        : undefined;
  const canCheckpointDiagram =
    Boolean(activeDiagramStream) &&
    diagramDocumentValid &&
    (!activeDiagramHeadRevision || diagramHasMeaningfulUnpublishedChanges);
  const canSaveAsNewDiagram =
    Boolean(activeDiagramStream) && diagramDocumentValid && hasPendingDiagramNameChange;
  const saveAsNewDiagramDisabledReason = !activeDiagramStream
    ? 'No active diagram.'
    : !hasPendingDiagramNameChange
      ? 'Change the diagram name before saving as a new diagram.'
      : !diagramDocumentValid
        ? diagnosticsToMessages(diagramDocumentDiagnostics).join('\n')
        : undefined;
  const checkpointDiagramLabel = !activeDiagramStream
    ? 'Checkpoint'
    : !canCheckpointDiagram
      ? 'Up to date'
      : hasPendingDiagramNameChange
        ? `Rename to ${pendingDiagramName} and checkpoint as version ${nextDiagramCheckpointVersionNumber}`
        : `Checkpoint as version ${nextDiagramCheckpointVersionNumber}`;
  const saveAsNewDiagramLabel = `Save as ${pendingDiagramName} version 1`;
  const documentStatusLabel = hasPendingDiagramNameChange
    ? `Pending rename to ${pendingDiagramName}`
    : !activeDiagramHeadRevision
      ? 'Draft with no checkpoints'
      : diagramHasMeaningfulUnpublishedChanges
        ? `Draft based on version ${activeDiagramBaseVersionNumber ?? activeDiagramHeadVersionNumber}`
        : hasPresentationOnlyDiagramChanges
          ? `View draft based on version ${activeDiagramHeadVersionNumber}`
          : `Draft matches version ${activeDiagramHeadVersionNumber}`;
  const diagramManagerStreams = useMemo(
    () =>
      [...diagramSnapshot.streams]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((stream) => ({
          id: stream.id,
          name: stream.name,
          ownerLabel: stream.scope.label,
          updatedAtLabel: formatTimestampLabel(stream.updatedAt),
          hasDraft: Boolean(stream.draft),
          draftName: stream.draft?.name,
          hasPendingNameChange: Boolean(stream.draft?.name && stream.draft.name !== stream.name),
          draftUpdatedAtLabel: stream.draft
            ? formatTimestampLabel(stream.draft.updatedAt)
            : undefined,
          draftBaseRevisionShortId: stream.draft?.baseRevisionId
            ? shortenOpaqueId(stream.draft.baseRevisionId)
            : undefined,
          isActive: stream.id === activeDiagramId,
          revisions: stream.revisions
            .map((revision, index) => ({
              id: revision.id,
              versionNumber: index + 1,
              shortId: shortenOpaqueId(revision.id),
              checkpointedAtLabel: formatTimestampLabel(revision.checkpointedAt),
              summaryLines: revision.summaryLines,
              previewText: revision.raw,
              isLatest: revision.id === stream.headRevisionId,
            }))
            .sort((left, right) => right.versionNumber - left.versionNumber),
        })),
    [activeDiagramId, diagramSnapshot.streams],
  );
  const checkpointDiagram = useCallback(async () => {
    if (!activeDiagramStream || !canCheckpointDiagram) return;
    if (isRemotePersistence) {
      const response = await checkpointDiagramStream(activeDiagramStream.id, {
        name: pendingDiagramName,
        raw: serializedDocumentForOutput,
        valid: diagramDocumentValid,
        expectedBaseRevisionId: sanitizeOptionalUuid(activeDiagramBaseRevisionId),
        expectedStreamVersion: activeDiagramStream.streamVersion,
        summaryLines: documentCheckpointSummaryLines,
      });
      if (response.status !== 201) {
        setDocumentNoticeLines([`Failed to checkpoint diagram (${response.status}).`]);
        return;
      }
      const mapped = mapRemoteDiagramStream(response.data);
      if (!mapped) {
        setDocumentNoticeLines(['Failed to load the new diagram version.']);
        return;
      }
      setDiagramSnapshot((previous) => upsertDiagramStreamSnapshot(previous, mapped));
      setDocumentNoticeLines([
        `Saved version ${nextDiagramCheckpointVersionNumber}.`,
        ...documentCheckpointSummaryLines,
      ]);
      return;
    }
    const checkpointed = diagramStore.checkpoint({
      snapshot: diagramSnapshot,
      streamId: activeDiagramStream.id,
      name: pendingDiagramName,
      raw: serializedDocumentForOutput,
      valid: diagramDocumentValid,
      expectedBaseRevisionId: activeDiagramBaseRevisionId,
      summaryLines: documentCheckpointSummaryLines,
    });
    setDiagramSnapshot(checkpointed.snapshot);
    setDocumentNoticeLines([
      `Saved version ${nextDiagramCheckpointVersionNumber}.`,
      ...checkpointed.revision.summaryLines,
    ]);
  }, [
    activeDiagramBaseRevisionId,
    activeDiagramStream,
    canCheckpointDiagram,
    diagramDocumentValid,
    diagramSnapshot,
    diagramStore,
    documentCheckpointSummaryLines,
    isRemotePersistence,
    nextDiagramCheckpointVersionNumber,
    pendingDiagramName,
    serializedDocumentForOutput,
    upsertDiagramStreamSnapshot,
  ]);

  const exportJson = useCallback(() => {
    const blob = new Blob([serializedDocumentForOutput], {
      type: 'text/yaml',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${doc.metadata?.name ?? 'diagram'}.yaml`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [doc.metadata?.name, serializedDocumentForOutput]);

  const latestPublishedDraftVersion = useMemo(
    () =>
      loadedDraftSchemaStream ? getLatestPublishedVersion(loadedDraftSchemaStream) : undefined,
    [loadedDraftSchemaStream],
  );
  const currentLoadedDraftSchemaRef = useMemo(
    () =>
      loadedDraftSchemaStream
        ? doc.schemaRefs.find(
            (activation) =>
              parseSchemaRefId(activation.schema) === getUserSchemaRef(loadedDraftSchemaStream),
          )
        : undefined,
    [doc.schemaRefs, loadedDraftSchemaStream],
  );
  const currentLoadedDraftSchemaVersion = currentLoadedDraftSchemaRef
    ? parseSchemaRefVersion(currentLoadedDraftSchemaRef.schema)
    : undefined;
  const { publishedDiagramImpact } = schemaAuthoringState;
  const isDraftSyncedWithLatestPublished =
    Boolean(latestPublishedDraftVersion) && latestPublishedDraftVersion?.raw === schemaDraftRaw;
  const publishedDiagramActionLabel = useMemo(() => {
    if (
      !loadedDraftSchemaStream ||
      !latestPublishedDraftVersion ||
      !isDraftSyncedWithLatestPublished
    ) {
      return undefined;
    }
    if (currentLoadedDraftSchemaVersion === latestPublishedDraftVersion.version) {
      return 'Applied to diagram';
    }
    return currentLoadedDraftSchemaVersion ? 'Upgrade diagram' : 'Apply to diagram';
  }, [
    currentLoadedDraftSchemaVersion,
    isDraftSyncedWithLatestPublished,
    latestPublishedDraftVersion,
    loadedDraftSchemaStream,
  ]);
  const publishedDiagramActionDisabledReason =
    latestPublishedDraftVersion?.version !== undefined &&
    currentLoadedDraftSchemaVersion === latestPublishedDraftVersion.version
      ? 'This schema version is already applied to the diagram.'
      : schemaAuthoringState.publishedDiagramActionDisabledReason;
  const publishedDiagramActionDisabled =
    schemaAuthoringState.publishedDiagramActionDisabled ||
    (latestPublishedDraftVersion?.version !== undefined &&
      currentLoadedDraftSchemaVersion === latestPublishedDraftVersion.version);

  const persistLoadedSchemaDraft = useCallback(
    (snapshot: UserSchemaStoreSnapshot) => {
      if (isRemotePersistence) return snapshot;
      if (!loadedDraftSchemaStream) return snapshot;
      if (!schemaAuthoringReady) return snapshot;
      const latestVersion = getLatestPublishedVersion(loadedDraftSchemaStream);
      const nextBaseVersion = loadedDraftSchemaBaseVersion ?? latestVersion?.version;
      const noPersistedDraft = !loadedDraftSchemaStream.draft;
      const matchesHead =
        noPersistedDraft &&
        loadedDraftPublishedVersion?.raw === schemaDraftRaw &&
        normalizedDraftSchemaName === loadedDraftSchemaStream.name;
      if (matchesHead) {
        return snapshot;
      }
      return userSchemaStore.saveDraft({
        snapshot,
        name: loadedDraftSchemaStream.name,
        raw: buildSchemaDraftFromEditorText({
          editorText: schemaDraftEditorText,
          identity: { owner: 'user', name: loadedDraftSchemaStream.name },
          version: nextBaseVersion ?? loadedDraftPublishedVersion?.version ?? '1.0',
          previousRaw: schemaDraftRaw,
          fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
        }),
        valid: schemaDraftValidation.ok,
        baseVersion: nextBaseVersion,
      });
    },
    [
      latestCatalogVersionBySchemaRef,
      loadedDraftPublishedVersion?.raw,
      loadedDraftPublishedVersion?.version,
      loadedDraftSchemaBaseVersion,
      loadedDraftSchemaStream,
      isRemotePersistence,
      normalizedDraftSchemaName,
      schemaAuthoringReady,
      schemaDraftEditorText,
      schemaDraftRaw,
      schemaDraftValidation.ok,
      userSchemaStore,
    ],
  );

  const loadSchemaStreamIntoEditor = useCallback(
    (stream: UserSchemaStream) => {
      const latestVersion = getLatestPublishedVersion(stream);
      const raw =
        stream.draft?.raw ?? latestVersion?.raw ?? buildDefaultSchemaDraft(doc.schemaRefs);
      setSchemaDraftEditorText(toEditorSchemaDraftText(raw));
      setSchemaDraftName(stream.name);
      setSchemaDraftNameTouched(true);
      setLoadedDraftSchemaRef(getUserSchemaRef(stream));
      setLoadedDraftSchemaBaseVersion(stream.draft?.baseVersion ?? latestVersion?.version);
      setSchemaDraftNotice(`Loaded ${stream.name} into the editor.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      setShowSchemaEditor(true);
    },
    [doc.schemaRefs],
  );

  const editSchemaStream = useCallback(
    (schemaRef: string) => {
      const nextSnapshot = persistLoadedSchemaDraft(userSchemaSnapshot);
      const stream = nextSnapshot.streams.find((entry) => getUserSchemaRef(entry) === schemaRef);
      if (!stream) return;
      if (nextSnapshot !== userSchemaSnapshot) {
        setUserSchemaSnapshot(nextSnapshot);
      }
      setRecentlyDeletedSchemaStream(undefined);
      loadSchemaStreamIntoEditor(stream);
      setReferencePanelMode('schemas');
    },
    [loadSchemaStreamIntoEditor, userSchemaSnapshot, persistLoadedSchemaDraft],
  );

  const deleteUserSchemaStream = useCallback(
    async (schemaRef: string) => {
      const streamName = parseSchemaRef(schemaRef).name;
      if (isRemotePersistence) {
        const deletedStream = userSchemaSnapshot.streams.find(
          (stream) => stream.name === streamName,
        );
        if (!deletedStream) return;
        const response = await deleteSchemaStream(streamName);
        if (response.status !== 204) {
          setSchemaDraftNotice(`Failed to delete ${streamName} (${response.status}).`);
          return;
        }
        setUserSchemaSnapshot((previous) =>
          deleteUserSchemaStreamFromSnapshot(previous, streamName),
        );
        const deletedSchemaRef = getUserSchemaRef(deletedStream);
        const wasLoaded = loadedDraftSchemaRef === deletedSchemaRef;
        setRecentlyDeletedSchemaStream({
          stream: deletedStream,
          index: userSchemaSnapshot.streams.findIndex((stream) => stream.name === streamName),
          wasLoaded,
          previousBaseVersion: loadedDraftSchemaBaseVersion,
        });
        if (wasLoaded) {
          setLoadedDraftSchemaRef(undefined);
          setLoadedDraftSchemaBaseVersion(undefined);
          setSchemaDraftNotice(
            `Deleted ${deletedStream.name}. The current editor is now an unsaved schema draft.`,
          );
        }
        setReferencePanelMode('schemas');
        return;
      }
      const deleted = userSchemaStore.deleteStream({
        snapshot: userSchemaSnapshot,
        name: streamName,
      });
      if (!deleted.deletedStream) return;
      setUserSchemaSnapshot(deleted.snapshot);
      const deletedSchemaRef = getUserSchemaRef(deleted.deletedStream);
      const wasLoaded = loadedDraftSchemaRef === deletedSchemaRef;
      setRecentlyDeletedSchemaStream({
        stream: deleted.deletedStream,
        index: deleted.deletedIndex,
        wasLoaded,
        previousBaseVersion: loadedDraftSchemaBaseVersion,
      });
      if (wasLoaded) {
        setLoadedDraftSchemaRef(undefined);
        setLoadedDraftSchemaBaseVersion(undefined);
        setSchemaDraftNotice(
          `Deleted ${deleted.deletedStream.name}. The current editor is now an unsaved schema draft.`,
        );
      }
      setReferencePanelMode('schemas');
    },
    [
      deleteUserSchemaStreamFromSnapshot,
      isRemotePersistence,
      loadedDraftSchemaBaseVersion,
      loadedDraftSchemaRef,
      userSchemaSnapshot,
      userSchemaStore,
    ],
  );

  const undoDeleteUserSchemaStream = useCallback(async () => {
    if (!recentlyDeletedSchemaStream) return;
    if (isRemotePersistence) {
      const restored = await replayRemoteSchemaStream(recentlyDeletedSchemaStream.stream);
      if (!restored) {
        setSchemaDraftNotice(`Failed to restore ${recentlyDeletedSchemaStream.stream.name}.`);
        return;
      }
      setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, restored));
      if (recentlyDeletedSchemaStream.wasLoaded) {
        setLoadedDraftSchemaRef(getUserSchemaRef(restored));
        setLoadedDraftSchemaBaseVersion(recentlyDeletedSchemaStream.previousBaseVersion);
        setSchemaDraftNotice(`Restored ${restored.name}.`);
      }
      setRecentlyDeletedSchemaStream(undefined);
      setReferencePanelMode('schemas');
      return;
    }
    const nextSnapshot = userSchemaStore.restoreStream({
      snapshot: userSchemaSnapshot,
      stream: recentlyDeletedSchemaStream.stream,
      index: recentlyDeletedSchemaStream.index,
    });
    setUserSchemaSnapshot(nextSnapshot);
    if (recentlyDeletedSchemaStream.wasLoaded) {
      setLoadedDraftSchemaRef(getUserSchemaRef(recentlyDeletedSchemaStream.stream));
      setLoadedDraftSchemaBaseVersion(recentlyDeletedSchemaStream.previousBaseVersion);
      setSchemaDraftNotice(`Restored ${recentlyDeletedSchemaStream.stream.name}.`);
    }
    setRecentlyDeletedSchemaStream(undefined);
    setReferencePanelMode('schemas');
  }, [
    isRemotePersistence,
    recentlyDeletedSchemaStream,
    replaceUserSchemaStreamSnapshot,
    replayRemoteSchemaStream,
    userSchemaSnapshot,
    userSchemaStore,
  ]);

  const resetSchemaDraft = useCallback(() => {
    if (loadedDraftSchemaStream) {
      loadSchemaStreamIntoEditor(loadedDraftSchemaStream);
      return;
    }
    const nextRaw = buildDefaultSchemaDraft(doc.schemaRefs);
    setSchemaDraftEditorText(toEditorSchemaDraftText(nextRaw));
    setSchemaDraftName(suggestUserSchemaName(toEditorSchemaDraftText(nextRaw)));
    setSchemaDraftNameTouched(false);
    setLoadedDraftSchemaRef(undefined);
    setLoadedDraftSchemaBaseVersion(undefined);
    setSchemaDraftNotice('Reset the editor draft to a fresh scratch schema.');
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [doc.schemaRefs, loadSchemaStreamIntoEditor, loadedDraftSchemaStream]);
  const startNewSchemaDraft = useCallback(() => {
    const nextSnapshot = persistLoadedSchemaDraft(userSchemaSnapshot);
    if (nextSnapshot !== userSchemaSnapshot) {
      setUserSchemaSnapshot(nextSnapshot);
    }
    const nextRaw = buildDefaultSchemaDraft(doc.schemaRefs);
    setSchemaDraftEditorText(toEditorSchemaDraftText(nextRaw));
    setSchemaDraftName(suggestUserSchemaName(toEditorSchemaDraftText(nextRaw)));
    setSchemaDraftNameTouched(false);
    setLoadedDraftSchemaRef(undefined);
    setLoadedDraftSchemaBaseVersion(undefined);
    setRecentlyDeletedSchemaStream(undefined);
    setSchemaDraftNotice('Started a fresh schema draft.');
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
    setShowSchemaEditor(true);
    setReferencePanelMode('schemas');
  }, [doc.schemaRefs, persistLoadedSchemaDraft, userSchemaSnapshot]);
  const showPublishedDiagramAction = Boolean(
    publishedDiagramActionLabel && isDraftSyncedWithLatestPublished && !isForkingSchemaByName,
  );

  const saveDraftAsNewUserSchema = useCallback(async () => {
    const existingStream = findUserSchemaStreamByName({
      snapshot: userSchemaSnapshot,
      name: normalizedDraftSchemaName,
    });
    if (existingStream) {
      if (isRemotePersistence) {
        const nextBaseVersion =
          existingStream.draft?.baseVersion ?? getLatestPublishedVersion(existingStream)?.version;
        const response = await saveSchemaDraft(existingStream.name, {
          raw: buildSchemaDraftFromEditorText({
            editorText: schemaDraftEditorText,
            identity: { owner: 'user', name: existingStream.name },
            version: nextBaseVersion ?? '1.0',
            previousRaw:
              existingStream.draft?.raw ?? getLatestPublishedVersion(existingStream)?.raw ?? '',
            fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
          }),
          valid: schemaDraftValidation.ok,
          baseVersion: nextBaseVersion,
          expectedStreamVersion: existingStream.streamVersion,
        });
        if (response.status !== 200) {
          setSchemaDraftNotice(`Failed to save ${existingStream.name} (${response.status}).`);
          return;
        }
        const nextStream = mapRemoteUserSchemaStream(response.data) ?? existingStream;
        setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, nextStream));
        setLoadedDraftSchemaRef(getUserSchemaRef(nextStream));
        setLoadedDraftSchemaBaseVersion(nextBaseVersion);
        setSchemaDraftName(nextStream.name);
        setSchemaDraftNameTouched(true);
        setSchemaDraftNotice(`Continued the working draft for ${nextStream.name}.`);
        setSchemaCookbookNoticeLines([]);
        setSchemaDraftHighlights([]);
        return;
      }
      const nextBaseVersion =
        existingStream.draft?.baseVersion ?? getLatestPublishedVersion(existingStream)?.version;
      const nextSnapshot = userSchemaStore.saveDraft({
        snapshot: userSchemaSnapshot,
        name: existingStream.name,
        raw: buildSchemaDraftFromEditorText({
          editorText: schemaDraftEditorText,
          identity: { owner: 'user', name: existingStream.name },
          version: nextBaseVersion ?? '1.0',
          previousRaw:
            existingStream.draft?.raw ?? getLatestPublishedVersion(existingStream)?.raw ?? '',
          fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
        }),
        valid: schemaDraftValidation.ok,
        baseVersion: nextBaseVersion,
      });
      const nextStream =
        nextSnapshot.streams.find((stream) => stream.name === existingStream.name) ??
        existingStream;
      setUserSchemaSnapshot(nextSnapshot);
      setLoadedDraftSchemaRef(getUserSchemaRef(nextStream));
      setLoadedDraftSchemaBaseVersion(nextBaseVersion);
      setSchemaDraftName(nextStream.name);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(`Continued the working draft for ${nextStream.name}.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }

    if (isRemotePersistence) {
      const response = await createSchemaStream({
        name: normalizedDraftSchemaName,
        raw: schemaDraftRaw,
        valid: schemaDraftValidation.ok,
      });
      if (response.status !== 201) {
        setSchemaDraftNotice(`Failed to create ${normalizedDraftSchemaName} (${response.status}).`);
        return;
      }
      const created = mapRemoteUserSchemaStream(response.data);
      if (!created) {
        setSchemaDraftNotice('Failed to load the saved schema draft.');
        return;
      }
      setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, created));
      setLoadedDraftSchemaRef(getUserSchemaRef(created));
      setLoadedDraftSchemaBaseVersion(undefined);
      setSchemaDraftName(created.name);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(`Saved ${created.name} as a personal schema draft.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }

    const created = userSchemaStore.saveDraftAsNew({
      snapshot: userSchemaSnapshot,
      raw: schemaDraftRaw,
      valid: schemaDraftValidation.ok,
      name: normalizedDraftSchemaName,
    });
    setUserSchemaSnapshot(created.snapshot);
    setLoadedDraftSchemaRef(getUserSchemaRef(created.stream));
    setLoadedDraftSchemaBaseVersion(undefined);
    setSchemaDraftName(created.stream.name);
    setSchemaDraftNameTouched(true);
    setSchemaDraftNotice(`Saved ${created.stream.name} as a personal schema draft.`);
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    latestCatalogVersionBySchemaRef,
    normalizedDraftSchemaName,
    userSchemaSnapshot,
    isRemotePersistence,
    replaceUserSchemaStreamSnapshot,
    schemaDraftEditorText,
    schemaDraftRaw,
    schemaDraftValidation.ok,
    userSchemaStore,
  ]);

  const saveDraftToCurrentUserSchema = useCallback(async () => {
    if (!loadedDraftSchemaStream) return;
    if (conflictingNamedStream) {
      setSchemaDraftNotice(
        `A schema named ${conflictingNamedStream.name} already exists. Continue that schema instead or choose a different name.`,
      );
      return;
    }
    const nextBaseVersion =
      loadedDraftSchemaBaseVersion ?? getLatestPublishedVersion(loadedDraftSchemaStream)?.version;
    const draftRaw = buildSchemaDraftFromEditorText({
      editorText: schemaDraftEditorText,
      identity: { owner: 'user', name: loadedDraftSchemaStream.name },
      version: nextBaseVersion ?? loadedDraftPublishedVersion?.version ?? '1.0',
      previousRaw: schemaDraftRaw,
      fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
    });
    if (isRemotePersistence) {
      const response = await saveSchemaDraft(loadedDraftSchemaStream.name, {
        raw: draftRaw,
        valid: schemaDraftValidation.ok,
        baseVersion: nextBaseVersion,
        expectedStreamVersion: loadedDraftSchemaStream.streamVersion,
      });
      if (response.status !== 200) {
        setSchemaDraftNotice(`Failed to save ${normalizedDraftSchemaName} (${response.status}).`);
        return;
      }
      const nextStream = mapRemoteUserSchemaStream(response.data);
      if (nextStream) {
        setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, nextStream));
      }
      setLoadedDraftSchemaBaseVersion(nextBaseVersion);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(`Saved the working draft for ${normalizedDraftSchemaName}.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }
    const nextSnapshot = userSchemaStore.saveDraft({
      snapshot: userSchemaSnapshot,
      name: loadedDraftSchemaStream.name,
      raw: draftRaw,
      valid: schemaDraftValidation.ok,
      baseVersion: nextBaseVersion,
    });
    setUserSchemaSnapshot(nextSnapshot);
    setLoadedDraftSchemaBaseVersion(nextBaseVersion);
    setSchemaDraftNameTouched(true);
    setSchemaDraftNotice(`Saved the working draft for ${normalizedDraftSchemaName}.`);
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    loadedDraftSchemaBaseVersion,
    loadedDraftSchemaStream,
    normalizedDraftSchemaName,
    userSchemaSnapshot,
    isRemotePersistence,
    latestCatalogVersionBySchemaRef,
    loadedDraftPublishedVersion?.version,
    replaceUserSchemaStreamSnapshot,
    schemaDraftEditorText,
    schemaDraftRaw,
    schemaDraftValidation.ok,
    conflictingNamedStream,
    userSchemaStore,
  ]);

  const saveForkedDraftAsNewUserSchema = useCallback(async () => {
    if (!loadedDraftSchemaStream || !isForkingSchemaByName) return;
    if (conflictingNamedStream) {
      setSchemaDraftNotice(
        `A schema named ${conflictingNamedStream.name} already exists. Choose a different name to save this as a new schema draft.`,
      );
      return;
    }
    if (isRemotePersistence) {
      const response = await createSchemaStream({
        name: normalizedDraftSchemaName,
        raw: schemaDraftRaw,
        valid: schemaDraftValidation.ok,
      });
      if (response.status !== 201) {
        setSchemaDraftNotice(`Failed to save ${normalizedDraftSchemaName} (${response.status}).`);
        return;
      }
      const created = mapRemoteUserSchemaStream(response.data);
      if (!created) {
        setSchemaDraftNotice('Failed to load the saved schema draft.');
        return;
      }
      setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, created));
      setLoadedDraftSchemaRef(getUserSchemaRef(created));
      setLoadedDraftSchemaBaseVersion(undefined);
      setSchemaDraftName(created.name);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(`Saved ${created.name} as a new personal schema draft.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }

    const created = userSchemaStore.saveDraftAsNew({
      snapshot: userSchemaSnapshot,
      raw: schemaDraftRaw,
      valid: schemaDraftValidation.ok,
      name: normalizedDraftSchemaName,
    });
    setUserSchemaSnapshot(created.snapshot);
    setLoadedDraftSchemaRef(getUserSchemaRef(created.stream));
    setLoadedDraftSchemaBaseVersion(undefined);
    setSchemaDraftName(created.stream.name);
    setSchemaDraftNameTouched(true);
    setSchemaDraftNotice(`Saved ${created.stream.name} as a new personal schema draft.`);
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    conflictingNamedStream,
    isForkingSchemaByName,
    isRemotePersistence,
    loadedDraftSchemaStream,
    normalizedDraftSchemaName,
    replaceUserSchemaStreamSnapshot,
    schemaDraftRaw,
    schemaDraftValidation.ok,
    userSchemaSnapshot,
    userSchemaStore,
  ]);

  const publishSchemaAsNewUserSchema = useCallback(async () => {
    if (
      !schemaDraftValidation.ok ||
      !schemaDraftValidation.draftModule ||
      !publishAssessmentSnapshot
    ) {
      return;
    }
    const existingStream = findUserSchemaStreamByName({
      snapshot: userSchemaSnapshot,
      name: normalizedDraftSchemaName,
    });
    if (existingStream) {
      editSchemaStream(getUserSchemaRef(existingStream));
      setSchemaDraftNotice(
        `Continuing ${existingStream.name}. Publish will create the next version on that schema.`,
      );
      return;
    }
    const publishedRaw = buildSchemaDraftFromEditorText({
      editorText: schemaDraftEditorText,
      identity: { owner: 'user', name: normalizedDraftSchemaName },
      version: '1.0',
      previousRaw: schemaDraftRaw,
      fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
    });
    if (isRemotePersistence) {
      const response = await publishSchemaVersion(normalizedDraftSchemaName, {
        raw: publishedRaw,
        version: '1.0',
        assessment: toRemoteAssessment(publishAssessmentSnapshot),
      });
      if (response.status !== 201) {
        setSchemaDraftNotice(
          `Failed to publish ${normalizedDraftSchemaName} (${response.status}).`,
        );
        return;
      }
      const nextStream = mapRemoteUserSchemaStream(response.data);
      if (!nextStream) {
        setSchemaDraftNotice('Failed to load the published schema.');
        return;
      }
      setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, nextStream));
      setLoadedDraftSchemaRef(buildSchemaId({ owner: 'user', name: normalizedDraftSchemaName }));
      setLoadedDraftSchemaBaseVersion('1.0');
      setSchemaDraftName(normalizedDraftSchemaName);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(`Published ${normalizedDraftSchemaName} v1.0.`);
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }
    const nextSnapshot = userSchemaStore.publish({
      snapshot: userSchemaSnapshot,
      name: normalizedDraftSchemaName,
      version: '1.0',
      raw: publishedRaw,
      assessment: publishAssessmentSnapshot,
    });
    setUserSchemaSnapshot(nextSnapshot);
    setLoadedDraftSchemaRef(buildSchemaId({ owner: 'user', name: normalizedDraftSchemaName }));
    setLoadedDraftSchemaBaseVersion('1.0');
    setSchemaDraftName(normalizedDraftSchemaName);
    setSchemaDraftNameTouched(true);
    setSchemaDraftNotice(`Published ${normalizedDraftSchemaName} v1.0.`);
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    normalizedDraftSchemaName,
    userSchemaSnapshot,
    isRemotePersistence,
    latestCatalogVersionBySchemaRef,
    publishAssessmentSnapshot,
    replaceUserSchemaStreamSnapshot,
    schemaDraftEditorText,
    schemaDraftRaw,
    schemaDraftValidation.draftModule,
    schemaDraftValidation.ok,
    editSchemaStream,
    toRemoteAssessment,
    userSchemaStore,
  ]);

  const publishNewUserSchemaVersion = useCallback(async () => {
    if (
      !loadedDraftSchemaStream ||
      !schemaDraftValidation.ok ||
      !schemaDraftValidation.draftModule ||
      !schemaPublishAssessment?.ok ||
      !schemaPublishAssessment.hasEffectiveChanges
    ) {
      return;
    }
    if (conflictingNamedStream) {
      setSchemaDraftNotice(
        `A schema named ${conflictingNamedStream.name} already exists. Continue that schema instead or choose a different name.`,
      );
      return;
    }
    const nextName = normalizedDraftSchemaName;
    const nextVersion =
      suggestedPublishedVersion ??
      getNextTwoPartVersion(
        getLatestPublishedVersion(loadedDraftSchemaStream)?.version,
        schemaPublishAssessment.recommendedBump,
      ) ??
      '1.0';
    const nextRaw = buildSchemaDraftFromEditorText({
      editorText: schemaDraftEditorText,
      identity: { owner: 'user', name: loadedDraftSchemaStream.name },
      version: nextVersion,
      previousRaw: schemaDraftRaw,
      fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
    });
    if (isRemotePersistence) {
      const response = await publishSchemaVersion(nextName, {
        raw: nextRaw,
        version: nextVersion,
        assessment: toRemoteAssessment(publishAssessmentSnapshot),
        expectedStreamVersion: loadedDraftSchemaStream.streamVersion,
      });
      if (response.status !== 201) {
        setSchemaDraftNotice(`Failed to publish ${nextName} (${response.status}).`);
        return;
      }
      const nextStream = mapRemoteUserSchemaStream(response.data);
      if (nextStream) {
        setUserSchemaSnapshot((previous) => replaceUserSchemaStreamSnapshot(previous, nextStream));
      }
      setLoadedDraftSchemaBaseVersion(nextVersion);
      setSchemaDraftName(nextName);
      setSchemaDraftNameTouched(true);
      setSchemaDraftNotice(
        schemaPublishAssessment.backwardCompatible === false
          ? `Published ${nextName} v${nextVersion}. This version may break older diagrams.`
          : `Published ${nextName} v${nextVersion}.`,
      );
      setSchemaCookbookNoticeLines([]);
      setSchemaDraftHighlights([]);
      return;
    }
    const nextSnapshot = userSchemaStore.publish({
      snapshot: userSchemaSnapshot,
      name: nextName,
      version: nextVersion,
      raw: nextRaw,
      assessment: publishAssessmentSnapshot,
    });
    setUserSchemaSnapshot(nextSnapshot);
    setLoadedDraftSchemaBaseVersion(nextVersion);
    setSchemaDraftName(nextName);
    setSchemaDraftNameTouched(true);
    setSchemaDraftNotice(
      schemaPublishAssessment.backwardCompatible === false
        ? `Published ${nextName} v${nextVersion}. This version may break older diagrams.`
        : `Published ${nextName} v${nextVersion}.`,
    );
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    loadedDraftSchemaStream,
    userSchemaSnapshot,
    publishAssessmentSnapshot,
    latestCatalogVersionBySchemaRef,
    isRemotePersistence,
    normalizedDraftSchemaName,
    replaceUserSchemaStreamSnapshot,
    schemaDraftEditorText,
    schemaDraftRaw,
    schemaPublishAssessment,
    schemaDraftValidation.draftModule,
    schemaDraftValidation.ok,
    suggestedPublishedVersion,
    conflictingNamedStream,
    toRemoteAssessment,
    userSchemaStore,
  ]);

  const saveDraftLabel = 'Save draft';
  const saveDraftDisabled = !schemaAuthoringReady;
  const saveDraftDisabledReason = saveDraftDisabled ? 'Schema tools are loading.' : undefined;
  const publishLabel = `Publish ${suggestedPublishedVersion ? `v${suggestedPublishedVersion}` : 'schema'}`;
  const schemaManagerNotice = recentlyDeletedSchemaStream
    ? `Deleted ${recentlyDeletedSchemaStream.stream.name}.`
    : undefined;
  const handleSaveDraft = isForkingSchemaByName
    ? saveForkedDraftAsNewUserSchema
    : loadedDraftSchemaStream
      ? saveDraftToCurrentUserSchema
      : saveDraftAsNewUserSchema;
  const handlePublish = isForkingSchemaByName
    ? publishSchemaAsNewUserSchema
    : loadedDraftSchemaStream
      ? publishNewUserSchemaVersion
      : publishSchemaAsNewUserSchema;
  const resetDraftLabel = loadedDraftSchemaStream?.draft
    ? 'Reset to saved draft'
    : loadedDraftPublishedVersion
      ? `Reset to v${loadedDraftPublishedVersion.version}`
      : 'Reset to scratch';

  const applyPublishedSchemaToDiagram = useCallback(() => {
    if (!publishedDiagramImpact || !loadedDraftSchemaStream || !latestPublishedDraftVersion) {
      return;
    }
    const introducedErrors = publishedDiagramImpact.introducedDiagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (introducedErrors.length > 0) {
      return;
    }
    commitDoc(publishedDiagramImpact.sanitizedCandidateDoc);
    setSchemaDraftNotice(
      currentLoadedDraftSchemaVersion
        ? `Upgraded the diagram to ${loadedDraftSchemaStream.name} v${latestPublishedDraftVersion.version}.`
        : `Applied ${loadedDraftSchemaStream.name} v${latestPublishedDraftVersion.version} to the diagram.`,
    );
    setSchemaCookbookNoticeLines([]);
    setSchemaDraftHighlights([]);
  }, [
    commitDoc,
    currentLoadedDraftSchemaVersion,
    latestPublishedDraftVersion,
    loadedDraftSchemaStream,
    publishedDiagramImpact,
  ]);

  const validateImportedDiagramText = useCallback(
    (text: string, options?: { fallbackName?: string; sourceLabel?: string }) => {
      return prepareImportedDiagram({
        raw: text,
        schemaVersionCatalog,
        snapshot: diagramSnapshotRef.current,
        fallbackName: options?.fallbackName,
        sourceLabel: options?.sourceLabel,
      });
    },
    [schemaVersionCatalog],
  );

  const withImportedRawName = useCallback((raw: string, name: string | undefined) => {
    if (!name?.trim()) return raw;
    try {
      const parsed = parseSemanticSourceDocument(raw);
      return serializeSourceDocument({
        ...parsed,
        metadata: {
          ...parsed.metadata,
          name,
        },
      });
    } catch {
      return raw;
    }
  }, []);

  const importDiagramText = useCallback(
    (
      text: string,
      options?: { fallbackName?: string; successMessage?: string; sourceLabel?: string },
    ):
      | { ok: true; streamName: string }
      | { ok: false; noticeLines: FailedPreparedImportedDiagram['noticeLines'] } => {
      const imported = validateImportedDiagramText(text, {
        fallbackName: options?.fallbackName,
        sourceLabel: options?.sourceLabel,
      });
      if (imported.ok === false) {
        setDocumentNoticeLines(imported.noticeLines);
        return { ok: false, noticeLines: imported.noticeLines };
      }
      const persisted = persistActiveDiagramDraft();
      const nextDoc = createDiagramStoreDoc({
        snapshot: persisted.snapshot,
        doc: imported.loaded.doc,
      });
      const nextRaw = withImportedRawName(imported.raw, nextDoc.metadata?.name);
      const created = diagramStore.createStream({
        snapshot: persisted.snapshot,
        name: nextDoc.metadata?.name,
        raw: nextRaw,
        valid: true,
        scope: activeDiagramStream?.scope ?? DEFAULT_DIAGRAM_OWNER_SCOPE,
      });
      clearWorkspaceDiagramTransientState();
      setSelectedEntity(undefined);
      setSelectedEdge(undefined);
      clearNewDiagramTransition();
      setDiagramSnapshot(created.snapshot);
      setActiveDiagramId(created.stream.id);
      setHistory(createHistory(nextDoc));
      setSourceDiagramDiagnostics(imported.loaded.sourceDiagnostics);
      setDocumentNoticeLines([
        options?.successMessage ?? `Imported ${created.stream.name} as a new diagram.`,
      ]);
      return { ok: true, streamName: created.stream.name };
    },
    [
      activeDiagramStream?.scope,
      clearWorkspaceDiagramTransientState,
      clearNewDiagramTransition,
      diagramStore,
      persistActiveDiagramDraft,
      setSelectedEdge,
      setSelectedEntity,
      validateImportedDiagramText,
      withImportedRawName,
    ],
  );

  const importJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      return importDiagramText(text, {
        fallbackName: stripDiagramFileExtension(file.name),
        sourceLabel: file.name,
      });
    },
    [importDiagramText],
  );

  const openSchemaEditor = useCallback(() => {
    setShowSchemaEditor(true);
  }, []);

  const closeSchemaEditor = useCallback(() => {
    setShowSchemaEditor(false);
  }, []);

  const revertDiagramNameChange = useCallback(() => {
    if (!activeDiagramStream) return;
    commitDoc((previous) => withDocumentName(previous, activeDiagramStream.name), {
      undoable: false,
    });
    setDocumentNoticeLines([`Reverted the pending rename for ${activeDiagramStream.name}.`]);
  }, [activeDiagramStream, commitDoc]);

  const onPaletteAdd = useCallback((typeId: string) => {
    workspaceDiagramRuntimeRef.current?.addEntityFromPalette(typeId);
  }, []);

  const handleInsertCookbookRecipe = useCallback(
    (recipeId: string) => {
      if (!schemaAuthoringSupport) {
        setSchemaDraftNotice('Schema tools are loading.');
        return;
      }
      const recipe = availableSchemaCookbookRecipes.find((entry) => entry.id === recipeId);
      if (!recipe || !canInsertCookbook) return;
      const mergeResult = schemaAuthoringSupport.mergeSchemaCookbookRecipeIntoDraft({
        draftText: schemaDraftEditorText,
        recipe,
      });
      setSchemaDraftEditorText(mergeResult.nextDraftText);
      setSchemaDraftHighlights(mergeResult.insertedRanges);
      setSchemaCookbookNoticeLines(mergeResult.messageLines);
      setSchemaDraftNotice(undefined);
      setShowSchemaEditor(true);
      setReferencePanelMode('cookbook');
    },
    [
      availableSchemaCookbookRecipes,
      canInsertCookbook,
      schemaAuthoringSupport,
      schemaDraftEditorText,
    ],
  );

  const workspaceBannerProps =
    guestImportConflictNames.length > 0
      ? {
          tone: 'warning' as const,
          message: `Local schemas conflict with your account: ${guestImportConflictNames.join(', ')}.`,
          actions: [
            {
              label: isImportingGuestWorkspace ? 'Importing…' : 'Import renamed copies',
              onClick: () => {
                setGuestImportConflictDismissed(false);
                void runGuestWorkspaceImport(true);
              },
              emphasis: 'strong' as const,
            },
            {
              label: 'Keep local only for now',
              onClick: () => setGuestImportConflictDismissed(true),
              emphasis: 'subtle' as const,
            },
          ],
        }
      : guestImportNotice
        ? {
            tone: 'success' as const,
            message: guestImportNotice,
            actions: [
              {
                label: 'Dismiss',
                onClick: () => setGuestImportNotice(undefined),
                emphasis: 'subtle' as const,
              },
            ],
          }
        : undefined;

  return {
    importDiagramText,
    workspaceBannerProps,
    topBarProps: {
      onExport: exportJson,
      onImport: importJson,
      diagramName: doc.metadata?.name ?? '',
      onDiagramNameChange: updateDiagramName,
      diagramNameReadOnly: false,
      diagramStatusLabel: documentStatusLabel,
      onCheckpointDiagram: checkpointDiagram,
      checkpointDiagramLabel,
      checkpointDiagramDisabled: !canCheckpointDiagram,
      checkpointDiagramDisabledReason: documentCheckpointDisabledReason,
      onSaveAsNewDiagram: hasPendingDiagramNameChange ? saveAsNewDiagram : undefined,
      saveAsNewDiagramLabel,
      saveAsNewDiagramDisabled: !canSaveAsNewDiagram,
      saveAsNewDiagramDisabledReason,
      onStartNewDiagram: createNewDiagram,
      onRevertDiagramName: hasPendingDiagramNameChange ? revertDiagramNameChange : undefined,
    },
    diagramToolbarProps: {
      onUndo: undo,
      onRedo: redo,
      canUndo,
      canRedo,
      searchQuery: diagramSearchQuery,
      onSearchQueryChange: setDiagramSearchQuery,
      onClearSearch: clearDiagramSearch,
      searchTotalMatches,
      searchHiddenMatches,
      onRevealSearchResults: searchHiddenMatches > 0 ? revealDiagramSearchResults : undefined,
    },
    settingsPanelProps: {
      nodeVisualMode,
      onNodeVisualModeChange: setNodeVisualMode,
    },
    workspaceClassName: `workspace${showSchemaEditor ? ' workspace--schema-editor-open' : ''}${
      showInspector ? '' : ' workspace--no-inspector'
    }`,
    showSchemaEditor,
    openSchemaEditor,
    closeSchemaEditor,
    editorPanelProps: {
      documentManagerStreams: diagramManagerStreams,
      onOpenDiagramStream: loadDiagramStream,
      onRestoreDiagramRevision: restoreDiagramRevision,
      schemaDraftText: schemaDraftEditorText,
      onSchemaDraftChange: (next: string) => {
        setSchemaDraftEditorText(next);
        setSchemaDraftNotice(undefined);
        setSchemaCookbookNoticeLines([]);
        setSchemaDraftHighlights([]);
      },
      schemaDraftName,
      schemaDraftVersionLabel,
      onSchemaDraftNameChange: (next: string) => {
        setSchemaDraftName(next);
        setSchemaDraftNameTouched(true);
        setSchemaDraftNotice(undefined);
      },
      onResetSchemaDraft: resetSchemaDraft,
      resetDraftLabel,
      draftSchemaDiagnostics: schemaDraftValidation.diagnostics,
      schemaDraftNoticeLines: [
        ...(schemaDraftNotice ? [schemaDraftNotice] : []),
        ...schemaCookbookNoticeLines,
      ],
      schemaStateTone: schemaCardTone,
      schemaStateLines: schemaCardLines,
      diagramStateTone,
      diagramStateLines,
      schemaDraftHighlights:
        schemaDraftValidation.diagnostics.length > 0 || schemaCardTone === 'invalid'
          ? []
          : schemaDraftHighlights,
      saveDraftLabel,
      saveDraftDisabled,
      saveDraftDisabledReason,
      onSaveDraft: handleSaveDraft,
      canPublish,
      publishLabel,
      onPublish: handlePublish,
      showPublishedDiagramAction,
      publishedDiagramActionLabel,
      publishedDiagramActionDisabled,
      publishedDiagramActionDisabledReason,
      onApplyPublishedSchema: applyPublishedSchemaToDiagram,
      referencePanelMode,
      onSelectReferencePanel: (mode: 'cookbook' | 'dependencies' | 'reference' | 'schemas') =>
        setReferencePanelMode((previous) => (previous === mode ? undefined : mode)),
      schemaCookbookRecipes: availableSchemaCookbookRecipes,
      canInsertCookbook,
      schemaCookbookDisabledReason: cookbookDisabledReason,
      onInsertSchemaCookbookRecipe: handleInsertCookbookRecipe,
      schemaDependencies,
      schemaReferenceSections,
      schemaManagerStreams,
      schemaManagerNotice,
      onEditSchemaStream: editSchemaStream,
      onDeleteSchemaStream: deleteUserSchemaStream,
      onUndoDeleteSchemaStream: undoDeleteUserSchemaStream,
      onStartNewSchemaDraft: startNewSchemaDraft,
    },
    paletteProps: {
      viewModel: paletteViewModel,
      onAdd: onPaletteAdd,
    },
    workspaceDiagramRuntimeRef,
    workspaceDiagramModel,
  };
}
