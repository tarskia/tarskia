import { createHash } from 'node:crypto';
import { version } from '../../package.json';
import { GRAPHIFY_COLLECTION_POLICY } from './graphify-hints';
import {
  ADVANCED_CHECKPOINT_STAGES,
  type AdvancedCheckpointStage,
  compareAdvancedCheckpointStage,
} from './types';

export const CHECKPOINT_FORMAT_VERSION = 1;
export interface CheckpointInputs {
  cliVersion: string;
  checkpointFormat: number;
  repoRevision: string;
  graphifyHints: string;
  graphifyCollectionPolicy?: string;
  schemaSourceRevision: string | null;
  maxDepth: number;
}
export interface StageRecord {
  inputs: Partial<CheckpointInputs>;
  fingerprint: string;
  model: string;
  reasoningEffort: string;
  completed: boolean;
}
export type StageRecords = Partial<Record<AdvancedCheckpointStage, StageRecord>>;
export function checkpointInputs(params: {
  repoRevision: string;
  schemaSourceRevision?: string;
  graphifyHintsMode?: string;
  nodeRefinementMaxDepth?: number;
}): CheckpointInputs {
  return {
    cliVersion: version,
    checkpointFormat: CHECKPOINT_FORMAT_VERSION,
    repoRevision: params.repoRevision,
    schemaSourceRevision: params.schemaSourceRevision ?? null,
    graphifyHints: params.graphifyHintsMode ?? 'auto',
    ...(params.graphifyHintsMode === 'off'
      ? {}
      : { graphifyCollectionPolicy: GRAPHIFY_COLLECTION_POLICY }),
    maxDepth: params.nodeRefinementMaxDepth ?? 8,
  };
}
export function stageInputs(
  inputs: CheckpointInputs,
  stage: AdvancedCheckpointStage,
): Partial<CheckpointInputs> {
  const {
    cliVersion,
    checkpointFormat,
    repoRevision,
    graphifyHints,
    graphifyCollectionPolicy,
    schemaSourceRevision,
    maxDepth,
  } = inputs;
  return {
    cliVersion,
    checkpointFormat,
    repoRevision,
    graphifyHints,
    ...(graphifyHints === 'off' ? {} : { graphifyCollectionPolicy }),
    ...(compareAdvancedCheckpointStage(stage, 'area-plan') >= 0 ? { schemaSourceRevision } : {}),
    ...(compareAdvancedCheckpointStage(stage, 'node-refinement') >= 0 ? { maxDepth } : {}),
  };
}
export function stageFingerprint(inputs: CheckpointInputs, stage: AdvancedCheckpointStage): string {
  return createHash('sha256')
    .update(JSON.stringify(stageInputs(inputs, stage)))
    .digest('hex');
}
export function firstChangedStage(
  inputs: CheckpointInputs,
  records: StageRecords | undefined,
  last: AdvancedCheckpointStage | null,
) {
  if (!last && !records?.['node-refinement']) return undefined;
  for (const stage of ADVANCED_CHECKPOINT_STAGES) {
    if (compareAdvancedCheckpointStage(stage, last ?? 'repo-census') > 0 && !records?.[stage])
      break;
    const old = records?.[stage]?.inputs;
    const current = stageInputs(inputs, stage);
    for (const [key, value] of Object.entries(current)) {
      const previous = old?.[key as keyof CheckpointInputs];
      if (previous !== value)
        return {
          stage,
          message: `Recomputing from ${stage}: ${key} changed (${String(previous ?? 'unknown')} → ${String(value)})`,
        };
    }
  }
  return undefined;
}
export function summarizeStageSettings(
  records: StageRecords | undefined,
  model: string,
  effort: string,
) {
  const completed = ADVANCED_CHECKPOINT_STAGES.flatMap((stage) =>
    records?.[stage]?.completed ? [records[stage]!] : [],
  );
  return {
    model: completed.length
      ? [...new Set(completed.map((record) => record.model))].join(', ')
      : model,
    reasoningEffort: completed.length
      ? [...new Set(completed.map((record) => record.reasoningEffort))].join(', ')
      : effort,
  };
}
