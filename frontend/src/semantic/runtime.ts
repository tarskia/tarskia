import type { SchemaSemantics } from '@tarskia/diagram-semantics';
import { useMemo } from 'react';

import type { Diagnostic as ValidationDiagnostic } from '../model/diagnostics';
import { buildEntityIndex, type EntityIndex } from '../model/entity-tree';
import type { SchemaModule, SchemaRuntime, SemanticDocument } from '../model/types';
import { validateDiagramDoc } from '../model/validation';
import {
  buildSchemaRuntimeFromCatalog,
  type SchemaVersionCatalog,
} from '../model/validation/schema-closure';

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
  schemaVersionCatalog: SchemaVersionCatalog;
  fallbackSchema?: SchemaModule;
  sourceDiagnostics?: ValidationDiagnostic[];
}): DiagramSemanticRuntime => {
  const { doc, fallbackSchema, schemaVersionCatalog, sourceDiagnostics } = params;
  return useMemo(
    () =>
      buildDiagramSemanticRuntime({
        doc,
        fallbackSchema,
        schemaVersionCatalog,
        sourceDiagnostics,
      }),
    [doc, fallbackSchema, schemaVersionCatalog, sourceDiagnostics],
  );
};
