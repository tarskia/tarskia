import {
  type DiagramView,
  type DocumentLayout,
  normalizeDiagramViewState,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';

export interface DeclarativeDiagramViewState {
  view: DiagramView;
  layout: DocumentLayout;
  expanded: Record<string, boolean>;
  expandedKey: string;
  highlightedKey: string;
  layoutKey: string;
  key: string;
}

// Intern small structural selections, never the document, geometry, or camera.
// Matching flag sets retain their revision even if another view flag changes.
let nextRevision = 0;
const flagRevisions: { ids: string[]; revision: string }[] = [];
const revisionFor = (ids: string[]) => {
  ids.sort();
  const existing = flagRevisions.find(
    (entry) => entry.ids.length === ids.length && entry.ids.every((id, i) => id === ids[i]),
  );
  if (existing) return existing.revision;
  const revision = String(++nextRevision);
  flagRevisions.push({ ids, revision });
  if (flagRevisions.length > 256) flagRevisions.shift();
  return revision;
};
const cache = new WeakMap<object, Map<string | undefined, DeclarativeDiagramViewState>>();
const emptyNodes = {};

export const selectDeclarativeDiagramViewState = (
  doc: Pick<SemanticDocument, 'view'>,
): DeclarativeDiagramViewState => {
  const nodes = doc.view?.nodesById ?? emptyNodes;
  const scope = doc.view?.scopeRootId;
  const cached = cache.get(nodes)?.get(scope);
  if (cached) return cached;
  const normalized = normalizeDiagramViewState(doc.view);
  const expandedKey = revisionFor(Object.keys(normalized.expanded));
  const highlightedKey = revisionFor([...normalized.highlightedIds]);
  const result = {
    view: normalized.view,
    layout: normalized.layout,
    expanded: normalized.expanded,
    expandedKey,
    highlightedKey,
    // Layout is fixed; viewport persistence never changes structural transitions.
    layoutKey: 'fixed-layout',
    key: `${scope?.length ?? 0}:${scope ?? ''}:${expandedKey}:${highlightedKey}`,
  };
  let scopes = cache.get(nodes);
  if (!scopes) {
    scopes = new Map();
    cache.set(nodes, scopes);
  }
  scopes.set(scope, result);
  return result;
};
