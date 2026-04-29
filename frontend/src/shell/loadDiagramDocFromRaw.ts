import type { SemanticDocument } from '../semantic';
import {
  compileSourceGraph,
  createSnapshotSourceGraphResolver,
  type DiagramStoreSnapshot,
  ingestSemanticSourceDocument,
} from '../semantic';

export interface LoadedDiagramDoc {
  doc: SemanticDocument;
  sourceDiagnostics: ReturnType<typeof compileSourceGraph>['diagnostics'];
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

export const createBlankDiagramDocument = (version: string): SemanticDocument => ({
  version,
  schemaRefs: [],
  entities: [],
  relations: [],
  metadata: {},
});

export const loadDiagramDocFromRaw = (params: {
  raw: string;
  streamName: string;
  sourceLabel: string;
  snapshot?: DiagramStoreSnapshot;
}): LoadedDiagramDoc => {
  const parsedSourceResult = ingestSemanticSourceDocument({
    raw: params.raw,
    path: params.sourceLabel,
    messagePrefix: params.sourceLabel,
  });
  if (!parsedSourceResult.ok || !parsedSourceResult.value) {
    return {
      doc: withDocumentName(createBlankDiagramDocument('0.1.0'), params.streamName),
      sourceDiagnostics: parsedSourceResult.diagnostics,
    };
  }
  const parsedSource = parsedSourceResult.value;
  if (!parsedSource.imports || parsedSource.imports.length === 0) {
    const doc = parsedSource.metadata?.name?.trim()
      ? parsedSource
      : withDocumentName(parsedSource, params.streamName);
    return {
      doc,
      sourceDiagnostics: [],
    };
  }

  const compiled = compileSourceGraph({
    raw: params.raw,
    sourceLabel: params.sourceLabel,
    ...(params.snapshot ? { resolver: createSnapshotSourceGraphResolver(params.snapshot) } : {}),
  });
  const doc = withDocumentName(
    compiled.result?.doc ?? createBlankDiagramDocument(parsedSource.version),
    parsedSource.metadata?.name?.trim() || params.streamName,
  );
  return {
    doc,
    sourceDiagnostics: compiled.diagnostics,
  };
};
