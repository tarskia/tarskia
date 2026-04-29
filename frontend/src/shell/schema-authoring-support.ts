import {
  assessSchemaEditorInput,
  buildDefaultSchemaActivation,
  buildSchemaActivation,
  buildSchemaVersionCatalog,
  collectSchemaSwitchValidation,
  diagnosticsToMessages,
  getUserSchemaRef,
  parseAndValidateSchemaModule,
  parseSchemaRef,
  type SchemaActivation,
  type SchemaEditorAssessment,
  type SchemaModule,
  type SchemaPublishAssessment,
  type SchemaPublishAssessmentSnapshot,
  type SchemaValidationAssessment,
  type SchemaVersionCatalog,
  type SemanticDocument,
  type UserSchemaStream,
  type UserSchemaVersionRecord,
} from '../semantic';
import { type SchemaCookbookRecipe, schemaCookbookRecipes } from './schema-cookbook';
import {
  buildSchemaDependencyReferences,
  type SchemaDependencyReference,
} from './schema-dependency-reference';
import { buildDiagramImpactNoticeLines } from './schema-impact-notices';

type DiagramImpact = ReturnType<typeof collectSchemaSwitchValidation>;

export interface SchemaAuthoringDerivedState {
  schemaDraftValidation: SchemaValidationAssessment;
  schemaPublishAssessment?: SchemaPublishAssessment;
  suggestedPublishedVersion?: string;
  publishAssessmentSnapshot?: SchemaPublishAssessmentSnapshot;
  canPublish: boolean;
  canInsertCookbook: boolean;
  schemaDependencies: SchemaDependencyReference[];
  cookbookDisabledReason?: string;
  schemaCardTone: 'valid' | 'invalid' | 'pending';
  schemaCardLines: string[];
  diagramStateTone: 'valid' | 'invalid' | 'pending';
  diagramStateLines: string[];
  schemaCookbookRecipes: SchemaCookbookRecipe[];
  publishedDiagramImpact?: DiagramImpact;
  publishedDiagramActionDisabled: boolean;
  publishedDiagramActionDisabledReason?: string;
}

export interface SchemaAuthoringParams {
  debouncedSchemaDraftRaw: string;
  schemaDraftRaw: string;
  schemaDraftBaseRaw: string;
  schemaDraftEditorText: string;
  schemaVersionCatalog: SchemaVersionCatalog;
  nextDraftAssessmentSchemaId: string;
  nextDraftAssessmentVersion: string;
  draftSchemaPending: boolean;
  latestCatalogVersionBySchemaRef: Map<string, string>;
  publishMode: 'initial' | 'update';
  loadedDraftSchemaStream?: UserSchemaStream;
  loadedDraftPublishedVersion?: UserSchemaVersionRecord;
  doc: SemanticDocument;
  schema: SchemaModule;
  isForkingSchemaByName: boolean;
  resolveActivatedSchema: (
    schemaVersionCatalog: SchemaVersionCatalog,
    activations?: SchemaActivation[],
  ) => SchemaModule;
}

const upsertVersionedSchemaActivation = (
  activations: SchemaActivation[],
  schemaId: string,
  version: string,
) => {
  const nextRef = `${schemaId}@${version}`;
  let replaced = false;
  const next = activations.map((activation) => {
    if (!activation.schema.startsWith(`${schemaId}@`)) return activation;
    replaced = true;
    return buildSchemaActivation(nextRef, activation.layer);
  });
  if (!replaced) {
    next.unshift(buildDefaultSchemaActivation(nextRef));
  }
  return next;
};

const withSchemaModuleIdentity = (
  module: SchemaModule,
  schemaId: string,
  version: string,
): SchemaModule => ({
  ...module,
  owner: parseSchemaRef(schemaId).owner,
  name: parseSchemaRef(schemaId).name,
  version,
});

const buildSchemaCard = (params: {
  draftSchemaPending: boolean;
  schemaEditorAssessment: SchemaEditorAssessment;
}) => {
  const { draftSchemaPending, schemaEditorAssessment } = params;
  const schemaDraftValidation = schemaEditorAssessment.schema;
  const schemaPublishAssessment = schemaEditorAssessment.publish;
  const firstSchemaAssessmentError =
    diagnosticsToMessages(
      schemaDraftValidation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    )[0] ??
    diagnosticsToMessages(
      (schemaPublishAssessment?.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.severity === 'error',
      ),
    )[0];
  const schemaCardTone: 'valid' | 'invalid' | 'pending' = draftSchemaPending
    ? 'pending'
    : schemaDraftValidation.ok && schemaPublishAssessment?.ok
      ? 'valid'
      : 'invalid';
  const schemaCardLines = draftSchemaPending
    ? ['Validating current draft…']
    : schemaCardTone === 'valid'
      ? schemaEditorAssessment.summaryLines
      : [
          firstSchemaAssessmentError ??
            'The schema draft must validate before it can be published.',
        ];
  return {
    schemaCardTone,
    schemaCardLines,
  };
};

