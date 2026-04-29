import { createMapSourceGraphResolver, type SourceGraphResolver } from '@tarskia/diagram-semantics';
import type { DiagramStoreSnapshot } from './diagram-store';
import { getDiagramHeadRevision } from './diagram-store';

export * from '@tarskia/diagram-semantics';

export const createSnapshotSourceGraphResolver = (
  snapshot: DiagramStoreSnapshot,
): SourceGraphResolver =>
  createMapSourceGraphResolver(
    Object.fromEntries(
      snapshot.streams.flatMap((stream) => {
        const raw = stream.draft?.raw ?? getDiagramHeadRevision(stream)?.raw;
        return raw ? [[stream.slug, raw] as const] : [];
      }),
    ),
  );
