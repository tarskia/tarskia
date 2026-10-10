import { AiDiagramServiceError } from '../../ai-diagram-service';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError, retainPartialDocument } from '../../codex/turn-policy';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import {
  type Diagnostic,
  diagramDiagnostic,
  serializeDocument,
  sortDiagnostics,
} from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import { restoreBackboneReviewCheckpoint } from '../checkpoint-resume';
import {
  buildFlowBuildState,
  buildFlowRepairDiagnostics,
  serializeDocumentFlowAnalysisArtifact,
  serializeFlowBuildStateArtifact,
} from '../flow-build-state';
import { decodePendingDocument } from '../pending-candidates';
import { dedupeSchemaActivations } from '../schema-set';
import type { runLevel0Backbone } from './level0-backbone';
import {
  buildModelOutputDiagnostic,
  isFatalBackboneDiagnostic,
  validateSemanticDocument,
} from './shared';

export async function runLevel0Review(context: Awaited<ReturnType<typeof runLevel0Backbone>>) {
  const {
    options,
    timings,
    resume,
    run,
    emitProgress,
    beginStage,
    census,
    graphifyHints,
    schemaRegistry,
    promptPackage,
    backboneReviewThreadManager,
    backboneReviewRepairThreadManager,
    writeBackboneReviewHandoff,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    writeSchemaSetArtifacts,
    prepareSchemaValidationCommand,
    level0BackboneReviewer,
    level0BackboneReviewerRepairer,
    backbone,
  } = context;
  await emitProgress({ activeStage: 'advanced/level0-review' });
  const resumedLevel0Review = await restoreBackboneReviewCheckpoint(context);

  const pendingBackboneReview = resumedLevel0Review
    ? undefined
    : await resume.pendingCandidates.load('level0-review', decodePendingDocument);
  let pendingLevel0ReviewModelOutputDiagnostics: Diagnostic[] =
    pendingBackboneReview?.diagnostics ?? [];
  let level0ReviewDiagnostics: Diagnostic[] = [];
  let level0ReviewAttemptCount = pendingBackboneReview?.repairCount ?? 0;
  let initialReviewResult = resumedLevel0Review ?? pendingBackboneReview?.result;
  if (pendingBackboneReview) await beginStage('level0-review');

  if (!initialReviewResult) {
    await beginStage('level0-review');
    await writeSchemaSetArtifacts();
    try {
      initialReviewResult = await runTimedStep(
        {
          logger: options.logger,
          label: 'advanced level-0 review turn',
          timings,
          detail: (result) =>
            `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
        },
        async () => {
          const handoffArtifactPath = await writeBackboneReviewHandoff({
            summary:
              'A valid raw level-0 backbone exists. Review it from an architectural perspective and return the final reviewed level-0 backbone that node refinement should use.',
            activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
          });
          run.level0TurnCount += 1;
          const result = await level0BackboneReviewer.reviewLevel0Backbone({
            semantics: schemaSetManager.snapshot().runtime.semantics,
            workspace: options.workspace,
            repo: options.repo,
            ref: options.ref,
            repoCensus: census,
            graphifyHints,
            areaPlan,
            activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
            candidateSchemaRefs: schemaSetManager.snapshot().candidateSchemaRefs,
            schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
            schemaValidationCommand: await prepareSchemaValidationCommand(),
            promptPackage,
            logger: options.logger,
            promptRunner: backboneReviewThreadManager,
            handoffArtifactPath,
            currentBackboneYaml: backbone.level0BackboneResult.rawYaml,
            flowBuildState: backbone.level0BuildState,
          });
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-review.response.yaml',
            result.rawResponse,
          );
          run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
          return result;
        },
      );
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (!isModelOutputParseError(error)) {
        throw error;
      }
      initialReviewResult = {
        rawYaml: backbone.level0BackboneResult.rawYaml,
        doc: backbone.level0BackboneResult.doc,
        rawResponse: error.rawResponse,
        threadId: error.threadId,
      };
      pendingLevel0ReviewModelOutputDiagnostics = [
        buildModelOutputDiagnostic({
          code: 'diagram.document.invalid_backbone_review_output',
          message: `Level-0 backbone review output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
        }),
      ];
      run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
      await writeWorkspaceArtifact(
        options.workspace,
        'analysis/level0-review.response.yaml',
        error.rawResponse,
      );
      options.logger.warn(pendingLevel0ReviewModelOutputDiagnostics[0].message);
    }
  }

  let level0ReviewResult = initialReviewResult;

  await runRepairableStage({
    maxRepairs: 1,
    repairCount: () => level0ReviewAttemptCount,
    acceptAdvisoriesAtLimit: true,
    evaluate: async () => {
      await resume.pendingCandidates.save('level0-review', {
        rawYaml: level0ReviewResult.rawYaml,
        rawResponse: level0ReviewResult.rawResponse,
        repairCount: level0ReviewAttemptCount,
        diagnostics: pendingLevel0ReviewModelOutputDiagnostics,
      });
      const proposedReviewDocument = {
        ...level0ReviewResult.doc,
        schemaRefs: dedupeSchemaActivations([
          ...schemaSetManager.snapshot().activeSchemaRefs,
          ...level0ReviewResult.doc.schemaRefs,
        ]),
      };
      const level0ReviewValidation = validateSemanticDocument({
        rawYaml: serializeDocument(proposedReviewDocument),
        schemaRegistry,
        primaryDocumentInput: options.primaryDocumentInput,
      });
      const reviewSchemaSetDecision = level0ReviewValidation.document
        ? schemaSetManager.acceptSchemaRefs(
            level0ReviewValidation.document.schemaRefs.map((activation) => activation.schema),
          )
        : {
            changed: false,
            acceptedSchemaRefs: [],
            rejectedSchemaRefs: [],
          };
      const reviewSchemaSetSnapshot = schemaSetManager.snapshot();
      const normalizedReviewedDocument = level0ReviewValidation.document
        ? {
            ...level0ReviewValidation.document,
            schemaRefs: [...reviewSchemaSetSnapshot.activeSchemaRefs],
          }
        : undefined;
      backbone.level0ResolvedSchemaIds = reviewSchemaSetSnapshot.activeSchemaRefs.map(
        (activation) => activation.schema,
      );
      const analyzedReviewedLevel0 =
        level0ReviewValidation.ok &&
        normalizedReviewedDocument &&
        reviewSchemaSetSnapshot.runtime.resolved.effectiveSchema
          ? buildFlowBuildState({
              level0Doc: normalizedReviewedDocument,
              effectiveSchema: reviewSchemaSetSnapshot.runtime.resolved.effectiveSchema,
              repoOwnedResponsibilityIds: backbone.repoOwnedResponsibilityIds,
              continuationAttempts: backbone.continuationAttempts,
            })
          : undefined;

      if (analyzedReviewedLevel0) {
        backbone.level0BuildState = analyzedReviewedLevel0.state;
        backbone.effectiveLevel0Schema = reviewSchemaSetSnapshot.runtime.resolved.effectiveSchema;
        await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/flow-analysis.json',
          serializeDocumentFlowAnalysisArtifact(analyzedReviewedLevel0.analysis),
        );
        await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/flow-build-state.json',
          serializeFlowBuildStateArtifact(analyzedReviewedLevel0.state),
        );
      }

      const reviewSchemaSetDiagnostics: Diagnostic[] =
        reviewSchemaSetDecision.rejectedSchemaRefs.map((schemaRef) =>
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.document.schema_ref_not_accepted',
            message: `Schema ref ${schemaRef} is not accepted by the active schema-set rules`,
          }),
        );

      const reviewFlowDiagnostics =
        analyzedReviewedLevel0 && backbone.level0BuildState
          ? buildFlowRepairDiagnostics({
              flowBuildState: backbone.level0BuildState,
              analysis: analyzedReviewedLevel0.analysis,
              effectiveSchema: backbone.effectiveLevel0Schema!,
            })
          : [];
      const hasReviewFlowErrors = reviewFlowDiagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      );
      const reviewDiagnostics = sortDiagnostics([
        ...pendingLevel0ReviewModelOutputDiagnostics,
        ...level0ReviewValidation.diagnostics,
        ...reviewSchemaSetDiagnostics,
        ...reviewFlowDiagnostics,
      ]);
      level0ReviewDiagnostics = reviewDiagnostics;
      const fatalReviewDiagnostics = reviewDiagnostics.filter(isFatalBackboneDiagnostic);
      const needsReviewRepair =
        pendingLevel0ReviewModelOutputDiagnostics.length > 0 ||
        !level0ReviewValidation.ok ||
        reviewSchemaSetDecision.rejectedSchemaRefs.length > 0 ||
        hasReviewFlowErrors;
      const canAcceptReviewedWithAdvisoriesOnly =
        level0ReviewAttemptCount >= 1 && fatalReviewDiagnostics.length === 0;

      return {
        valid:
          !needsReviewRepair &&
          Boolean(backbone.level0BuildState && backbone.effectiveLevel0Schema),
        advisoryOnly:
          fatalReviewDiagnostics.length === 0 &&
          Boolean(backbone.level0BuildState && backbone.effectiveLevel0Schema),
        checkpointAccepted: Boolean(
          resumedLevel0Review && backbone.level0BuildState && backbone.effectiveLevel0Schema,
        ),

        accept: async () => {
          backbone.level0BackboneResult = {
            ...level0ReviewResult,
            doc: backbone.level0BuildState.level0Doc,
            rawYaml: serializeDocument(backbone.level0BuildState.level0Doc).trim(),
          };
          backbone.level0Diagnostics = level0ReviewDiagnostics;
          if (canAcceptReviewedWithAdvisoriesOnly) {
            options.logger.warn(
              `Accepting reviewed level-0 backbone with unresolved advisory diagnostics after 1 review repair pass: ${reviewDiagnostics.map((diagnostic) => diagnostic.code).join(', ')}`,
            );
          }
          if (!resumedLevel0Review) {
            await writeWorkspaceArtifact(
              options.workspace,
              'analysis/level0-review.yaml',
              backbone.level0BackboneResult.rawYaml,
            );
          }
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-backbone.yaml',
            backbone.level0BackboneResult.rawYaml,
          );
          if (!resumedLevel0Review) await writeSchemaSetArtifacts();
          await emitProgress({
            advanced: {
              ...(resumedLevel0Review ? {} : { lastCompletedStage: 'level0-review' as const }),
            },
            resolvedSchemaIds: backbone.level0ResolvedSchemaIds,
          });
        },
        exhausted: () => {
          throw new AiDiagramServiceError(
            'Advanced level-0 backbone review did not validate after 1 review repair pass',
            reviewDiagnostics,
            options.workspace,
            level0ReviewResult.threadId,
            true,
          );
        },
        repair: async () => {
          try {
            const repairResult = await runTimedStep(
              {
                logger: options.logger,
                label: 'advanced level-0 review repair turn 1/1',
                timings,
                detail: (result) =>
                  `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
              },
              async () => {
                const handoffArtifactPath = await writeBackboneReviewHandoff({
                  summary:
                    'A reviewed level-0 backbone exists but still has deterministic validation issues. Repair the reviewed backbone from the reviewed YAML and current diagnostics.',
                  activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                  includeAcceptedBackbone: false,
                  diagnostics: reviewDiagnostics,
                });
                run.level0TurnCount += 1;
                const result = await level0BackboneReviewerRepairer.repairLevel0BackboneReview({
                  semantics: schemaSetManager.snapshot().runtime.semantics,
                  workspace: options.workspace,
                  repo: options.repo,
                  ref: options.ref,
                  repoCensus: census,
                  graphifyHints,
                  areaPlan,
                  activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                  candidateSchemaRefs: schemaSetManager.snapshot().candidateSchemaRefs,
                  schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
                  schemaValidationCommand: await prepareSchemaValidationCommand(),
                  promptPackage,
                  logger: options.logger,
                  promptRunner: backboneReviewRepairThreadManager,
                  handoffArtifactPath,
                  previousReviewYaml: level0ReviewResult.rawYaml,
                  diagnostics: reviewDiagnostics,
                  flowBuildState: backbone.level0BuildState,
                  attempt: 1,
                });
                await writeWorkspaceArtifact(
                  options.workspace,
                  'analysis/level0-review.repair-1.response.yaml',
                  result.rawResponse,
                );
                run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
                return result;
              },
            );

            level0ReviewResult = repairResult;
            pendingLevel0ReviewModelOutputDiagnostics = [];
          } catch (error) {
            if (findTurnBudgetError(error)) throw error;
            if (!isModelOutputParseError(error)) {
              throw error;
            }
            pendingLevel0ReviewModelOutputDiagnostics = [
              buildModelOutputDiagnostic({
                code: 'diagram.document.invalid_backbone_review_output',
                message: `Level-0 backbone review repair output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
              }),
            ];
            run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
            await writeWorkspaceArtifact(
              options.workspace,
              'analysis/level0-review.repair-1.response.yaml',
              error.rawResponse,
            );
            level0ReviewResult = {
              ...level0ReviewResult,
              rawResponse: error.rawResponse,
              threadId: error.threadId,
            };
            options.logger.warn(pendingLevel0ReviewModelOutputDiagnostics[0].message);
          }
          level0ReviewAttemptCount += 1;
          run.repaired = true;
        },
      };
    },
  });

  retainPartialDocument(backbone.level0BuildState.level0Doc);

  return { ...context, level0ReviewResult, level0ReviewDiagnostics };
}