const buildDraftDiagramImpact = (params: {
  debouncedSchemaDraftRaw: string;
  doc: SemanticDocument;
  isForkingSchemaByName: boolean;
  nextDraftAssessmentSchemaId: string;
  nextDraftAssessmentVersion: string;
  resolveActivatedSchema: (
    schemaVersionCatalog: SchemaVersionCatalog,
    activations?: SchemaActivation[],
  ) => SchemaModule;
  schema: SchemaModule;
  schemaVersionCatalog: SchemaVersionCatalog;
  schemaDraftValidation: SchemaValidationAssessment;
}) => {
  const {
    debouncedSchemaDraftRaw,
    doc,
    isForkingSchemaByName,
    nextDraftAssessmentSchemaId,
    nextDraftAssessmentVersion,
    resolveActivatedSchema,
    schema,
    schemaVersionCatalog,
    schemaDraftValidation,
  } = params;
  if (!schemaDraftValidation.ok || !schemaDraftValidation.draftModule || isForkingSchemaByName) {
    return undefined;
  }
  const draftModuleForSelection = withSchemaModuleIdentity(
    schemaDraftValidation.draftModule,
    nextDraftAssessmentSchemaId,
    nextDraftAssessmentVersion,
  );
  const candidateSchemaActivations = upsertVersionedSchemaActivation(
    doc.schemaRefs ?? [],
    nextDraftAssessmentSchemaId,
    nextDraftAssessmentVersion,
  );
  const candidateSchemaVersionCatalog = buildSchemaVersionCatalog([
    ...schemaVersionCatalog.entries,
    {
      schemaId: nextDraftAssessmentSchemaId,
      version: nextDraftAssessmentVersion,
      raw: debouncedSchemaDraftRaw,
      module: draftModuleForSelection,
    },
  ]);
  return collectSchemaSwitchValidation({
    currentDoc: doc,
    candidateDoc: {
      ...doc,
      schemaRefs: candidateSchemaActivations,
    },
    currentSchema: schema,
    candidateSchema: resolveActivatedSchema(
      candidateSchemaVersionCatalog,
      candidateSchemaActivations,
    ),
  });
};

const buildDiagramState = (params: {
  draftSchemaPending: boolean;
  schemaDraftValidation: SchemaValidationAssessment;
  draftDiagramImpact?: DiagramImpact;
}) => {
  const { draftSchemaPending, schemaDraftValidation, draftDiagramImpact } = params;
  const draftDiagramImpactNoticeLines = draftSchemaPending
    ? []
    : buildDiagramImpactNoticeLines(
        draftDiagramImpact?.introducedDiagnostics ?? [],
        'The current diagram would not validate under this schema.',
      );
  const diagramStateTone: 'valid' | 'invalid' | 'pending' = draftSchemaPending
    ? 'pending'
    : !schemaDraftValidation.ok
      ? 'pending'
      : draftDiagramImpactNoticeLines.length > 0
        ? 'invalid'
        : 'valid';
  const diagramStateLines = draftSchemaPending
    ? ['Checking the current diagram against this draft…']
    : !schemaDraftValidation.ok
      ? ['Diagram compatibility will be checked when the schema is valid.']
      : draftDiagramImpactNoticeLines.length > 0
        ? draftDiagramImpactNoticeLines
        : ['Current diagram is compatible with this schema.'];
  return {
    diagramStateTone,
    diagramStateLines,
  };
};

const buildPublishedDiagramImpact = (params: {
  doc: SemanticDocument;
  loadedDraftSchemaStream?: UserSchemaStream;
  latestPublishedDraftVersion?: UserSchemaVersionRecord;
  resolveActivatedSchema: (
    schemaVersionCatalog: SchemaVersionCatalog,
    activations?: SchemaActivation[],
  ) => SchemaModule;
  schema: SchemaModule;
  schemaVersionCatalog: SchemaVersionCatalog;
}) => {
  const {
    doc,
    loadedDraftSchemaStream,
    latestPublishedDraftVersion,
    resolveActivatedSchema,
    schema,
    schemaVersionCatalog,
  } = params;
  if (!loadedDraftSchemaStream || !latestPublishedDraftVersion) return undefined;
  const schemaId = getUserSchemaRef(loadedDraftSchemaStream);
  const candidateSchemaActivations = upsertVersionedSchemaActivation(
    doc.schemaRefs ?? [],
    schemaId,
    latestPublishedDraftVersion.version,
  );
  return collectSchemaSwitchValidation({
    currentDoc: doc,
    candidateDoc: {
      ...doc,
      schemaRefs: candidateSchemaActivations,
    },
    currentSchema: schema,
    candidateSchema: resolveActivatedSchema(schemaVersionCatalog, candidateSchemaActivations),
  });
};

