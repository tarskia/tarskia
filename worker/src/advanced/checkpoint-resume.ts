import { promises as checkpointFs } from 'node:fs';
import path from 'node:path';
import type { DiagramGenerationResumeOptions, GenerateDiagramOptions } from '../ai-diagram-service';
import type { AdvancedThreadManager } from '../codex/advanced-thread-manager';
import { findTurnBudgetError } from '../codex/turn-policy';
import { runTimedStep, type TimingEntry } from '../logger';
import type { SchemaRegistry } from '../semantic/schema-loader';
import {
  checkpointInputs,
  firstChangedStage,
  type StageRecords,
  stageFingerprint,
  stageInputs,
} from './checkpoint-inputs';
import {
  CheckpointParseError,
  loadAreaPlanCheckpoint,
  loadGraphCollationCheckpoint,
  loadLevel0BackboneCheckpoint,
  loadLevel0ReviewCheckpoint,
  loadLevel0Wave1Checkpoint,
  loadNodeRefinementCheckpoint,
  loadRepoCensusCheckpoint,
} from './checkpoints';
import { listPlanConcepts } from './concept-plan';
import { findDisconnectedExpandableGroupNodes } from './node-refinement-engine';
import { PendingStageCandidates } from './pending-candidates';
import type { buildSchemaSetManagerFromAreaPlan } from './schema-set';
import { summarizeNodeIds, validateSemanticDocument } from './stages/shared';
import { type AdvancedCheckpointStage, compareAdvancedCheckpointStage } from './types';

export function isRecoverableCheckpointLoadError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT') ||
    error instanceof CheckpointParseError
  );
}

export function shouldResumeCheckpoint(
  stage: AdvancedCheckpointStage,
  resumeState: DiagramGenerationResumeOptions['advanced'],
): boolean {
  if (!resumeState?.lastCompletedStage) {
    return false;
  }
  if (compareAdvancedCheckpointStage(stage, resumeState.lastCompletedStage) > 0) {
    return false;
  }
  if (
    resumeState.restartFrom &&
    compareAdvancedCheckpointStage(stage, resumeState.restartFrom) >= 0
  ) {
    return false;
  }
  return true;
}

export function shouldResumePartialNodeRefinement(
  resumeState: DiagramGenerationResumeOptions['advanced'],
): boolean {
  if (
    !resumeState?.currentNodeRefinementArtifact ||
    resumeState.lastCompletedStage !== 'level0-review'
  ) {
    return false;
  }
  if (
    resumeState.restartFrom &&
    compareAdvancedCheckpointStage('node-refinement', resumeState.restartFrom) >= 0
  ) {
    return false;
  }
  return true;
}

export function createResumeState(options: GenerateDiagramOptions) {
  let resumeState = options.resume?.advanced;
  const inputs = checkpointInputs({ ...options.workspace, ...options });
  const pendingCandidates = new PendingStageCandidates(
    options.workspace,
    Boolean(options.resume?.pendingCandidates),
    (stage) => stageFingerprint(inputs, stage),
    options.logger,
  );
  const stageRecords: StageRecords = { ...resumeState?.stageRecords };
  const change = firstChangedStage(inputs, stageRecords, resumeState?.lastCompletedStage ?? null);
  if (change) {
    options.logger.info(change.message);
    const existing = resumeState?.restartFrom;
    resumeState = {
      ...resumeState!,
      restartFrom:
        existing && compareAdvancedCheckpointStage(existing, change.stage) < 0
          ? existing
          : change.stage,
    };
  }
  let computingStage: AdvancedCheckpointStage | undefined;
  const allowResume = true;

  return {
    resumeState,
    inputs,
    pendingCandidates,
    stageRecords,
    change,
    computingStage: computingStage as AdvancedCheckpointStage | undefined,
    allowResume,
  };
}

