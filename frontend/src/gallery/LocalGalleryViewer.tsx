import { buildSchemaVersionCatalog } from '@tarskia/diagram-semantics';
import { useMemo } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import type { PublicGalleryShellContext } from '../PublicGalleryShell';
import { semanticBootstrap } from '../semantic/bootstrap';
import { DiagramErrorBoundary } from './DiagramErrorBoundary';
import { GalleryDiagramViewer } from './PublicGalleryViewer';

export default function LocalGalleryViewer() {
  const { localDiagram } = useOutletContext<PublicGalleryShellContext>() ?? {};
  const catalog = useMemo(
    () =>
      buildSchemaVersionCatalog([
        ...semanticBootstrap.builtInSchemaCatalogEntries,
        ...(localDiagram?.schemaEntries ?? []),
      ]),
    [localDiagram],
  );
  if (!localDiagram) return <Navigate to="/gallery" replace />;
  return (
    <DiagramErrorBoundary>
      <GalleryDiagramViewer
        raw={localDiagram.raw}
        title={localDiagram.title}
        schemaVersionCatalog={catalog}
      />
    </DiagramErrorBoundary>
  );
}
