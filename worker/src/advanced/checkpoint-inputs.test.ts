import { expect, it } from 'vitest';
import {
  checkpointInputs,
  firstChangedStage,
  type StageRecords,
  stageFingerprint,
  stageInputs,
  summarizeStageSettings,
} from './checkpoint-inputs';
import { ADVANCED_CHECKPOINT_STAGES } from './types';

const inputs = checkpointInputs({
  repoRevision: 'commit-a',
  schemaSourceRevision: 'schema-a',
  nodeRefinementMaxDepth: 2,
  graphifyHintsMode: 'off',
});
const records: StageRecords = Object.fromEntries(
  ADVANCED_CHECKPOINT_STAGES.map((stage) => [
    stage,
    {
      inputs: stageInputs(inputs, stage),
      fingerprint: stageFingerprint(inputs, stage),
      model: 'a',
      reasoningEffort: 'low',
      completed: true,
    },
  ]),
);
it.each([
  ['maxDepth', 4, 'node-refinement'],
  ['graphifyHints', 'auto', 'repo-census'],
  ['schemaSourceRevision', 'schema-b', 'area-plan'],
  ['cliVersion', 'new', 'repo-census'],
  ['checkpointFormat', 0, 'repo-census'],
  ['repoRevision', 'commit-b', 'repo-census'],
] as const)('finds the earliest stage for %s', (key, value, stage) => {
  expect(firstChangedStage({ ...inputs, [key]: value }, records, 'bundle-compile')?.stage).toBe(
    stage,
  );
});
it('does not invalidate model/effort changes and summarizes distinct settings in stage order', () => {
  const mixed = {
    ...records,
    'node-refinement': {
      ...records['node-refinement']!,
      model: 'b',
      reasoningEffort: 'high',
    },
  };
  expect(firstChangedStage(inputs, mixed, 'bundle-compile')).toBeUndefined();
  expect(summarizeStageSettings(mixed, 'unused', 'medium')).toEqual({
    model: 'a, b',
    reasoningEffort: 'low, high',
  });
});
it('invalidates legacy metadata and includes depth in refinement fingerprint only', () => {
  expect(firstChangedStage(inputs, undefined, 'level0-review')?.stage).toBe('repo-census');
  const changed = { ...inputs, maxDepth: 4 };
  expect(stageFingerprint(changed, 'area-plan')).toBe(stageFingerprint(inputs, 'area-plan'));
  expect(stageFingerprint(changed, 'node-refinement')).not.toBe(
    stageFingerprint(inputs, 'node-refinement'),
  );
});
