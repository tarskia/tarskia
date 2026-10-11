import {
  buildSchemaVersionCatalog,
  type SchemaVersionCatalogEntry,
  type SemanticDocument,
  serializeDocument,
} from '@tarskia/diagram-semantics';
import { useMemo } from 'react';
import { semanticBootstrap } from '../semantic/bootstrap';
import { GalleryDiagramViewer } from './PublicGalleryViewer';

/** Programmatic comparison entry point, using the current schemas for both sides. */
export function ComparisonGalleryViewer({
  before,
  after,
  schemas,
}: {
  before: SemanticDocument;
  after: SemanticDocument;
  schemas: SchemaVersionCatalogEntry[];
}) {
  const comparison = useMemo(() => ({ before, after }), [before, after]);
  const catalog = useMemo(
    () => buildSchemaVersionCatalog([...semanticBootstrap.builtInSchemaCatalogEntries, ...schemas]),
    [schemas],
  );
  const raw = useMemo(() => serializeDocument(after), [after]);
  return (
    <GalleryDiagramViewer
      raw={raw}
      title={after.metadata?.name ?? 'Diagram changes'}
      schemaVersionCatalog={catalog}
      comparison={comparison}
    />
  );
}
