import {
  buildDiagramSemanticRuntime,
  type DiagramStoreSnapshot,
  diagnosticsToMessages,
  type SchemaVersionCatalog,
} from '../semantic';
import { type LoadedDiagramDoc, loadDiagramDocFromRaw } from './loadDiagramDocFromRaw';

const DEFAULT_IMPORTED_DIAGRAM_NAME = 'Imported diagram';
const DEFAULT_IMPORTED_SOURCE_LABEL = 'diagram import';
const IMPORT_FAILED_LINE = 'Import failed.';
const DEFAULT_MAX_IMPORT_NOTICE_DETAILS = 4;

export type PreparedImportedDiagram =
  | {
      ok: true;
      loaded: LoadedDiagramDoc;
      raw: string;
    }
  | {
      ok: false;
      noticeLines: string[];
    };

export type FailedPreparedImportedDiagram = Extract<PreparedImportedDiagram, { ok: false }>;

export const formatDiagramImportFailureNotice = (
  label: string,
  noticeLines: string[],
  options: { maxDetails?: number } = {},
): string => {
  const maxDetails = options.maxDetails ?? DEFAULT_MAX_IMPORT_NOTICE_DETAILS;
  const details = noticeLines.filter((line) => line.trim() && line.trim() !== IMPORT_FAILED_LINE);
  const lines = [`Failed to import ${label}.`, ...details.slice(0, maxDetails)];
  const remainingCount = details.length - Math.min(details.length, maxDetails);
  if (remainingCount > 0) {
    lines.push(`...and ${remainingCount} more issue${remainingCount === 1 ? '' : 's'}.`);
  }
  return lines.join('\n');
};

interface PrepareImportedDiagramParams {
  raw: string;
  schemaVersionCatalog: SchemaVersionCatalog;
  snapshot?: DiagramStoreSnapshot;
  fallbackName?: string;
  sourceLabel?: string;
}

export const prepareImportedDiagram = (
  params: PrepareImportedDiagramParams,
): PreparedImportedDiagram => {
  const loaded = loadDiagramDocFromRaw({
    raw: params.raw,
    streamName: params.fallbackName?.trim() || DEFAULT_IMPORTED_DIAGRAM_NAME,
    sourceLabel: params.sourceLabel?.trim() || DEFAULT_IMPORTED_SOURCE_LABEL,
    ...(params.snapshot ? { snapshot: params.snapshot } : {}),
  });
  const runtime = buildDiagramSemanticRuntime({
    doc: loaded.doc,
    schemaVersionCatalog: params.schemaVersionCatalog,
    sourceDiagnostics: loaded.sourceDiagnostics,
  });
  const errors = runtime.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  if (errors.length > 0) {
    return {
      ok: false,
      noticeLines: [IMPORT_FAILED_LINE, ...diagnosticsToMessages(errors)],
    };
  }

  return {
    ok: true,
    loaded,
    raw: params.raw,
  };
};
