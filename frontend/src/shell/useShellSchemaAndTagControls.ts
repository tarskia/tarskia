import { useCallback, useMemo } from 'react';

import {
  areSchemaActivationListsEqual,
  buildNextSchemaActivations,
  buildSchemaLockReasons,
  collectSchemaSwitchValidation,
  type EntityIndex,
  parseSchemaId,
  type RawSchemaSet,
  type SchemaActivation,
  type SchemaCatalogEntry,
  type SchemaModule,
  type SchemaRuntime,
  type SemanticDocument,
} from '../semantic';
import { buildDiagramImpactNoticeLines } from './schema-impact-notices';
import type { CommitDoc } from './types';

interface UseShellSchemaAndTagControlsArgs {
  doc: SemanticDocument;
  entityIndex: EntityIndex;
  relations: SemanticDocument['relations'];
  commitDoc: CommitDoc;
  schemaOptions: SchemaCatalogEntry[];
  rawSchemaSet: RawSchemaSet;
  schemaRuntime: SchemaRuntime;
  resolveActivatedSchema: (activations?: SchemaActivation[]) => SchemaModule;
}

export function useShellSchemaAndTagControls({
  doc,
  entityIndex,
  relations,
  commitDoc,
  schemaOptions,
  rawSchemaSet,
  schemaRuntime,
  resolveActivatedSchema,
}: UseShellSchemaAndTagControlsArgs) {
  const explicitSelectedSchemaIds = useMemo(() => {
    if (doc.schemaRefs === undefined) {
      return schemaOptions.map((entry) => entry.id);
    }
    const selected = new Set(doc.schemaRefs.map((activation) => parseSchemaId(activation.schema)));
    return schemaOptions.map((entry) => entry.id).filter((id) => selected.has(id));
  }, [doc.schemaRefs, schemaOptions]);

  const selectedSchemaIds = useMemo(() => {
    const selected = new Set(schemaRuntime.resolved.resolvedModuleIds);
    return schemaOptions.map((entry) => entry.id).filter((id) => selected.has(id));
  }, [schemaOptions, schemaRuntime.resolved.resolvedModuleIds]);
  const currentSchema = useMemo(
    () => resolveActivatedSchema(doc.schemaRefs),
    [doc.schemaRefs, resolveActivatedSchema],
  );

  const schemaLockReasons = useMemo(
    () =>
      buildSchemaLockReasons({
        schemaCatalog: schemaOptions,
        schemaRegistry: rawSchemaSet.modulesById,
        selectedSchemaIds,
        entityIndex,
        relations,
      }),
    [entityIndex, rawSchemaSet.modulesById, relations, schemaOptions, selectedSchemaIds],
  );

  const schemaToggleBlockReasons = useMemo(() => {
    const refs = doc.schemaRefs ?? [];
    const reasons: Record<string, string> = {};
    for (const schemaOption of schemaOptions) {
      const selected = explicitSelectedSchemaIds.includes(schemaOption.id);
      const nextSelectedIds = schemaOptions
        .map((entry) => entry.id)
        .filter((id) =>
          id === schemaOption.id ? !selected : explicitSelectedSchemaIds.includes(id),
        );
      const nextSchemaActivations = buildNextSchemaActivations({
        currentActivations: refs,
        selectedSchemaIds: nextSelectedIds,
        schemaCatalog: schemaOptions,
      });
      if (areSchemaActivationListsEqual(nextSchemaActivations, refs)) {
        continue;
      }
      const candidateDoc: SemanticDocument = {
        ...doc,
        schemaRefs: nextSchemaActivations,
      };
      const { introducedDiagnostics } = collectSchemaSwitchValidation({
        currentDoc: doc,
        candidateDoc,
        currentSchema,
        candidateSchema: resolveActivatedSchema(nextSchemaActivations),
      });
      const lines = buildDiagramImpactNoticeLines(
        introducedDiagnostics,
        'This schema selection would invalidate the current diagram.',
      );
      if (lines.length > 0) {
        reasons[schemaOption.id] = lines.join('\n');
      }
    }
    return reasons;
  }, [currentSchema, doc, explicitSelectedSchemaIds, resolveActivatedSchema, schemaOptions]);

  const setSchemaSelection = useCallback(
    (selectedIds: string[]) => {
      const refs = doc.schemaRefs ?? [];
      const nextSchemaActivations = buildNextSchemaActivations({
        currentActivations: refs,
        selectedSchemaIds: selectedIds,
        schemaCatalog: schemaOptions,
      });
      if (areSchemaActivationListsEqual(nextSchemaActivations, refs)) return;

      const candidateDoc: SemanticDocument = {
        ...doc,
        schemaRefs: nextSchemaActivations,
      };
      const { sanitizedCandidateDoc, introducedDiagnostics } = collectSchemaSwitchValidation({
        currentDoc: doc,
        candidateDoc,
        currentSchema,
        candidateSchema: resolveActivatedSchema(nextSchemaActivations),
      });
      if (introducedDiagnostics.length > 0) {
        return;
      }
      commitDoc(sanitizedCandidateDoc);
    },
    [commitDoc, currentSchema, doc, resolveActivatedSchema, schemaOptions],
  );

  const toggleSchemaSelection = useCallback(
    (schemaRef: string) => {
      const selected = new Set(explicitSelectedSchemaIds);
      if (selected.has(schemaRef)) {
        selected.delete(schemaRef);
      } else {
        selected.add(schemaRef);
      }
      const next = schemaOptions.map((entry) => entry.id).filter((id) => selected.has(id));
      setSchemaSelection(next);
    },
    [explicitSelectedSchemaIds, schemaOptions, setSchemaSelection],
  );

  return {
    selectedSchemaIds,
    schemaLockReasons,
    schemaToggleBlockReasons,
    toggleSchemaSelection,
  };
}
