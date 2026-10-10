import { AiDiagramServiceError } from '../../ai-diagram-service';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError } from '../../codex/turn-policy';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import {
  type Diagnostic,
  diagramDiagnostic,
  serializeDocument,
  sortDiagnostics,
} from '../../semantic';
import { addTokenUsageTotals, emptyTokenUsageTotals } from '../../token-usage';
import { decodePendingWave1 } from '../pending-candidates';
import { dedupeSchemaActivations } from '../schema-set';
import {
  applyWave1ReviewPatch,
  buildWave1ReviewPromptArtifacts,
  validateWave1ReviewPatchContract,
} from '../wave1-review';
import type { runLevel0Review } from './level0-review';
import type { prepareNodeRefinementCallbacks } from './node-refinement-callbacks';
import {
  buildModelOutputDiagnostic,
  formatReviewRepairPassCount,
  MAX_WAVE1_REVIEW_REPAIR_ATTEMPTS,
} from './shared';

export async function runWave1Review(
  context: Awaited<ReturnType<typeof runLevel0Review>> &
    Awaited<ReturnType<typeof prepareNodeRefinementCallbacks>>,
  workingState: import('../types').NodeRefinementState,
) {
  const {
    options,
    timings,
    resume,
    run,
    emitProgress,
    census,
    graphifyHints,
    promptPackage,
    wave1ReviewThreadManager,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    prepareSchemaValidationCommand,
    wave1Reviewer,
    wave1ReviewerRepairer,
    backbone,
    writeWave1ReviewHandoff,
    getSchemaContext,
    validateRefinedState,
    persistNodeRefinementState,
    acceptSuggestedSchemaRefs,
  } = context;
  await emitProgress({ activeStage: 'advanced/wave1-review' });
  await writeWorkspaceJsonArtifact(
    options.workspace,
    'analysis/node-refinement-state.pre-wave1.json',
    workingState,
  );
  const { wave1Document, wave1Summary } = buildWave1ReviewPromptArtifacts({
    semantics: schemaSetManager.snapshot().runtime.semantics,
    level0Doc: {
      ...backbone.level0BuildState.level0Doc,
      schemaRefs: dedupeSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
    },
    state: workingState,
  });
  await writeWorkspaceArtifact(
    options.workspace,
    'analysis/wave1-document.yaml',
    serializeDocument(wave1Document),
  );
  await writeWorkspaceJsonArtifact(options.workspace, 'analysis/wave1-summary.json', wave1Summary);
  const wave1HandoffArtifactPath = await writeWave1ReviewHandoff(
    workingState,
    'All root refinements are complete and no depth-1 task has run yet. Review the first-level decomposition and return a bounded patch that improves wave-1 coherence before deeper refinement continues.',
  );

  const preReviewSchemaRefs = schemaSetManager.snapshot().rootSchemaRefs;
  const preReviewLevel0BuildState = backbone.level0BuildState;
  const preReviewDiagnostics = validateRefinedState({
    state: workingState,
    assembledDoc: wave1Document,
    schemaContext: getSchemaContext(),
  });
  const canFallbackWave1 = !preReviewDiagnostics.some(
    (item) => item.severity === 'error' && !item.code.startsWith('diagram.flow.'),
  );
  let pendingWave1ModelOutputDiagnostics: Diagnostic[] = [];
  let wave1ReviewPatch = {} as import('../types').Wave1ReviewPatch;
  let wave1ReviewThreadId: string | null = null;
  let wave1ReviewAttemptCount = 0;
  let usePreReviewFallback = false;
  let wave1ReviewTurnsUsed = 0;
  let wave1ReviewTokenUsage = emptyTokenUsageTotals();

  const pendingWave1 = await resume.pendingCandidates.load(
    'node-refinement',
    decodePendingWave1,
    'wave1',
  );
  if (pendingWave1) {
    wave1ReviewPatch = pendingWave1.patch;
    pendingWave1ModelOutputDiagnostics = pendingWave1.diagnostics;
    wave1ReviewAttemptCount = pendingWave1.repairCount;
    wave1ReviewTurnsUsed = pendingWave1.turnsUsed;
    wave1ReviewTokenUsage = pendingWave1.tokenUsage;
  } else {
    try {
      const reviewResult = await runTimedStep(
        {
          logger: options.logger,
          label: 'advanced wave-1 review turn',
          timings,
          detail: (result) => `thread ${result.threadId ?? 'none'}`,
        },
        async () => {
          const result = await wave1Reviewer.reviewWave1({
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
            promptRunner: wave1ReviewThreadManager,
            handoffArtifactPath: wave1HandoffArtifactPath,
            level0BackboneYaml: serializeDocument(backbone.level0BuildState.level0Doc),
            flowBuildState: backbone.level0BuildState,
            wave1DocumentYaml: serializeDocument(wave1Document),
            wave1Summary,
          });
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/wave1-review.response.json',
            result.rawResponse,
          );
          run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
          return result;
        },
      );
      wave1ReviewPatch = reviewResult.patch;
      wave1ReviewThreadId = reviewResult.threadId;
      wave1ReviewTurnsUsed += 1;
      wave1ReviewTokenUsage = addTokenUsageTotals(wave1ReviewTokenUsage, reviewResult.tokenUsage);
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (!isModelOutputParseError(error)) {
        throw error;
      }
      pendingWave1ModelOutputDiagnostics = [
        buildModelOutputDiagnostic({
          code: 'diagram.document.invalid_wave1_review_output',
          message: `Wave-1 review output was not valid JSON: ${error.message}. Return only a structured JSON patch.`,
        }),
      ];
      wave1ReviewThreadId = error.threadId;
      wave1ReviewTurnsUsed += 1;
      wave1ReviewTokenUsage = addTokenUsageTotals(wave1ReviewTokenUsage, error.tokenUsage);
      run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
      await writeWorkspaceArtifact(
        options.workspace,
        'analysis/wave1-review.response.json',
        error.rawResponse,
      );
      options.logger.warn(pendingWave1ModelOutputDiagnostics[0].message);
    }
  }
  await runRepairableStage({
    maxRepairs: MAX_WAVE1_REVIEW_REPAIR_ATTEMPTS,
    repairCount: () => wave1ReviewAttemptCount,
    evaluate: async () => {
      await resume.pendingCandidates.save(
        'node-refinement',
        {
          patch: wave1ReviewPatch,
          diagnostics: pendingWave1ModelOutputDiagnostics,
          repairCount: wave1ReviewAttemptCount,
          turnsUsed: wave1ReviewTurnsUsed,
          tokenUsage: wave1ReviewTokenUsage,
        },
        'wave1',
      );
      // Every patch is evaluated against the same accepted schema baseline.
      schemaSetManager.restoreRootSchemaRefs(preReviewSchemaRefs);
      backbone.level0BuildState = preReviewLevel0BuildState;
      if (
        canFallbackWave1 &&
        (pendingWave1ModelOutputDiagnostics.length > 0 || usePreReviewFallback)
      ) {
        return {
          valid: false,
          fallbackRequired: true,
          accept: async () => {
            const diagnostic = diagramDiagnostic({
              phase: 'document',
              severity: 'warning',
              code: 'diagram.wave1.review_fallback',
              message: 'Kept the valid pre-review wave-1 state after its review failed.',
            });
            options.logger.warn(diagnostic.message);
            workingState = {
              ...workingState,
              reviewedDepths: [...new Set([...workingState.reviewedDepths, 1])],
              budgets: {
                ...workingState.budgets,
                turnsUsed: workingState.budgets.turnsUsed + wave1ReviewTurnsUsed,
                tokenUsage: addTokenUsageTotals(
                  workingState.budgets.tokenUsage,
                  wave1ReviewTokenUsage,
                ),
              },
            };
            await writeWorkspaceArtifact(
              options.workspace,
              'analysis/level0-wave1.yaml',
              serializeDocument(backbone.level0BuildState.level0Doc),
            );
            await persistNodeRefinementState(
              workingState,
              'Wave-1 review fell back to the valid pre-review state.',
              [diagnostic],
            );
          },
        };
      }

      const suggestedSchemaRefs = [
        ...(wave1ReviewPatch.suggestedSchemaRefs ?? []),
        ...(wave1ReviewPatch.rootEdits ?? []).flatMap(
          (edit) => edit.refinement?.suggestedSchemaRefs ?? [],
        ),
      ];
      const schemaDecision = acceptSuggestedSchemaRefs(suggestedSchemaRefs);
      const schemaSetDiagnostics: Diagnostic[] = schemaDecision.rejectedSchemaRefs.map(
        (schemaRef) =>
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.document.schema_ref_not_accepted',
            message: `Schema ref ${schemaRef} is not accepted by the active schema-set rules`,
          }),
      );
      const applied = applyWave1ReviewPatch({
        semantics: schemaSetManager.snapshot().runtime.semantics,
        level0Doc: {
          ...backbone.level0BuildState.level0Doc,
          schemaRefs: dedupeSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
        },
        areaPlan,
        visibleResponsibilityIds: backbone.level0BuildState.visibleResponsibilityIds,
        previousState: workingState,
        patch: wave1ReviewPatch,
      });
      const reviewedLevel0Doc = {
        ...applied.reviewedLevel0Doc,
        schemaRefs: dedupeSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
      };
      const reviewedWave1Document = {
        ...applied.wave1Document,
        schemaRefs: dedupeSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
      };
      const reviewSchemaContext = getSchemaContext();
      const reviewDiagnostics = sortDiagnostics([
        ...pendingWave1ModelOutputDiagnostics,
        ...schemaSetDiagnostics,
        ...validateWave1ReviewPatchContract({
          patch: wave1ReviewPatch,
          previousState: workingState,
          rebuiltState: applied.rebuiltState,
          schemaContext: reviewSchemaContext,
        }),
        ...validateRefinedState({
          state: applied.rebuiltState,
          assembledDoc: reviewedWave1Document,
          schemaContext: reviewSchemaContext,
        }),
      ]);
      const fatalReviewDiagnostics = reviewDiagnostics.filter(
        (diagnostic) =>
          diagnostic.severity === 'error' && !diagnostic.code.startsWith('diagram.flow.'),
      );

      return {
        valid: fatalReviewDiagnostics.length === 0,
        fallbackAvailable: canFallbackWave1,
        restoreFallback: () => {
          usePreReviewFallback = true;
        },
        accept: async () => {
          const rebuiltState: import('../types').NodeRefinementState = {
            ...applied.rebuiltState,
            budgets: {
              ...applied.rebuiltState.budgets,
              turnsUsed: workingState.budgets.turnsUsed + wave1ReviewTurnsUsed,
              tokenUsage: addTokenUsageTotals(
                workingState.budgets.tokenUsage,
                wave1ReviewTokenUsage,
              ),
            },
          };
          workingState = rebuiltState;
          backbone.level0BuildState = {
            ...backbone.level0BuildState,
            level0Doc: reviewedLevel0Doc,
            visibleResponsibilityIds: backbone.level0BuildState.visibleResponsibilityIds.filter(
              (rootId) => workingState.rootNodeIds.includes(rootId),
            ),
          };
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-wave1.yaml',
            serializeDocument(reviewedLevel0Doc),
          );
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-backbone.yaml',
            serializeDocument(reviewedLevel0Doc),
          );
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/wave1-document.yaml',
            serializeDocument(reviewedWave1Document),
          );
          await writeWorkspaceJsonArtifact(
            options.workspace,
            'analysis/wave1-summary.json',
            buildWave1ReviewPromptArtifacts({
              semantics: schemaSetManager.snapshot().runtime.semantics,
              level0Doc: reviewedLevel0Doc,
              state: workingState,
            }).wave1Summary,
          );
          await persistNodeRefinementState(
            workingState,
            'Wave-1 review completed. Continue node refinement from the reviewed first-level state.',
          );
          await emitProgress({
            threadId: wave1ReviewThreadId,
            activeStage: 'advanced/node-refinement',
            diagnostics: reviewDiagnostics.filter((diagnostic) =>
              diagnostic.code.startsWith('diagram.flow.'),
            ),
          });
        },
        exhausted: () => {
          throw new AiDiagramServiceError(
            `Advanced wave-1 review did not validate after ${formatReviewRepairPassCount(MAX_WAVE1_REVIEW_REPAIR_ATTEMPTS)}`,
            reviewDiagnostics,
            options.workspace,
            wave1ReviewThreadId,
            true,
          );
        },
        repair: async () => {
          try {
            const repairResult = await runTimedStep(
              {
                logger: options.logger,
                label: `advanced wave-1 review repair turn ${wave1ReviewAttemptCount + 1}/${MAX_WAVE1_REVIEW_REPAIR_ATTEMPTS}`,
                timings,
                detail: (result) => `thread ${result.threadId ?? 'none'}`,
              },
              async () => {
                const result = await wave1ReviewerRepairer.repairWave1Review({
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
                  promptRunner: wave1ReviewThreadManager,
                  handoffArtifactPath: wave1HandoffArtifactPath,
                  level0BackboneYaml: serializeDocument(backbone.level0BuildState.level0Doc),
                  flowBuildState: backbone.level0BuildState,
                  wave1DocumentYaml: serializeDocument(wave1Document),
                  wave1Summary,
                  candidateWave1DocumentYaml: serializeDocument(reviewedWave1Document),
                  previousPatch: wave1ReviewPatch,
                  diagnostics: reviewDiagnostics,
                  attempt: wave1ReviewAttemptCount + 1,
                });
                await writeWorkspaceArtifact(
                  options.workspace,
                  `analysis/wave1-review.repair-${wave1ReviewAttemptCount + 1}.response.json`,
                  result.rawResponse,
                );
                run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
                return result;
              },
            );
            wave1ReviewPatch = repairResult.patch;
            wave1ReviewThreadId = repairResult.threadId;
            pendingWave1ModelOutputDiagnostics = [];
            wave1ReviewAttemptCount += 1;
            wave1ReviewTurnsUsed += 1;
            wave1ReviewTokenUsage = addTokenUsageTotals(
              wave1ReviewTokenUsage,
              repairResult.tokenUsage,
            );
            run.repaired = true;
          } catch (error) {
            if (findTurnBudgetError(error)) throw error;
            if (!isModelOutputParseError(error)) {
              throw error;
            }
            pendingWave1ModelOutputDiagnostics = [
              buildModelOutputDiagnostic({
                code: 'diagram.document.invalid_wave1_review_output',
                message: `Wave-1 review repair output was not valid JSON: ${error.message}. Return only a structured JSON patch.`,
              }),
            ];
            wave1ReviewThreadId = error.threadId;
            wave1ReviewAttemptCount += 1;
            wave1ReviewTurnsUsed += 1;
            wave1ReviewTokenUsage = addTokenUsageTotals(wave1ReviewTokenUsage, error.tokenUsage);
            run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
            await writeWorkspaceArtifact(
              options.workspace,
              `analysis/wave1-review.repair-${wave1ReviewAttemptCount}.response.json`,
              error.rawResponse,
            );
            options.logger.warn(pendingWave1ModelOutputDiagnostics[0].message);
            run.repaired = true;
          }
        },
      };
    },
  });
  return workingState;
}
