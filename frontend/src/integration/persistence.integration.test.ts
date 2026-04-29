import { describe, expect, it } from 'vitest';
import {
  checkpointRemoteDiagram,
  createRemoteDiagramStream,
  createRemoteSchemaStream,
  fetchCurrentMember,
  getRemoteDiagramStream,
  getRemoteSchemaStream,
  listRemoteDiagramStreamSummaries,
  publishRemoteSchemaVersion,
  RemoteDiagramDraftConflictError,
  RemotePersistenceError,
  saveRemoteDiagramDraftIfChanged,
  saveRemoteSchemaDraft,
} from '../persistence/remote-api';
import { createRemoteDiagramDraftSaveQueue } from '../persistence/remote-diagram-draft-queue';
import { createTestIdentity, withTestIdentity } from './test-identity';

const diagramRaw = (name: string) =>
  `
version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
metadata:
  name: ${name}
entities:
  - id: ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-service
    type: core/web-app.types.application
    name: ${name}
relations: []
`.trim();

const schemaRaw = (name: string, version = '1.0') =>
  `
owner: user
name: ${name}
version: "${version}"
types:
  - id: ${name}
    label: ${name}
relations: []
`.trim();

describe('frontend persistence integration', () => {
  it('creates, lists, and loads diagram streams through the live API', async () => {
    const identity = createTestIdentity('diagram-roundtrip');
    const request = withTestIdentity(identity);

    const created = await createRemoteDiagramStream(
      {
        name: 'Payments Integration',
        raw: diagramRaw('Payments Integration'),
        valid: true,
      },
      request,
    );

    const summaries = await listRemoteDiagramStreamSummaries(request);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).toBe(created.id);
    expect(summaries[0]?.name).toBe('Payments Integration');

    const loaded = await getRemoteDiagramStream(created.id, request);
    expect(loaded.id).toBe(created.id);
    expect(loaded.draft?.raw).toContain('Payments Integration');
    expect(loaded.streamVersion).toBe(created.streamVersion);
  });

  it('saves diagram drafts, suppresses no-op saves, and detects stale versions', async () => {
    const identity = createTestIdentity('diagram-draft-save');
    const request = withTestIdentity(identity);
    const created = await createRemoteDiagramStream(
      {
        name: 'Payments Draft',
        raw: diagramRaw('Payments Draft'),
        valid: true,
      },
      request,
    );

    const changed = await saveRemoteDiagramDraftIfChanged(
      created,
      {
        name: 'Payments Draft',
        raw: diagramRaw('Payments Draft Updated'),
        valid: true,
        baseRevisionId: created.draft?.baseRevisionId,
      },
      request,
    );

    expect(changed.savedRemotely).toBe(true);
    expect(changed.stream.streamVersion).toBe(created.streamVersion + 1);
    expect(changed.stream.draft?.raw).toContain('Payments Draft Updated');

    const noOp = await saveRemoteDiagramDraftIfChanged(
      changed.stream,
      {
        name: changed.stream.draft?.name ?? changed.stream.name,
        raw: changed.stream.draft?.raw ?? '',
        valid: changed.stream.draft?.valid ?? false,
        baseRevisionId: changed.stream.draft?.baseRevisionId,
      },
      request,
    );

    expect(noOp.savedRemotely).toBe(false);
    expect(noOp.stream.streamVersion).toBe(changed.stream.streamVersion);

    const reloaded = await getRemoteDiagramStream(created.id, request);
    expect(reloaded.streamVersion).toBe(changed.stream.streamVersion);

    await expect(
      saveRemoteDiagramDraftIfChanged(
        created,
        {
          name: 'Payments Draft',
          raw: diagramRaw('Payments Draft Stale'),
          valid: true,
          baseRevisionId: created.draft?.baseRevisionId,
        },
        request,
      ),
    ).rejects.toBeInstanceOf(RemoteDiagramDraftConflictError);
  });

  it('drops non-UUID base revision ids before remote draft saves', async () => {
    const identity = createTestIdentity('diagram-draft-sanitize-base-revision');
    const request = withTestIdentity(identity);
    const created = await createRemoteDiagramStream(
      {
        name: 'Sanitized Draft',
        raw: diagramRaw('Sanitized Draft'),
        valid: true,
      },
      request,
    );

    const saved = await saveRemoteDiagramDraftIfChanged(
      created,
      {
        name: 'Sanitized Draft',
        raw: diagramRaw('Sanitized Draft Updated'),
        valid: true,
        baseRevisionId: 'revision-2',
      },
      request,
    );

    expect(saved.savedRemotely).toBe(true);
    expect(saved.stream.draft?.raw).toContain('Sanitized Draft Updated');
  });

  it('serializes overlapping remote draft saves into a single-flight queue', async () => {
    const identity = createTestIdentity('diagram-save-queue');
    const request = withTestIdentity(identity);
    let current = await createRemoteDiagramStream(
      {
        name: 'Queue Diagram',
        raw: diagramRaw('Queue Diagram'),
        valid: true,
      },
      request,
    );

    const queue = createRemoteDiagramDraftSaveQueue({
      applyOptimisticDraft(streamId, payload) {
        if (current.id !== streamId || !current.draft) return;
        current = {
          ...current,
          draft: {
            ...current.draft,
            raw: payload.raw,
            name: payload.name,
            valid: payload.valid,
            baseRevisionId: payload.baseRevisionId,
          },
        };
      },
      getStream(streamId) {
        return current.id === streamId ? current : undefined;
      },
      onConflict(_streamId, latestStream) {
        if (latestStream) {
          current = latestStream;
        }
      },
      onError(message) {
        throw new Error(message);
      },
      onSaved(stream) {
        current = stream;
      },
      saveDraft(stream, payload) {
        return saveRemoteDiagramDraftIfChanged(stream, payload, request);
      },
    });

    queue.enqueue(current.id, {
      name: current.name,
      raw: diagramRaw('Queue Draft One'),
      valid: true,
      baseRevisionId: current.draft?.baseRevisionId,
    });
    queue.enqueue(current.id, {
      name: current.name,
      raw: diagramRaw('Queue Draft Two'),
      valid: true,
      baseRevisionId: current.draft?.baseRevisionId,
    });
    queue.enqueue(current.id, {
      name: current.name,
      raw: diagramRaw('Queue Draft Three'),
      valid: true,
      baseRevisionId: current.draft?.baseRevisionId,
    });

    await queue.whenIdle(current.id);

    const reloaded = await getRemoteDiagramStream(current.id, request);
    expect(reloaded.draft?.raw).toContain('Queue Draft Three');
    expect(reloaded.streamVersion).toBe(3);
  });

  it('creates, saves, publishes, and reloads schema streams with per-principal uniqueness', async () => {
    const primaryIdentity = createTestIdentity('schema-roundtrip-primary');
    const secondaryIdentity = createTestIdentity('schema-roundtrip-secondary');
    const primaryRequest = withTestIdentity(primaryIdentity);
    const secondaryRequest = withTestIdentity(secondaryIdentity);

    const created = await createRemoteSchemaStream(
      {
        name: 'Payments',
        raw: schemaRaw('payments'),
        valid: true,
      },
      primaryRequest,
    );

    const saved = await saveRemoteSchemaDraft(
      created,
      {
        raw: schemaRaw('payments', '1.1'),
        valid: true,
        baseVersion: '1.0',
      },
      primaryRequest,
    );

    expect(saved.streamVersion).toBe(created.streamVersion + 1);
    expect(saved.draft?.raw).toContain('version: "1.1"');

    const published = await publishRemoteSchemaVersion(
      saved,
      {
        raw: schemaRaw('payments', '1.1'),
        version: '1.1',
        assessment: { summaryLines: ['Published v1.1'] },
      },
      primaryRequest,
    );

    expect(published.draft).toBeUndefined();
    expect(published.versions.some((version) => version.version === '1.1')).toBe(true);

    const reloaded = await getRemoteSchemaStream('payments', primaryRequest);
    expect(reloaded.versions.some((version) => version.version === '1.1')).toBe(true);

    await expect(
      createRemoteSchemaStream(
        {
          name: 'Payments',
          raw: schemaRaw('payments'),
          valid: true,
        },
        primaryRequest,
      ),
    ).rejects.toBeInstanceOf(RemotePersistenceError);

    const sameNameDifferentOwner = await createRemoteSchemaStream(
      {
        name: 'Payments',
        raw: schemaRaw('payments'),
        valid: true,
      },
      secondaryRequest,
    );
    expect(sameNameDifferentOwner.name).toBe('payments');
  });

  it('seeds starter diagrams exactly once for a new authenticated identity', async () => {
    const identity = createTestIdentity('starter-diagrams');
    const request = withTestIdentity(identity);

    const me = await fetchCurrentMember(request);
    expect(me.member?.principalId).toBeTruthy();

    const initialSummaries = await listRemoteDiagramStreamSummaries(request);
    expect(initialSummaries.length).toBeGreaterThan(0);

    const created = await createRemoteDiagramStream(
      {
        name: 'My Extra Diagram',
        raw: diagramRaw('My Extra Diagram'),
        valid: true,
      },
      request,
    );

    const meAgain = await fetchCurrentMember(request);
    expect(meAgain.member?.principalId).toBe(me.member?.principalId);

    const laterSummaries = await listRemoteDiagramStreamSummaries(request);
    expect(laterSummaries.some((stream) => stream.id === created.id)).toBe(true);
    expect(laterSummaries).toHaveLength(initialSummaries.length + 1);
  });

  it('surfaces diagram checkpoints through the same persistence client', async () => {
    const identity = createTestIdentity('diagram-checkpoint');
    const request = withTestIdentity(identity);
    const created = await createRemoteDiagramStream(
      {
        name: 'Checkpoint Diagram',
        raw: diagramRaw('Checkpoint Diagram'),
        valid: true,
      },
      request,
    );

    const checkpointed = await checkpointRemoteDiagram(
      created,
      {
        name: 'Checkpoint Diagram',
        raw: diagramRaw('Checkpoint Diagram v2'),
        valid: true,
        baseRevisionId: created.draft?.baseRevisionId,
        summaryLines: ['Created first checkpoint'],
      },
      request,
    );

    expect(checkpointed.revisions).toHaveLength(1);
    expect(checkpointed.headRevisionId).toBe(checkpointed.revisions[0]?.id);

    const reloaded = await getRemoteDiagramStream(checkpointed.id, request);
    expect(reloaded.revisions).toHaveLength(1);
    expect(reloaded.draft?.baseRevisionId).toBe(reloaded.revisions[0]?.id);
  });
});
