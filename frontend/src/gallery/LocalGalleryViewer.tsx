import { buildSchemaVersionCatalog } from '@tarskia/diagram-semantics';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import type { PublicGalleryShellContext } from '../PublicGalleryShell';
import { semanticBootstrap } from '../semantic/bootstrap';
import { DiagramErrorBoundary } from './DiagramErrorBoundary';
import { GalleryDiagramViewer } from './PublicGalleryViewer';
import { fetchStartupDiagram, hasStartupOpen } from './startup-open';

export default function LocalGalleryViewer() {
  const { localDiagram, setLocalDiagram } = useOutletContext<PublicGalleryShellContext>() ?? {};
  const [error, setError] = useState<string>();
  const startup = hasStartupOpen();
  useEffect(() => {
    if (localDiagram || !startup) return;
    const controller = new AbortController();
    void fetchStartupDiagram(controller.signal).then(
      (diagram) => {
        if (!controller.signal.aborted) setLocalDiagram?.(diagram);
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Unable to open files.');
      },
    );
    return () => controller.abort();
  }, [localDiagram, setLocalDiagram, startup]);
  const catalog = useMemo(
    () =>
      buildSchemaVersionCatalog([
        ...semanticBootstrap.builtInSchemaCatalogEntries,
        ...(localDiagram?.schemaEntries ?? []),
      ]),
    [localDiagram],
  );
  if (!localDiagram) {
    if (error)
      return (
        <p role="alert" className="p-6 text-destructive">
          {error}
        </p>
      );
    if (startup)
      return (
        <p role="status" className="p-6 text-muted-foreground">
          Opening diagrams…
        </p>
      );
    return <Navigate to="/gallery" replace />;
  }
  return (
    <DiagramErrorBoundary>
      <GalleryDiagramViewer
        comparison={localDiagram.comparison}
        raw={localDiagram.raw}
        title={localDiagram.title}
        schemaVersionCatalog={catalog}
      />
    </DiagramErrorBoundary>
  );
}