export function createCheckpointLoader(
  options: GenerateDiagramOptions,
  resume: ReturnType<typeof createResumeState>,
  timings: TimingEntry[],
) {
  const tryLoadCheckpoint = async <T>(params: {
    enabled: boolean;
    stage: AdvancedCheckpointStage;
    label: string;
    stageDescription: string;
    detail?: (result: T) => string;
    load: () => Promise<T>;
  }): Promise<T | undefined> => {
    if (!params.enabled) {
      return undefined;
    }
    try {
      const recordPath = path.join(
        options.workspace.workspaceOutputDir,
        `analysis/checkpoint-${params.stage}.json`,
      );
      let saved: unknown;
      try {
        saved = JSON.parse(await checkpointFs.readFile(recordPath, 'utf8'));
      } catch (error) {
        if (findTurnBudgetError(error)) throw error;
        throw new CheckpointParseError(recordPath, error);
      }
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('inputs' in saved) ||
        !('fingerprint' in saved) ||
        saved.fingerprint !== stageFingerprint(resume.inputs, params.stage) ||
        JSON.stringify(saved.inputs) !== JSON.stringify(stageInputs(resume.inputs, params.stage))
      )
        throw new CheckpointParseError(
          recordPath,
          new Error('checkpoint input fingerprint or format changed'),
        );
      return await runTimedStep(
        {
          logger: options.logger,
          label: params.label,
          timings,
          detail: params.detail,
        },
        params.load,
      );
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (isRecoverableCheckpointLoadError(error)) {
        options.logger.warn(
          `Recomputing from ${params.stage}: checkpoint validation changed (accepted → ${
            error instanceof Error ? error.message : String(error)
          })`,
        );
        resume.allowResume = false;
        return undefined;
      }
      throw error;
    }
  };

  return tryLoadCheckpoint;
}

interface CheckpointContext {
  options: GenerateDiagramOptions;
  resume: ReturnType<typeof createResumeState>;
  tryLoadCheckpoint: ReturnType<typeof createCheckpointLoader>;
}
interface SchemaCheckpointContext extends CheckpointContext {
  schemaRegistry: SchemaRegistry;
}

export async function restoreCensusCheckpoint(context: CheckpointContext) {
  const { options, resume, tryLoadCheckpoint } = context;
  const resumedCensus = await tryLoadCheckpoint({
    enabled: resume.allowResume && shouldResumeCheckpoint('repo-census', resume.resumeState),
    stage: 'repo-census',
    label: 'advanced repo census resume',
    stageDescription: 'advanced repo census',
    detail: (result) =>
      `${result.summary.totalFiles} files, ${result.summary.totalDirectories} directories, ${result.signals.length} signals`,
    load: async () => loadRepoCensusCheckpoint(options.workspace),
  });
  return resumedCensus;
}

export async function restoreAreaPlanCheckpoint(context: CheckpointContext) {
  const { options, resume, tryLoadCheckpoint } = context;
  const resumedAreaPlan = await tryLoadCheckpoint({
    enabled: resume.allowResume && shouldResumeCheckpoint('area-plan', resume.resumeState),
    stage: 'area-plan',
    label: 'advanced area plan resume',
    stageDescription: 'advanced area plan',
    detail: (result) => `${listPlanConcepts(result).length} concepts`,
    load: async () => loadAreaPlanCheckpoint(options.workspace),
  });
  return resumedAreaPlan;
}

export async function restoreBackboneCheckpoint(context: SchemaCheckpointContext) {
  const { options, resume, tryLoadCheckpoint, schemaRegistry } = context;
  const resumedLevel0Backbone = await tryLoadCheckpoint({
    enabled: resume.allowResume && shouldResumeCheckpoint('level0-backbone', resume.resumeState),
    stage: 'level0-backbone',
    label: 'advanced level-0 backbone resume',
    stageDescription: 'advanced level-0 backbone',
    detail: (result) =>
      `${result.doc.entities.length} entities, ${result.doc.relations.length} relations`,
    load: async () => {
      const result = await loadLevel0BackboneCheckpoint(options.workspace);
      const checked = validateSemanticDocument({
        rawYaml: result.rawYaml,
        schemaRegistry,
        primaryDocumentInput: options.primaryDocumentInput,
      });
      if (!checked.ok)
        throw new CheckpointParseError(
          'level0-backbone',
          new Error(checked.diagnostics.map((d) => d.message).join('; ')),
        );
      return result;
    },
  });
  return resumedLevel0Backbone;
}

