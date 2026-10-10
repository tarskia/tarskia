import type {
  DiagramGenerationProgressUpdate,
  GenerateDiagramOptions,
} from '../../ai-diagram-service';
import { writeWorkspaceJsonArtifact } from '../../artifacts';
import type { CodexClientLike } from '../../codex/diagram-agent';
import type { TimingEntry } from '../../logger';
import { type Diagnostic, sortDiagnostics } from '../../semantic';
import { emptyTokenUsageTotals } from '../../token-usage';
import type { AreaPlanner } from '../area-plan';
import { stageFingerprint, stageInputs } from '../checkpoint-inputs';
import { beginCheckpointStage } from '../checkpoint-lifecycle';
import { createCheckpointLoader, createResumeState } from '../checkpoint-resume';
import type {
  FinalGraphReviewer,
  FinalGraphReviewerRepairer,
  GraphCollator,
  GraphCollatorRepairer,
  Level0BackboneBuilder,
  Level0BackboneRepairer,
  Level0BackboneReviewer,
  Level0BackboneReviewerRepairer,
  NodeRefiner,
  NodeRefinerRepairer,
  Wave1Reviewer,
  Wave1ReviewerRepairer,
} from '../graph-builders';
import type { GraphifyHintsBuilder } from '../graphify-hints';
import { type AdvancedCheckpointStage, compareAdvancedCheckpointStage } from '../types';

export type AdvancedPipelineDependencies = {
  areaPlanner?: AreaPlanner;
  level0BackboneBuilder?: Level0BackboneBuilder;
  level0BackboneRepairer?: Level0BackboneRepairer;
  level0BackboneReviewer?: Level0BackboneReviewer;
  level0BackboneReviewerRepairer?: Level0BackboneReviewerRepairer;
  wave1Reviewer?: Wave1Reviewer;
  wave1ReviewerRepairer?: Wave1ReviewerRepairer;
  nodeRefiner?: NodeRefiner;
  nodeRefinerRepairer?: NodeRefinerRepairer;
  graphCollator?: GraphCollator;
  graphCollatorRepairer?: GraphCollatorRepairer;
  finalGraphReviewer?: FinalGraphReviewer;
  finalGraphReviewerRepairer?: FinalGraphReviewerRepairer;
  graphifyHintsBuilder?: GraphifyHintsBuilder;
  advancedThreadClient?: CodexClientLike;
};

export function createPipelineContext(
  options: GenerateDiagramOptions,
  dependencies: AdvancedPipelineDependencies,
  buildValidationHelperScript: (command: string, contextArtifact: string) => string,
) {
  const codexAgentOptions = { model: options.model, modelReasoningEffort: options.reasoningEffort };
  const startedAt = Date.now();
  const timings: TimingEntry[] = [];
  const resume = createResumeState(options);
  // Stage contexts share this object so accounting and error reporting see updates
  // even when a stage throws before returning its result.
  const run = {
    areaPlanningTurnCount: 0,
    level0TurnCount: 0,
    graphTurnCount: 0,
    totalTokenUsage: emptyTokenUsageTotals(),
    currentThreadId: resume.resumeState?.currentAdvancedThreadId ?? null,
    fallbackDiagnostics: [] as Diagnostic[],
    repaired: false,
  };
  const emitProgress = async (update: DiagramGenerationProgressUpdate): Promise<void> => {
    const completed = update.advanced?.lastCompletedStage;
    if (
      completed &&
      (completed === resume.computingStage ||
        (completed === 'bundle-compile' &&
          (resume.computingStage || !resume.stageRecords[completed])))
    ) {
      resume.stageRecords[completed] = {
        inputs: stageInputs(resume.inputs, completed),
        fingerprint: stageFingerprint(resume.inputs, completed),
        model: options.model?.trim() || 'Codex CLI default',
        reasoningEffort: options.reasoningEffort ?? 'medium',
        completed: true,
      };
      await writeWorkspaceJsonArtifact(
        options.workspace,
        `analysis/checkpoint-${completed}.json`,
        resume.stageRecords[completed],
      );
      update = {
        ...update,
        advanced: { ...update.advanced, stageRecords: { ...resume.stageRecords } },
      };
    }
    if (update.threadId !== undefined) run.currentThreadId = update.threadId;
    for (const diagnostic of update.diagnostics ?? []) {
      if (
        ['diagram.node_refinement.repair_fallback', 'diagram.wave1.review_fallback'].includes(
          diagnostic.code,
        ) &&
        !run.fallbackDiagnostics.includes(diagnostic)
      )
        run.fallbackDiagnostics.push(diagnostic);
    }
    await options.onProgress?.({
      ...update,
      ...(update.diagnostics
        ? {
            diagnostics: sortDiagnostics([
              ...update.diagnostics.filter((item) => !run.fallbackDiagnostics.includes(item)),
              ...run.fallbackDiagnostics,
            ]),
          }
        : {}),
    });
  };

  const beginStage = async (stage: AdvancedCheckpointStage, partial = false) => {
    resume.computingStage = stage;
    resume.stageRecords = Object.fromEntries(
      Object.entries(resume.stageRecords).filter(
        ([name]) => compareAdvancedCheckpointStage(name as AdvancedCheckpointStage, stage) < 0,
      ),
    );
    resume.stageRecords[stage] = {
      inputs: stageInputs(resume.inputs, stage),
      fingerprint: stageFingerprint(resume.inputs, stage),
      model: options.model?.trim() || 'Codex CLI default',
      reasoningEffort: options.reasoningEffort ?? 'medium',
      completed: false,
    };
    await beginCheckpointStage({
      workspace: options.workspace,
      stage,
      partial,
      onProgress: emitProgress,
    });
    await writeWorkspaceJsonArtifact(
      options.workspace,
      `analysis/checkpoint-${stage}.json`,
      resume.stageRecords[stage],
    );
    await emitProgress({ advanced: { stageRecords: { ...resume.stageRecords } } });
    // Only the first computing stage may use an earlier invocation's checkpoints.
    resume.allowResume = false;
  };

  const tryLoadCheckpoint = createCheckpointLoader(options, resume, timings);
  return {
    options,
    dependencies,
    codexAgentOptions,
    startedAt,
    timings,
    resume,
    run,
    emitProgress,
    beginStage,
    tryLoadCheckpoint,
    buildValidationHelperScript,
  };
}
export type PipelineContext = ReturnType<typeof createPipelineContext>;
