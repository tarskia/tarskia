import {
  type DiagramStoreSnapshot,
  parseSemanticDocument,
  type SemanticDocument,
  serializeDocument,
} from '../semantic';

interface StarterLike {
  document: SemanticDocument;
  label: string;
}

const LEGACY_BUNDLED_STARTER_SLUGS = new Set(['starter-architecture', 'event-pipeline']);

export const reconcileBundledStarterArtifacts = (params: {
  snapshot: DiagramStoreSnapshot;
  starters: StarterLike[];
}) => {
  const canonicalizeStarterDocument = (document: SemanticDocument): SemanticDocument => ({
    ...document,
    view: undefined,
  });
  const canonicalizeRawForStarterComparison = (raw: string) => {
    try {
      return serializeDocument(canonicalizeStarterDocument(parseSemanticDocument(raw)));
    } catch {
      return undefined;
    }
  };
  const starterCanonicalRawSet = new Set(
    params.starters.map((starter) =>
      serializeDocument(canonicalizeStarterDocument(starter.document)),
    ),
  );

  let changed = false;
  const streams = params.snapshot.streams.flatMap((stream) => {
    if (
      LEGACY_BUNDLED_STARTER_SLUGS.has(stream.slug) &&
      stream.revisions.length === 0 &&
      !stream.draft?.baseRevisionId
    ) {
      changed = true;
      return [];
    }

    if (!stream.draft || stream.revisions.length > 0 || stream.draft.baseRevisionId) {
      return [stream];
    }

    const canonicalDraftRaw = canonicalizeRawForStarterComparison(stream.draft.raw);
    if (!canonicalDraftRaw || !starterCanonicalRawSet.has(canonicalDraftRaw)) {
      return [stream];
    }

    changed = true;
    return [];
  });

  return {
    changed,
    snapshot: changed ? { streams } : params.snapshot,
  };
};