export async function restoreBackboneReviewCheckpoint(context: SchemaCheckpointContext) {
  const { options, resume, tryLoadCheckpoint, schemaRegistry } = context;
  const shouldLoadReviewedBackboneCheckpoint =
    resume.allowResume && shouldResumeCheckpoint('level0-review', resume.resumeState);
  const resumedLevel0Review = await tryLoadCheckpoint({
    enabled: shouldLoadReviewedBackboneCheckpoint,
    stage: 'level0-review',
    label: 'advanced level-0 review resume',
    stageDescription: 'advanced level-0 backbone review',
    detail: (result) =>
      `${result.doc.entities.length} entities, ${result.doc.relations.length} relations`,
    load: async () => {
      const result = await loadLevel0ReviewCheckpoint(options.workspace);
      const checked = validateSemanticDocument({
        rawYaml: result.rawYaml,
        schemaRegistry,
        primaryDocumentInput: options.primaryDocumentInput,
      });
      if (!checked.ok)
        throw new CheckpointParseError(
          'level0-review',
          new Error(checked.diagnostics.map((d) => d.message).join('; ')),
        );
      return result;
    },
  });
  return resumedLevel0Review;
}

export async function restoreWave1Checkpoint(
  context: CheckpointContext & { wave1CompletedOnResume: boolean },
) {
  const { options, resume, tryLoadCheckpoint, wave1CompletedOnResume } = context;
  const resumedWave1 = await tryLoadCheckpoint({
    enabled:
      resume.allowResume &&
      wave1CompletedOnResume &&
      (!resume.change ||
        compareAdvancedCheckpointStage(resume.change.stage, 'node-refinement') > 0) &&
      shouldResumeCheckpoint('level0-review', resume.resumeState),
    stage: 'node-refinement',
    label: 'advanced wave-1 backbone resume',
    stageDescription: 'advanced wave-1 backbone',
    load: async () => loadLevel0Wave1Checkpoint(options.workspace),
  });
  return resumedWave1;
}

export async function restoreNodeRefinementCheckpoints(
  context: CheckpointContext & {
    schemaSetManager: ReturnType<typeof buildSchemaSetManagerFromAreaPlan>;
  },
) {
  const { options, resume, tryLoadCheckpoint, schemaSetManager } = context;
  let ignoredNodeRefinementCheckpoint = false;
  let resumedCompletedNodeRefinement = await tryLoadCheckpoint({
    enabled: resume.allowResume && shouldResumeCheckpoint('node-refinement', resume.resumeState),
    stage: 'node-refinement',
    label: 'advanced node refinement resume',
    stageDescription: 'advanced node refinement',
    detail: (result) =>
      `${Object.keys(result.nodesById).length} nodes, ${result.edgeContracts.length} edge contracts`,
    load: async () =>
      loadNodeRefinementCheckpoint({
        workspace: options.workspace,
        artifactPath: resume.resumeState?.currentNodeRefinementArtifact ?? undefined,
      }),
  });
  if (resumedCompletedNodeRefinement) {
    const disconnectedGroups = findDisconnectedExpandableGroupNodes(
      resumedCompletedNodeRefinement,
      schemaSetManager.snapshot().runtime.semantics,
    );
    if (disconnectedGroups.length > 0) {
      options.logger.warn(
        `Ignoring completed node-refinement checkpoint because it contains disconnected expandable group nodes that no longer validate: ${summarizeNodeIds(disconnectedGroups)}`,
      );
      ignoredNodeRefinementCheckpoint = true;
      resumedCompletedNodeRefinement = undefined;
    }
  }
  let resumedPartialNodeRefinement = resumedCompletedNodeRefinement
    ? undefined
    : await tryLoadCheckpoint({
        enabled: resume.allowResume && shouldResumePartialNodeRefinement(resume.resumeState),
        stage: 'node-refinement',
        label: 'advanced node refinement continuation resume',
        stageDescription: 'advanced node refinement continuation',
        detail: (result) =>
          `${Object.keys(result.nodesById).length} nodes, ${result.edgeContracts.length} edge contracts`,
        load: async () =>
          loadNodeRefinementCheckpoint({
            workspace: options.workspace,
            artifactPath: resume.resumeState?.currentNodeRefinementArtifact ?? undefined,
          }),
      });
  if (resumedPartialNodeRefinement) {
    const disconnectedGroups = findDisconnectedExpandableGroupNodes(
      resumedPartialNodeRefinement,
      schemaSetManager.snapshot().runtime.semantics,
    );
    if (disconnectedGroups.length > 0) {
      options.logger.warn(
        `Ignoring partial node-refinement checkpoint because it contains disconnected expandable group nodes that no longer validate: ${summarizeNodeIds(disconnectedGroups)}`,
      );
      ignoredNodeRefinementCheckpoint = true;
      resumedPartialNodeRefinement = undefined;
    }
  }

  return {
    ignoredNodeRefinementCheckpoint,
    resumedCompletedNodeRefinement,
    resumedPartialNodeRefinement,
  };
}