export const buildSchemaAuthoringState = (
  params: SchemaAuthoringParams,
): SchemaAuthoringDerivedState => {
  const {
    debouncedSchemaDraftRaw,
    doc,
    draftSchemaPending,
    isForkingSchemaByName,
    latestCatalogVersionBySchemaRef,
    loadedDraftPublishedVersion,
    loadedDraftSchemaStream,
    nextDraftAssessmentSchemaId,
    nextDraftAssessmentVersion,
    publishMode,
    resolveActivatedSchema,
    schema,
    schemaDraftBaseRaw,
    schemaDraftEditorText,
    schemaDraftRaw,
    schemaVersionCatalog,
  } = params;
  const schemaEditorAssessment = assessSchemaEditorInput({
    raw: debouncedSchemaDraftRaw,
    versionCatalog: schemaVersionCatalog,
    nextSchemaId: nextDraftAssessmentSchemaId,
    nextVersion: nextDraftAssessmentVersion,
    previousPublished:
      publishMode === 'update' && loadedDraftSchemaStream && loadedDraftPublishedVersion
        ? {
            schemaId: getUserSchemaRef(loadedDraftSchemaStream),
            version: loadedDraftPublishedVersion.version,
            raw: loadedDraftPublishedVersion.raw,
          }
        : undefined,
  });
  const schemaDraftValidation = schemaEditorAssessment.schema;
  const schemaPublishAssessment = schemaEditorAssessment.publish;
  const canPublish = !draftSchemaPending && schemaEditorAssessment.canPublish;
  const canInsertCookbook = parseAndValidateSchemaModule(schemaDraftRaw).ok;
  const schemaDependencies = buildSchemaDependencyReferences({
    draftText: schemaDraftEditorText,
    previousRaw: schemaDraftBaseRaw,
    fallbackVersionsBySchemaId: latestCatalogVersionBySchemaRef,
    versionCatalog: schemaVersionCatalog,
  });
  const draftDiagramImpact = buildDraftDiagramImpact({
    debouncedSchemaDraftRaw,
    doc,
    isForkingSchemaByName,
    nextDraftAssessmentSchemaId,
    nextDraftAssessmentVersion,
    resolveActivatedSchema,
    schema,
    schemaVersionCatalog,
    schemaDraftValidation,
  });
  const publishedDiagramImpact = buildPublishedDiagramImpact({
    doc,
    loadedDraftSchemaStream,
    latestPublishedDraftVersion: loadedDraftPublishedVersion,
    resolveActivatedSchema,
    schema,
    schemaVersionCatalog,
  });
  const currentPublishedSchemaRef =
    loadedDraftSchemaStream && loadedDraftPublishedVersion
      ? `${getUserSchemaRef(loadedDraftSchemaStream)}@${loadedDraftPublishedVersion.version}`
      : undefined;
  const publishedDiagramHasIntroducedErrors =
    publishedDiagramImpact?.introducedDiagnostics.some(
      (diagnostic) => diagnostic.severity === 'error',
    ) ?? false;

  return {
    schemaDraftValidation,
    schemaPublishAssessment,
    suggestedPublishedVersion: schemaEditorAssessment.suggestedPublishedVersion,
    publishAssessmentSnapshot: schemaEditorAssessment.publishSnapshot,
    canPublish,
    canInsertCookbook,
    schemaDependencies,
    cookbookDisabledReason: canInsertCookbook
      ? undefined
      : 'Fix the schema structure to insert examples safely.',
    ...buildSchemaCard({
      draftSchemaPending,
      schemaEditorAssessment,
    }),
    ...buildDiagramState({
      draftSchemaPending,
      schemaDraftValidation,
      draftDiagramImpact,
    }),
    schemaCookbookRecipes,
    publishedDiagramImpact,
    publishedDiagramActionDisabled:
      !publishedDiagramImpact ||
      publishedDiagramHasIntroducedErrors ||
      (currentPublishedSchemaRef !== undefined &&
        doc.schemaRefs.some((activation) => activation.schema === currentPublishedSchemaRef)),
    publishedDiagramActionDisabledReason: publishedDiagramHasIntroducedErrors
      ? buildDiagramImpactNoticeLines(
          publishedDiagramImpact?.introducedDiagnostics ?? [],
          'This published schema cannot be applied to the current diagram.',
        ).join(' ')
      : undefined,
  };
};

export { mergeSchemaCookbookRecipeIntoDraft } from './schema-cookbook';
