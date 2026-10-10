import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { CodexAreaPlanner } from '../../codex/area-planner';
import { CodexLevel0BackboneBuilder } from '../../codex/level0-backbone-builder';
import { CodexLevel0BackboneReviewer } from '../../codex/level0-backbone-reviewer';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError } from '../../codex/turn-policy';
import { CodexWave1Reviewer } from '../../codex/wave1-reviewer';
import { normalizeGalleryDescriptionText } from '../../gallery-metadata';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import { addTokenUsageTotals } from '../../token-usage';
import { restoreAreaPlanCheckpoint } from '../checkpoint-resume';
import { listPlanConcepts } from '../concept-plan';
import { decodePendingAreaAttempt } from '../pending-candidates';
import { buildSchemaFlowCatalog, type SchemaFlowCatalog } from '../schema-flow-catalog';
import { buildSchemaSetManagerFromAreaPlan, serializeSchemaSetArtifact } from '../schema-set';
import type { prepareStageArtifacts } from './handoffs';
import { MAX_AREA_PLAN_ATTEMPTS } from './shared';

export async function runAreaPlan(context: Awaited<ReturnType<typeof prepareStageArtifacts>>) {
  const {
    options,
    dependencies,
    codexAgentOptions,
    timings,
    resume,
    run,
    emitProgress,
    beginStage,
    savedSchemaSet,
    census,
    graphifyHints,
    schemaRegistry,
    promptPackage,
    advancedThreadManager,
    prepareAreaPlanSchemaValidationCommand,
    writeSchemaSelectionValidationArtifacts,
    writePreRefinementHandoff,
  } = context;
  const planner = dependencies.areaPlanner ?? new CodexAreaPlanner(codexAgentOptions);
  await emitProgress({ activeStage: 'advanced/area-plan' });
  const resumedAreaPlan = await restoreAreaPlanCheckpoint(context);
  const areaPlan =
    resumedAreaPlan ??
    (
      await runTimedStep(
        {
          logger: options.logger,
          label: 'advanced area planning turn',
          timings,
          detail: (result) =>
            `thread ${result.threadId ?? 'none'}, ${listPlanConcepts(result.plan).length} concepts`,
        },
        async () => {
          const pendingAttempt = await resume.pendingCandidates.load(
            'area-plan',
            decodePendingAreaAttempt,
          );
          await beginStage('area-plan');
          return runRepairableStage({
            firstAttempt: pendingAttempt ?? 1,
            maxAttempts: MAX_AREA_PLAN_ATTEMPTS,
            beforeAttempt: (attempt) => resume.pendingCandidates.save('area-plan', attempt),
            retryError: (error) => !findTurnBudgetError(error) && isModelOutputParseError(error),
            attempt: async (attempt) => {
              const handoffArtifactPath = await writePreRefinementHandoff({
                summary:
                  attempt === 1
                    ? 'Repo census is complete. Concept planning is the next step. No concept plan or backbone has been materialized yet.'
                    : `Previous concept planning output was not valid structured JSON/YAML. Retry concept planning and return only the required structured response (attempt ${attempt}/${MAX_AREA_PLAN_ATTEMPTS}).`,
                activeSchemaRefs: [],
              });
              run.areaPlanningTurnCount += 1;
              const result = await planner.planAreas({
                workspace: options.workspace,
                repo: options.repo,
                ref: options.ref,
                repoCensus: census,
                graphifyHints,
                promptPackage,
                logger: options.logger,
                promptRunner: advancedThreadManager,
                handoffArtifactPath,
                schemaValidationCommand: await prepareAreaPlanSchemaValidationCommand(),
              });
              await writeWorkspaceJsonArtifact(
                options.workspace,
                'analysis/area-plan.json',
                result.plan,
              );
              await writeWorkspaceArtifact(
                options.workspace,
                'analysis/area-plan-response.json',
                result.rawResponse,
              );
              run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
              await emitProgress({
                advanced: {
                  lastCompletedStage: 'area-plan',
                  currentAdvancedThreadId: result.threadId,
                },
                threadId: result.threadId,
              });
              return result;
            },
            afterRetryableError: async (error, attempt) => {
              if (!isModelOutputParseError(error)) throw error;
              await resume.pendingCandidates.save('area-plan', attempt + 1);
              run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
              options.logger.warn(
                `Retrying concept planning after invalid structured output (${attempt}/${MAX_AREA_PLAN_ATTEMPTS}): ${error.message}`,
              );
              await writeWorkspaceArtifact(
                options.workspace,
                'analysis/area-plan-response.json',
                error.rawResponse,
              );
            },
          });
        },
      )
    ).plan;

  const schemaSetManager = buildSchemaSetManagerFromAreaPlan({
    schemaRegistry,
    areaPlan,
  });
  if (resume.allowResume && savedSchemaSet)
    schemaSetManager.restoreRootSchemaRefs(savedSchemaSet.rootSchemaRefs);
  const appDescription = normalizeGalleryDescriptionText(
    areaPlan.galleryDescription ?? areaPlan.repoSummary,
  );
  let catalogRuntime: ReturnType<typeof schemaSetManager.snapshot>['runtime'] | undefined;
  let currentCatalog: SchemaFlowCatalog | undefined;
  const buildCurrentSchemaFlowCatalog = (): SchemaFlowCatalog => {
    const snapshot = schemaSetManager.snapshot();
    if (snapshot.runtime === catalogRuntime && currentCatalog) return currentCatalog;
    const effectiveSchema = snapshot.runtime.resolved.effectiveSchema;
    if (!effectiveSchema) {
      throw new Error('Active schema set did not resolve an effective schema');
    }
    currentCatalog = buildSchemaFlowCatalog({
      schema: effectiveSchema,
      semantics: snapshot.runtime.semantics,
      activeSchemaRefs: snapshot.activeSchemaRefs,
    });
    catalogRuntime = snapshot.runtime;
    return currentCatalog;
  };
  let writtenSchemaRuntime: typeof catalogRuntime;
  const writeSchemaSetArtifacts = async () => {
    const snapshot = schemaSetManager.snapshot();
    if (writtenSchemaRuntime === snapshot.runtime) return;
    await writeWorkspaceJsonArtifact(
      options.workspace,
      'analysis/schema-set.json',
      serializeSchemaSetArtifact(snapshot),
    );
    await writeWorkspaceJsonArtifact(
      options.workspace,
      'analysis/schema-flow-catalog.json',
      buildCurrentSchemaFlowCatalog(),
    );
    writtenSchemaRuntime = snapshot.runtime;
  };
  const prepareSchemaValidationCommand = async () => {
    const snapshot = schemaSetManager.snapshot();
    return writeSchemaSelectionValidationArtifacts({
      rootSchemaRefs: snapshot.rootSchemaRefs,
      activeSchemaRefs: snapshot.activeSchemaRefs,
      candidateSchemaRefs: snapshot.candidateSchemaRefs,
    });
  };

  const level0BackboneBuilder =
    dependencies.level0BackboneBuilder ?? new CodexLevel0BackboneBuilder(codexAgentOptions);
  const level0BackboneRepairer =
    dependencies.level0BackboneRepairer ?? new CodexLevel0BackboneBuilder(codexAgentOptions);
  const level0BackboneReviewer =
    dependencies.level0BackboneReviewer ?? new CodexLevel0BackboneReviewer(codexAgentOptions);
  const level0BackboneReviewerRepairer =
    dependencies.level0BackboneReviewerRepairer ??
    new CodexLevel0BackboneReviewer(codexAgentOptions);
  const wave1Reviewer = dependencies.wave1Reviewer ?? new CodexWave1Reviewer(codexAgentOptions);
  const wave1ReviewerRepairer =
    dependencies.wave1ReviewerRepairer ?? new CodexWave1Reviewer(codexAgentOptions);

  return {
    ...context,
    areaPlan,
    schemaSetManager,
    appDescription,
    buildCurrentSchemaFlowCatalog,
    writeSchemaSetArtifacts,
    prepareSchemaValidationCommand,
    level0BackboneBuilder,
    level0BackboneRepairer,
    level0BackboneReviewer,
    level0BackboneReviewerRepairer,
    wave1Reviewer,
    wave1ReviewerRepairer,
  };
}
