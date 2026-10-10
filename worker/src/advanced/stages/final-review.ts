import { AiDiagramServiceError } from '../../ai-diagram-service';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError, retainPartialDocument } from '../../codex/turn-policy';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import {
  type Diagnostic,
  diagramDiagnostic,
  type SemanticDocument,
  serializeDocument,
  sortDiagnostics,
} from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import { buildFinalGraphReviewSummary } from '../final-review';
import { dedupeSchemaActivations } from '../schema-set';
import type { runGraphCollation } from './graph-collation';
import { buildModelOutputDiagnostic, validateSemanticDocument } from './shared';

export async function runFinalReview(context: Awaited<ReturnType<typeof runGraphCollation>>) {
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
    finalReviewThreadManager,
    finalReviewRepairThreadManager,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    writeSchemaSetArtifacts,
    prepareSchemaValidationCommand,
    backbone,
    nodeRefinementState,
    assembledDoc,
    finalGraphReviewer,
    finalGraphReviewerRepairer,
    finalFlowDiagnostics,
    stabilizeFinalGraphResult,
    writeFinalReviewHandoff,
    resumedFinalReview,
    pendingFinalReview,
    graph,
  } = context;
  let graphResolvedSchemaIds: string[] = [];
  let finalReviewResult: {
    rawYaml: string;
    doc: SemanticDocument;
    rawResponse: string;
    threadId: string | null;
  } = resumedFinalReview ?? pendingFinalReview?.result ?? graph.graphResult;
  let pendingFinalReviewModelOutputDiagnostics: Diagnostic[] =
    pendingFinalReview?.diagnostics ?? [];
  let finalReviewAttemptCount = pendingFinalReview?.repairCount ?? 0;
  let finalDiagnostics: Diagnostic[] = [];
  let finalDocument: SemanticDocument | undefined;

  // A reviewed checkpoint from an earlier policy still gets the final repair opportunity.
  if (
    graph.currentGraphReviewCompleted &&
    finalFlowDiagnostics(finalReviewResult.doc).some((d) => d.severity === 'error')
  ) {
    graph.graphResult = finalReviewResult;
    graph.currentGraphReviewCompleted = false;
  }
  if (!graph.currentGraphReviewCompleted) {
    await beginStage('final-review');
    if (!resumedFinalReview) {
      await writeWorkspaceArtifact(
        options.workspace,
        'analysis/final-graph.pre-review.yaml',
        graph.graphResult.rawYaml,
      );
    }
    const finalReviewSummary = buildFinalGraphReviewSummary({
      assembledDoc,
      candidateDoc: graph.graphResult.doc,
    });
    await writeWorkspaceJsonArtifact(
      options.workspace,
      'analysis/final-review.summary.json',
      finalReviewSummary,
    );

    await emitProgress({
      activeStage: 'advanced/final-review',
      threadId: graph.graphResult.threadId,
      repaired: run.repaired,
    });

    if (!pendingFinalReview)
      try {
        const reviewResult = await runTimedStep(
          {
            logger: options.logger,
            label: 'advanced final-review turn',
            timings,
            detail: (result) =>
              `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
          },
          async () => {
            const handoffArtifactPath = await writeFinalReviewHandoff(
              'A collated candidate final graph exists. Review it as a whole diagram and return the final graph that bundle compile should accept.',
              graph.pendingGraphModelOutputDiagnostics,
            );
            run.graphTurnCount += 1;
            const result = await finalGraphReviewer.reviewFinalGraph({
              semantics: schemaSetManager.snapshot().runtime.semantics,
              workspace: options.workspace,
              repo: options.repo,
              ref: options.ref,
              repoCensus: census,
              graphifyHints,
              areaPlan,
              nodeRefinementState,
              assembledDoc,
              level0Backbone: backbone.level0BuildState,
              activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
              schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
              schemaValidationCommand: await prepareSchemaValidationCommand(),
              promptPackage,
              primaryDocumentInput: options.primaryDocumentInput,
              logger: options.logger,
              promptRunner: finalReviewThreadManager,
              handoffArtifactPath,
              currentFinalGraphYaml: graph.graphResult.rawYaml,
              finalReviewSummary,
            });
            graph.currentGraphResponseArtifactPath = await writeWorkspaceArtifact(
              options.workspace,
              'analysis/final-review.response.yaml',
              result.rawResponse,
            );
            run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
            return result;
          },
        );
        if (graph.pendingGraphModelOutputDiagnostics.length > 0) {
          run.repaired = true;
        }
        finalReviewResult = stabilizeFinalGraphResult(
          reviewResult,
          'Final review',
          graph.graphResult.doc,
        );
        graph.pendingGraphModelOutputDiagnostics = [];
      } catch (error) {
        if (findTurnBudgetError(error)) throw error;
        if (!isModelOutputParseError(error)) {
          throw error;
        }
        finalReviewResult = {
          ...graph.graphResult,
          rawResponse: error.rawResponse,
          threadId: error.threadId,
        };
        pendingFinalReviewModelOutputDiagnostics = [
          buildModelOutputDiagnostic({
            code: 'diagram.document.invalid_final_review_output',
            message: `Final-review output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
          }),
        ];
        run.graphTurnCount += 1;
        run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
        graph.currentGraphResponseArtifactPath = await writeWorkspaceArtifact(
          options.workspace,
          'analysis/final-review.response.yaml',
          error.rawResponse,
        );
        options.logger.warn(pendingFinalReviewModelOutputDiagnostics[0].message);
      }

    await runRepairableStage({
      maxRepairs: 1,
      repairCount: () => finalReviewAttemptCount,
      acceptAdvisoriesAtLimit: false,
      evaluate: async () => {
        await resume.pendingCandidates.save('final-review', {
          rawYaml: finalReviewResult.rawYaml,
          rawResponse: finalReviewResult.rawResponse,
          repairCount: finalReviewAttemptCount,
          diagnostics: pendingFinalReviewModelOutputDiagnostics,
        });
        const proposedReviewDocument = {
          ...finalReviewResult.doc,
          schemaRefs: dedupeSchemaActivations([
            ...schemaSetManager.snapshot().activeSchemaRefs,
            ...finalReviewResult.doc.schemaRefs,
          ]),
        };
        const reviewValidation = validateSemanticDocument({
          rawYaml: serializeDocument(proposedReviewDocument),
          schemaRegistry,
          primaryDocumentInput: options.primaryDocumentInput,
        });
        const reviewSchemaSetDecision = reviewValidation.document
          ? schemaSetManager.acceptSchemaRefs(
              reviewValidation.document.schemaRefs.map((activation) => activation.schema),
            )
          : {
              changed: false,
              acceptedSchemaRefs: [],
              rejectedSchemaRefs: [],
            };
        const reviewSchemaSetSnapshot = schemaSetManager.snapshot();
        const normalizedReviewedDocument = reviewValidation.document
          ? {
              ...reviewValidation.document,
              schemaRefs: [...reviewSchemaSetSnapshot.activeSchemaRefs],
            }
          : undefined;
        const compiledValidation =
          normalizedReviewedDocument !== undefined
            ? validateSemanticDocument({
                rawYaml: serializeDocument(normalizedReviewedDocument),
                schemaRegistry,
                primaryDocumentInput: options.primaryDocumentInput,
              })
            : reviewValidation;
        const reviewSchemaSetDiagnostics: Diagnostic[] =
          reviewSchemaSetDecision.rejectedSchemaRefs.map((schemaRef) =>
            diagramDiagnostic({
              phase: 'document',
              severity: 'error',
              code: 'diagram.document.schema_ref_not_accepted',
              message: `Schema ref ${schemaRef} is not accepted by the active schema-set rules`,
            }),
          );
        finalDiagnostics = sortDiagnostics([
          ...graph.pendingGraphModelOutputDiagnostics,
          ...pendingFinalReviewModelOutputDiagnostics,
          ...reviewSchemaSetDiagnostics,
          ...compiledValidation.diagnostics,
          ...(compiledValidation.document ? finalFlowDiagnostics(compiledValidation.document) : []),
        ]);
        const hasFinalReviewErrors = finalDiagnostics.some(
          (diagnostic) => diagnostic.severity === 'error',
        );
        graphResolvedSchemaIds = compiledValidation.resolvedSchemaIds;

        return {
          valid: Boolean(
            compiledValidation.ok &&
              compiledValidation.document &&
              reviewSchemaSetDecision.rejectedSchemaRefs.length === 0 &&
              !hasFinalReviewErrors,
          ),

          accept: async () => {
            finalDocument = compiledValidation.document!;
            retainPartialDocument(finalDocument);
            finalReviewResult = {
              ...finalReviewResult,
              doc: finalDocument,
              rawYaml: serializeDocument(finalDocument).trim(),
            };
            const artifactPath = await writeWorkspaceArtifact(
              options.workspace,
              'analysis/final-graph.yaml',
              finalReviewResult.rawYaml,
            );
            await writeSchemaSetArtifacts();
            await emitProgress({
              advanced: {
                lastCompletedStage: 'final-review',
                currentGraphArtifact: artifactPath,
                currentGraphResponseArtifact: graph.currentGraphResponseArtifactPath,
                currentGraphReviewCompleted: true,
              },
              threadId: finalReviewResult.threadId,
              resolvedSchemaIds: graphResolvedSchemaIds,
            });
            graph.currentGraphReviewCompleted = true;
          },
          exhausted: () => {
            throw new AiDiagramServiceError(
              'Advanced final-review did not validate after 1 review repair pass',
              finalDiagnostics,
              options.workspace,
              finalReviewResult.threadId,
              true,
            );
          },
          repair: async () => {
            try {
              await emitProgress({
                activeStage: 'advanced/final-review-repair-1',
                threadId: finalReviewResult.threadId,
                repaired: true,
              });
              const repairResult = await runTimedStep(
                {
                  logger: options.logger,
                  label: 'advanced final-review repair turn 1/1',
                  timings,
                  detail: (result) =>
                    `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
                },
                async () => {
                  const handoffArtifactPath = await writeFinalReviewHandoff(
                    'A reviewed final graph exists but still has deterministic validation issues. Repair the reviewed graph from the reviewed YAML and current diagnostics.',
                    finalDiagnostics,
                    { includeCandidateFinalGraph: false },
                  );
                  run.graphTurnCount += 1;
                  const result = await finalGraphReviewerRepairer.repairFinalGraphReview({
                    semantics: schemaSetManager.snapshot().runtime.semantics,
                    workspace: options.workspace,
                    repo: options.repo,
                    ref: options.ref,
                    repoCensus: census,
                    graphifyHints,
                    areaPlan,
                    nodeRefinementState,
                    assembledDoc,
                    level0Backbone: backbone.level0BuildState,
                    activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                    schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
                    schemaValidationCommand: await prepareSchemaValidationCommand(),
                    promptPackage,
                    primaryDocumentInput: options.primaryDocumentInput,
                    logger: options.logger,
                    promptRunner: finalReviewRepairThreadManager,
                    handoffArtifactPath,
                    finalReviewSummary,
                    previousReviewYaml: finalReviewResult.rawYaml,
                    diagnostics: finalDiagnostics,
                    attempt: 1,
                  });
                  graph.currentGraphResponseArtifactPath = await writeWorkspaceArtifact(
                    options.workspace,
                    'analysis/final-review.repair-1.response.yaml',
                    result.rawResponse,
                  );
                  run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
                  return result;
                },
              );
              finalReviewResult = stabilizeFinalGraphResult(
                repairResult,
                'Final-review repair',
                finalReviewResult.doc,
              );
              graph.pendingGraphModelOutputDiagnostics = [];
              pendingFinalReviewModelOutputDiagnostics = [];
              finalReviewAttemptCount = 1;
              run.repaired = true;
            } catch (error) {
              if (findTurnBudgetError(error)) throw error;
              if (!isModelOutputParseError(error)) {
                throw error;
              }
              pendingFinalReviewModelOutputDiagnostics = [
                buildModelOutputDiagnostic({
                  code: 'diagram.document.invalid_final_review_output',
                  message: `Final-review repair output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
                }),
              ];
              run.graphTurnCount += 1;
              run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
              graph.currentGraphResponseArtifactPath = await writeWorkspaceArtifact(
                options.workspace,
                'analysis/final-review.repair-1.response.yaml',
                error.rawResponse,
              );
              finalReviewResult = {
                ...finalReviewResult,
                rawResponse: error.rawResponse,
                threadId: error.threadId,
              };
              finalReviewAttemptCount = 1;
              run.repaired = true;
              options.logger.warn(pendingFinalReviewModelOutputDiagnostics[0].message);
            }
          },
        };
      },
    });
  }

  return { ...context, graphResolvedSchemaIds, finalReviewResult, finalDiagnostics, finalDocument };
}
