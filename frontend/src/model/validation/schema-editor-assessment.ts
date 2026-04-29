import { type Diagnostic, diagnosticsToMessages } from '../diagnostics';
import { getNextTwoPartVersion } from '../personal-schema-registry';
import { getSchemaModuleRef, parseSchemaRef } from '../schema-ref';
import type { RawSchemaSet } from '../schema-runtime';
import type { SchemaModule, SemanticDocument } from '../types';
import { parseAndValidateSchemaModule } from './schema';
import { assessSchemaValidation, type SchemaValidationAssessment } from './schema-assessment';
import type { SchemaVersionCatalog } from './schema-closure';
import {
  assessSchemaPublishability,
  type SchemaPublishAssessment,
  type SchemaPublishAssessmentSnapshot,
} from './schema-publish';
import { summarizeSchemaModule } from './schema-summary';

export interface SchemaPublishedVersionInput {
  schemaId: string;
  version: string;
  raw: string;
}

export type SchemaEditorAssessmentKind =
  | 'invalid_schema'
  | 'publish_blocked'
  | 'no_effective_change'
  | 'ready';

export interface SchemaEditorAssessmentStatus {
  kind: SchemaEditorAssessmentKind;
  title: string;
  message: string;
}

export interface SchemaEditorAssessment {
  schema: SchemaValidationAssessment;
  publishMode: 'initial' | 'update';
  publish?: SchemaPublishAssessment;
  publishSnapshot?: SchemaPublishAssessmentSnapshot;
  summaryLines: string[];
  suggestedPublishedVersion?: string;
  canPublish: boolean;
  status: SchemaEditorAssessmentStatus;
}

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

const firstErrorMessage = (diagnostics: Diagnostic[], fallback: string) =>
  diagnosticsToMessages(diagnostics.filter((diagnostic) => diagnostic.severity === 'error'))[0] ??
  fallback;

const toPublishSnapshot = (
  assessment: SchemaPublishAssessment | undefined,
): SchemaPublishAssessmentSnapshot | undefined =>
  assessment?.ok
    ? {
        summaryLines: assessment.briefSummary,
      }
    : undefined;

export function assessSchemaEditorInput(params: {
  raw: string;
  versionCatalog?: SchemaVersionCatalog;
  baseRawSchemaSet?: RawSchemaSet;
  nextSchemaId?: string;
  nextVersion?: string;
  previousPublished?: SchemaPublishedVersionInput;
  diagram?: SemanticDocument;
  now?: string;
}): SchemaEditorAssessment {
  const {
    raw,
    versionCatalog,
    baseRawSchemaSet,
    nextSchemaId,
    nextVersion,
    previousPublished,
    diagram,
    now,
  } = params;
  const publishMode = previousPublished ? 'update' : 'initial';
  const schema = assessSchemaValidation({
    raw,
    versionCatalog,
    baseRawSchemaSet,
    draftSchemaId: nextSchemaId,
    draftVersion: nextVersion,
    diagram,
  });

  let publish: SchemaPublishAssessment | undefined;
  if (schema.draftModule && versionCatalog) {
    const nextSchemaRoot = {
      schemaId: nextSchemaId ?? getSchemaModuleRef(schema.draftModule),
      version: nextVersion ?? schema.draftModule.version,
      raw,
      module: withSchemaModuleIdentity(
        schema.draftModule,
        nextSchemaId ?? getSchemaModuleRef(schema.draftModule),
        nextVersion ?? schema.draftModule.version,
      ),
    };
    const previousParsed = previousPublished
      ? parseAndValidateSchemaModule(previousPublished.raw)
      : undefined;

    if (previousPublished && (!previousParsed?.ok || !previousParsed.value)) {
      publish = {
        ok: false,
        mode: 'update',
        assessedAt: now ?? new Date().toISOString(),
        previousVersion: previousPublished.version,
        previousDependencyRefs: [],
        nextDependencyRefs: [],
        backwardCompatible: false,
        recommendedBump: 'none',
        hasEffectiveChanges: false,
        breakingChangeCount: 0,
        nonBreakingChangeCount: 0,
        changes: [],
        briefSummary: ['Publish blocked'],
        diagnostics: previousParsed?.diagnostics ?? [],
        breakingChanges: [],
        nonBreakingChanges: [],
      };
    } else {
      publish = assessSchemaPublishability({
        catalog: versionCatalog,
        previous:
          previousPublished && previousParsed?.value
            ? {
                schemaId: previousPublished.schemaId,
                version: previousPublished.version,
                raw: previousPublished.raw,
                module: withSchemaModuleIdentity(
                  previousParsed.value,
                  previousPublished.schemaId,
                  previousPublished.version,
                ),
              }
            : undefined,
        next: nextSchemaRoot,
        now,
      });
    }
  }

  const suggestedPublishedVersion =
    publishMode === 'initial'
      ? schema.ok
        ? '1.0'
        : undefined
      : previousPublished && publish?.ok
        ? (getNextTwoPartVersion(previousPublished.version, publish.recommendedBump) ?? '1.0')
        : undefined;

  const canPublish =
    schema.ok &&
    publish?.ok === true &&
    (publishMode === 'initial' || publish.hasEffectiveChanges === true);
  const summaryLines =
    schema.ok && schema.draftModule
      ? publishMode === 'initial'
        ? summarizeSchemaModule(schema.draftModule).summaryLines
        : (publish?.briefSummary ?? ['Schema is valid'])
      : [];

  const status: SchemaEditorAssessmentStatus = !schema.ok
    ? {
        kind: 'invalid_schema',
        title: 'Draft needs attention',
        message: firstErrorMessage(
          schema.diagnostics,
          'The schema draft must validate before it can be published.',
        ),
      }
    : !publish?.ok
      ? {
          kind: 'publish_blocked',
          title: 'Publish blocked',
          message: firstErrorMessage(
            publish?.diagnostics ?? [],
            'Publish is blocked until dependency assessment succeeds.',
          ),
        }
      : publishMode === 'update' && !publish.hasEffectiveChanges
        ? {
            kind: 'no_effective_change',
            title: 'No effective change',
            message: `This draft resolves to the same effective schema as v${previousPublished?.version ?? 'current'}.`,
          }
        : {
            kind: 'ready',
            title: `Ready to publish${suggestedPublishedVersion ? ` v${suggestedPublishedVersion}` : ''}`,
            message:
              publish.backwardCompatible === false
                ? `Publishing will create v${suggestedPublishedVersion ?? '…'} and may not work with older diagrams.`
                : `Publishing will create ${suggestedPublishedVersion ? `v${suggestedPublishedVersion}` : 'a new version'}.`,
          };

  return {
    schema,
    publishMode,
    publish,
    publishSnapshot: toPublishSnapshot(publish),
    summaryLines,
    suggestedPublishedVersion,
    canPublish,
    status,
  };
}
