import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagramGenerationProgressUpdate } from '../ai-diagram-service';
import type { PreparedWorkspace } from '../workspace';
import {
  ADVANCED_CHECKPOINT_STAGES,
  type AdvancedCheckpointStage,
  compareAdvancedCheckpointStage,
} from './types';

// The earliest stage that produces each canonical artifact. Shared schema/flow artifacts
// are rebuilt from preserved inputs, rather than exposed to prompts from a previous run.
function artifactStage(name: string): AdvancedCheckpointStage | undefined {
  if (name.startsWith('pending-')) {
    return ADVANCED_CHECKPOINT_STAGES.find(
      (stage) => name === `pending-${stage}.json` || name.startsWith(`pending-${stage}-`),
    );
  }
  if (name.startsWith('checkpoint-') && name.endsWith('.json')) {
    return ADVANCED_CHECKPOINT_STAGES.find((stage) => name === `checkpoint-${stage}.json`);
  }
  if (name === 'repo-census.json' || name.startsWith('graphify')) return 'repo-census';
  if (name.startsWith('area-plan') || name.startsWith('pre-refinement')) return 'area-plan';
  if (
    name.startsWith('level0-wave1') ||
    name.startsWith('wave1') ||
    name.startsWith('node-refinement') ||
    name.startsWith('validate-node-refinement') ||
    name === 'assembled-refined-document.yaml'
  )
    return 'node-refinement';
  if (name.startsWith('level0-review') || name.startsWith('backbone-review'))
    return 'level0-review';
  if (name.startsWith('level0-backbone') || name.startsWith('flow-')) return 'level0-backbone';
  if (name.startsWith('schema-') || name.startsWith('validate-schema-')) return 'area-plan';
  if (name.startsWith('final-review') || name === 'final-graph.yaml') return 'final-review';
  if (name.startsWith('final-') || name.startsWith('graph-collation')) return 'graph-collation';
  return undefined;
}

export async function beginCheckpointStage(params: {
  workspace: PreparedWorkspace;
  stage: AdvancedCheckpointStage;
  partial?: boolean;
  onProgress: (update: DiagramGenerationProgressUpdate) => Promise<void>;
}): Promise<void> {
  const { stage, partial = false } = params;
  const clearsNodes = compareAdvancedCheckpointStage(stage, 'node-refinement') <= 0;
  const clearsGraph = compareAdvancedCheckpointStage(stage, 'graph-collation') <= 0;
  // Commit the invalidation first. An interruption during archival must never leave
  // metadata claiming the old later stages are complete.
  await params.onProgress({
    advanced: {
      lastCompletedStage:
        ADVANCED_CHECKPOINT_STAGES[ADVANCED_CHECKPOINT_STAGES.indexOf(stage) - 1] ?? null,
      ...(clearsNodes && !partial
        ? {
            currentNodeRefinementArtifact: null,
          }
        : {}),
      ...(stage === 'final-review' ? { currentGraphReviewCompleted: false } : {}),
      ...(clearsGraph
        ? {
            currentGraphArtifact: null,
            currentGraphResponseArtifact: null,
            currentGraphReviewCompleted: false,
          }
        : {}),
    },
  });
  const analysis = path.join(params.workspace.workspaceOutputDir, 'analysis');
  let names: string[];
  try {
    names = await fs.readdir(analysis);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const staleNames = names.filter((name) => {
    if (name === 'node-refinement-cache') return clearsNodes;
    const owner = artifactStage(name);
    return owner !== undefined && compareAdvancedCheckpointStage(owner, stage) >= (partial ? 1 : 0);
  });
  if (staleNames.length === 0) return;
  await fs.mkdir(path.join(analysis, 'stale'), { recursive: true });
  const destination = await fs.mkdtemp(path.join(analysis, 'stale', `${Date.now()}-${stage}-`));
  for (const name of staleNames)
    await fs.rename(path.join(analysis, name), path.join(destination, name));
}
