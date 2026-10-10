import {
  applySavedView,
  type DiagramView,
  hashDiagramContent,
  type SemanticIndex,
} from '@tarskia/diagram-semantics';
import { useEffect, useMemo, useState } from 'react';
import { decodeSharedView } from './shared-view-link';

export function useSharedGalleryView({
  index,
  defaultView,
  encoded,
  namespace,
  slug,
  enabled,
}: {
  index: SemanticIndex;
  defaultView: DiagramView | undefined;
  encoded: string | null;
  namespace: string;
  slug: string;
  enabled: boolean;
}) {
  const revision = useMemo(() => hashDiagramContent(index.content), [index]);
  const key = `${namespace}/${slug}?view=${JSON.stringify(encoded)}`;
  const [view, setView] = useState(defaultView);
  const [loaded, setLoaded] = useState<{
    index: SemanticIndex;
    key: string;
    camera: DiagramView['camera'];
  }>();
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setNotice(false);
    const load = async () => {
      let initialView = defaultView;
      let dropped = false;
      if (encoded !== null) {
        try {
          const saved = await decodeSharedView(encoded, { namespace, slug });
          const applied = applySavedView(index, saved, revision);
          initialView = applied.view;
          dropped =
            applied.report.droppedIds.length > 0 ||
            applied.report.scopeRootDropped ||
            applied.report.anchorDropped;
        } catch {
          if (active) console.warn('Could not open the shared view; using the diagram default.');
        }
      }
      if (!active) return;
      setView(initialView);
      setLoaded({ index, key, camera: initialView?.camera });
      setNotice(dropped);
    };
    void load();
    return () => {
      active = false;
    };
  }, [index, defaultView, encoded, namespace, slug, key, revision, enabled]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(false), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    view,
    setView,
    revision,
    key,
    ready: enabled && loaded?.index === index && loaded.key === key,
    savedCamera: loaded?.camera,
    notice,
    dismissNotice: () => setNotice(false),
  };
}
