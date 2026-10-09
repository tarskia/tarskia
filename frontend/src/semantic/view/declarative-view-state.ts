import {
  type DiagramView,
  type DocumentLayout,
  normalizeDiagramViewState,
  type SemanticDocument,
  type ViewportState,
} from '@tarskia/diagram-semantics';
import { useMemo } from 'react';

export interface DiagramSemanticState {
  version: SemanticDocument['version'];
  schemaRefs: SemanticDocument['schemaRefs'];
  entities: SemanticDocument['entities'];
  relations: SemanticDocument['relations'];
  inputs: SemanticDocument['inputs'];
  metadata: SemanticDocument['metadata'];
}

export interface DeclarativeDiagramViewState {
  view: DiagramView;
  layout: DocumentLayout;
  expanded: Record<string, boolean>;
  expandedKey: string;
  hiddenKey: string;
  highlightedKey: string;
  layoutKey: string;
  key: string;
}

const collectNodeIdsByFlag = (ids: Set<string>): string[] =>
  [...ids].sort((leftId, rightId) => leftId.localeCompare(rightId));

const sortObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, sortObjectKeys(entryValue)]),
    );
  }
  return value;
};

const stableKey = (value: unknown) => JSON.stringify(sortObjectKeys(value));

/** Camera and declarative view changes do not change semantic identity. */
export const useDiagramSemanticState = (doc: SemanticDocument): DiagramSemanticState => {
  const { version, schemaRefs, entities, relations, inputs, metadata } = doc;
  return useMemo(
    () => ({ version, schemaRefs, entities, relations, inputs, metadata }),
    [version, schemaRefs, entities, relations, inputs, metadata],
  );
};

export const buildSemanticStateDocument = (
  semanticState: DiagramSemanticState,
): SemanticDocument => ({
  version: semanticState.version,
  schemaRefs: semanticState.schemaRefs,
  entities: semanticState.entities,
  relations: semanticState.relations,
  inputs: semanticState.inputs,
  metadata: semanticState.metadata,
});

export const selectDeclarativeDiagramViewState = (
  doc: Pick<SemanticDocument, 'view'>,
): DeclarativeDiagramViewState => {
  const normalizedViewState = normalizeDiagramViewState(doc.view);
  const view = normalizedViewState.view as DiagramView;
  const layout = normalizedViewState.layout as DocumentLayout;
  const expanded = normalizedViewState.expanded;
  const hiddenIds = collectNodeIdsByFlag(normalizedViewState.hiddenIds);
  const highlightedIds = collectNodeIdsByFlag(normalizedViewState.highlightedIds);
  const expandedKey = stableKey(expanded);
  const hiddenKey = stableKey(hiddenIds);
  const highlightedKey = stableKey(highlightedIds);
  const layoutKey = stableKey(layout);

  return {
    view,
    layout,
    expanded,
    expandedKey,
    hiddenKey,
    highlightedKey,
    layoutKey,
    key: stableKey({
      scopeRootId: view.scopeRootId,
      expanded,
      hiddenIds,
      highlightedIds,
      layout,
    }),
  };
};

export const combineDiagramSemanticAndDeclarativeViewState = (params: {
  semanticState: DiagramSemanticState;
  declarativeViewState: DeclarativeDiagramViewState;
}): SemanticDocument => {
  const { semanticState, declarativeViewState } = params;
  return {
    ...buildSemanticStateDocument(semanticState),
    view: {
      ...declarativeViewState.view,
      layout: declarativeViewState.layout,
    },
  };
};

export const getDeclarativeViewport = (layout: DocumentLayout): ViewportState | undefined =>
  layout.viewport;
