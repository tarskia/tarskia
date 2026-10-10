import type { SchemaSemantics } from '@tarskia/diagram-semantics';
import {
  buildSchemaRuntimeFromCatalog,
  buildSemanticIndex,
  type DiagramContent,
  type EntityIndex,
  type SchemaModule,
  type SchemaRuntime,
  type SchemaVersionCatalog,
  type SemanticDocument,
  type SemanticIndex,
  type Diagnostic as ValidationDiagnostic,
} from '@tarskia/diagram-semantics';
import { useMemo } from 'react';
import { validateDiagramDoc } from '../model/validation';

type SchemaRuntimeResult = ReturnType<typeof buildSchemaRuntimeFromCatalog>;

export interface DiagramSemanticRuntime {
  doc: DiagramContent;
  index: SemanticIndex;
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

  const index = buildSemanticIndex(params.doc, schema);
  return {
    doc: params.doc,
    index,
    schemaRuntimeResult,
    schemaRuntime: schemaRuntimeResult.runtime,
    schema,
    schemaSemantics: schemaRuntimeResult.runtime.semantics,
    entityIndex: index.entityIndex,
    diagnostics,
    validationDiagnostics,
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
  };
};

export const useDiagramSemanticRuntime = (params: {
  doc: DiagramContent;
  /** The loaded snapshot, including its initial view, remains fixed during viewer navigation. */
  validationDocument?: SemanticDocument;
  schemaVersionCatalog: SchemaVersionCatalog;
  fallbackSchema?: SchemaModule;
  sourceDiagnostics?: ValidationDiagnostic[];
}): DiagramSemanticRuntime => {
  const { doc, fallbackSchema, schemaVersionCatalog, sourceDiagnostics } = params;
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
  const index = useMemo(() => buildSemanticIndex(doc, schema), [doc, schema]);
  const entityIndex = index.entityIndex;
  const validationDocument = params.validationDocument ?? doc;
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
      index,
      schemaRuntimeResult,
      schemaRuntime: schemaRuntimeResult.runtime,
      schema,
      schemaSemantics: schemaRuntimeResult.runtime.semantics,
      entityIndex,
      diagnostics,
      validationDiagnostics,
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    }),
    [doc, index, schemaRuntimeResult, schema, entityIndex, diagnostics, validationDiagnostics],
  );
};
