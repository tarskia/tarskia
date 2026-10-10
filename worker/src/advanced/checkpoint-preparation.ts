import {
  isRecoverableCheckpointLoadError,
  shouldResumeCheckpoint,
  shouldResumePartialNodeRefinement,
} from './checkpoint-resume';
import {
  CheckpointParseError,
  loadSchemaSetCheckpoint,
  prepareBackboneCheckpoints,
} from './checkpoints';
import type { createPipelineContext } from './stages/pipeline-context';

export async function prepareResume(context: ReturnType<typeof createPipelineContext>) {
  const { options, resume } = context;
  const wave1CompletedOnResume = await prepareBackboneCheckpoints(
    options.workspace,
    resume.resumeState,
    (message) => options.logger.warn(message),
  );
  const shouldRestoreSchemaSet =
    shouldResumePartialNodeRefinement(resume.resumeState) ||
    shouldResumeCheckpoint('node-refinement', resume.resumeState) ||
    shouldResumeCheckpoint('graph-collation', resume.resumeState) ||
    (resume.resumeState?.restartFrom === 'node-refinement' && wave1CompletedOnResume);
  const savedSchemaSet = shouldRestoreSchemaSet
    ? await loadSchemaSetCheckpoint(options.workspace).catch((error) => {
        if (isRecoverableCheckpointLoadError(error)) {
          // Accepted schema proposals affect every downstream checkpoint. Rebuild their
          // producers when the saved schema roots cannot be trusted.
          if (error instanceof CheckpointParseError) resume.allowResume = false;
          options.logger.warn(
            `${error instanceof Error ? error.message : String(error)}; recomputing schema checkpoint`,
          );
          return undefined;
        }
        throw error;
      })
    : undefined;

  return { ...context, savedSchemaSet, wave1CompletedOnResume };
}
