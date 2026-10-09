import type { SemanticDocument, ViewportState } from '@tarskia/diagram-semantics';
import { useCallback, useRef } from 'react';

/** Remember the camera without changing the document or scheduling a viewer render. */
export function useViewerViewport(loadedDocument: SemanticDocument | undefined) {
  const camera = useRef({
    document: loadedDocument,
    viewport: undefined as ViewportState | undefined,
  });
  if (camera.current.document !== loadedDocument) {
    camera.current = { document: loadedDocument, viewport: undefined as ViewportState | undefined };
  }
  const persistViewport = useCallback((viewport: ViewportState) => {
    camera.current.viewport = viewport;
  }, []);
  return { savedCamera: loadedDocument?.view?.camera, persistViewport };
}