export async function restoreGraphCheckpoints(
  context: SchemaCheckpointContext & {
    advancedThreadManager: AdvancedThreadManager;
    ignoredNodeRefinementCheckpoint: boolean;
  },
) {
  const {
    options,
    resume,
    tryLoadCheckpoint,
    schemaRegistry,
    advancedThreadManager,
    ignoredNodeRefinementCheckpoint,
  } = context;
  const loadGraphCheckpoint = async (artifactPath: string) => {
    const result = await loadGraphCollationCheckpoint({
      workspace: options.workspace,
      artifactPath,
      responseArtifactPath: resume.resumeState?.currentGraphResponseArtifact ?? undefined,
      threadId: advancedThreadManager.getThreadId(),
    });
    const checked = validateSemanticDocument({
      rawYaml: result.rawYaml,
      schemaRegistry,
      primaryDocumentInput: options.primaryDocumentInput,
    });
    if (!checked.ok)
      throw new CheckpointParseError(
        artifactPath,
        new Error(checked.diagnostics.map((diagnostic) => diagnostic.message).join('; ')),
      );
    return result;
  };
  // Restore both checkpoints before a recomputed stage disables further reuse.
  const resumedGraph = await tryLoadCheckpoint({
    enabled:
      resume.allowResume &&
      !ignoredNodeRefinementCheckpoint &&
      shouldResumeCheckpoint('graph-collation', resume.resumeState) &&
      Boolean(resume.resumeState?.currentGraphArtifact),
    label: 'advanced graph collation resume',
    stage: 'graph-collation',
    stageDescription: 'advanced graph collation',
    load: async () =>
      loadGraphCheckpoint(
        await checkpointFs
          .access(
            path.join(options.workspace.workspaceOutputDir, 'analysis/final-graph.pre-review.yaml'),
          )
          .then(
            () => 'analysis/final-graph.pre-review.yaml',
            () =>
              resume.resumeState?.currentGraphReviewCompleted
                ? 'analysis/final-graph.pre-review.yaml'
                : (resume.resumeState?.currentGraphArtifact ?? ''),
          ),
      ),
  });
  const resumedFinalReview = await tryLoadCheckpoint({
    enabled:
      resume.allowResume &&
      Boolean(resumedGraph) &&
      Boolean(resume.resumeState?.currentGraphReviewCompleted) &&
      shouldResumeCheckpoint('final-review', resume.resumeState),
    label: 'advanced final review resume',
    stage: 'final-review',
    stageDescription: 'advanced final review',
    load: async () => loadGraphCheckpoint(resume.resumeState?.currentGraphArtifact ?? ''),
  });
  return { resumedGraph, resumedFinalReview };
}
