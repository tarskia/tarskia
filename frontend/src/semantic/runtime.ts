import type { SchemaSemantics } from '@tarskia/diagram-semantics';
import {
  buildEntityIndex,
  type EntityIndex,
  type SchemaModule,
  type SchemaRuntime,
  type SemanticDocument,
  type Diagnostic as ValidationDiagnostic,
} from '@tarskia/diagram-semantics';
import { useMemo } from 'react';
import { validateDiagramDoc } from '../model/validation';
import {
  buildSchemaRuntimeFromCatalog,
  type SchemaVersionCatalog,
} from '../model/validation/schema-closure';
import { buildSemanticStateDocument, useDiagramSemanticState } from './view/declarative-view-state';

type SchemaRuntimeResult = ReturnType<typeof buildSchemaRuntimeFromCatalog>;

export interface DiagramSemanticRuntime {
  doc: SemanticDocument;
  schemaRuntimeResult: SchemaRuntimeResult;
  schemaRuntime: SchemaRuntime;
  schema: SchemaModule;
  schemaSemantics: SchemaSemantics;
  entityIndex: EntityIndex;
  diagnostics: ValidationDiagnostic[];
  validationDiagnostics: ValidationDiagnostic[];
  valid: boolean;
}

export const buildDiagramSemanticRuntime = (params: {
  doc: SemanticDocument;
  schemaVersionCatalog: SchemaVersionCatalog;
  fallbackSchema?: SchemaModule;
  sourceDiagnostics?: ValidationDiagnostic[];
}): DiagramSemanticRuntime => {
  const schemaRuntimeResult = buildSchemaRuntimeFromCatalog({
    catalog: params.schemaVersionCatalog,
    activations: params.doc.schemaRefs,
  });
  const schema = schemaRuntimeResult.runtime.resolved.effectiveSchema ?? params.fallbackSchema;
  if (!schema) {
    throw new Error('Unable to resolve a schema for the active semantic runtime.');
  }

  const validationDiagnostics = validateDiagramDoc(params.doc, schema).diagnostics;
  const diagnostics = [
    ...(params.sourceDiagnostics ?? []),
    ...schemaRuntimeResult.diagnostics,
    ...validationDiagnostics,
  ];

  return {
    doc: params.doc,
    schemaRuntimeResult,
    schemaRuntime: schemaRuntimeResult.runtime,
    schema,
    schemaSemantics: schemaRuntimeResult.runtime.semantics,
    entityIndex: buildEntityIndex(params.doc.entities),
    diagnostics,
    validationDiagnostics,
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
  };
};

export const useDiagramSemanticRuntime = (params: {
  doc: SemanticDocument;
  /** The loaded snapshot, including its initial view, remains fixed during viewer navigation. */
  validationDocument?: SemanticDocument;
  schemaVersionCatalog: SchemaVersionCatalog;
  fallbackSchema?: SchemaModule;
  sourceDiagnostics?: ValidationDiagnostic[];
}): DiagramSemanticRuntime => {
  const { doc, fallbackSchema, schemaVersionCatalog, sourceDiagnostics } = params;
  const semanticState = useDiagramSemanticState(doc);
  const semanticDocument = useMemo(
    () => buildSemanticStateDocument(semanticState),
    [semanticState],
  );
  const schemaRuntimeResult = useMemo(
    () =>
      buildSchemaRuntimeFromCatalog({
        catalog: schemaVersionCatalog,
        activations: doc.schemaRefs,
      }),
    [schemaVersionCatalog, doc.schemaRefs],
  );
  const schema = schemaRuntimeResult.runtime.resolved.effectiveSchema ?? fallbackSchema;
  if (!schema) throw new Error('Unable to resolve a schema for the active semantic runtime.');
  const entityIndex = useMemo(() => buildEntityIndex(doc.entities), [doc.entities]);
  const validationDocument = params.validationDocument ?? semanticDocument;
  const validationDiagnostics = useMemo(
    () => validateDiagramDoc(validationDocument, schema).diagnostics,
    [validationDocument, schema],
  );
  const diagnostics = useMemo(
    () => [
      ...(sourceDiagnostics ?? []),
      ...schemaRuntimeResult.diagnostics,
      ...validationDiagnostics,
    ],
    [sourceDiagnostics, schemaRuntimeResult, validationDiagnostics],
  );
  return useMemo(
    () => ({
      doc,
      schemaRuntimeResult,
      schemaRuntime: schemaRuntimeResult.runtime,
      schema,
      schemaSemantics: schemaRuntimeResult.runtime.semantics,
      entityIndex,
      diagnostics,
      validationDiagnostics,
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    }),
    [doc, schemaRuntimeResult, schema, entityIndex, diagnostics, validationDiagnostics],
  );
};
