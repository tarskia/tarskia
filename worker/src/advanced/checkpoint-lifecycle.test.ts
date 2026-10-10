import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { beginCheckpointStage } from './checkpoint-lifecycle';
import { ADVANCED_CHECKPOINT_STAGES } from './types';

it.each(
  ADVANCED_CHECKPOINT_STAGES,
)('invalidates %s before moving stale artifacts', async (stage) => {
  const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-lifecycle-'));
  const workspace = {
    jobRoot,
    targetRepoPath: '',
    schemaRepoPath: '',
    workspaceOutputDir: path.join(jobRoot, 'out'),
    repoRevision: 'abc',
  };
  const analysis = path.join(workspace.workspaceOutputDir, 'analysis');
  await fs.mkdir(analysis, { recursive: true });
  const names = [
    'repo-census.json',
    'graphify-hints.json',
    'area-plan.json',
    'schema-flow-catalog.json',
    'level0-backbone.pre-review.yaml',
    'level0-review.yaml',
    'node-refinement-state.json',
    'level0-wave1.yaml',
    'final-graph.pre-review.yaml',
    'final-graph.yaml',
    'final-review.response.yaml',
  ];
  for (const name of names) await fs.writeFile(path.join(analysis, name), name);
  await fs.mkdir(path.join(analysis, 'node-refinement-cache'));
  await fs.writeFile(path.join(analysis, 'node-refinement-cache/cached.json'), 'cached');
  const rank = ADVANCED_CHECKPOINT_STAGES.indexOf(stage);
  await beginCheckpointStage({
    workspace,
    stage,
    onProgress: async (update) => {
      expect(update.advanced?.lastCompletedStage).toBe(
        ADVANCED_CHECKPOINT_STAGES[rank - 1] ?? null,
      );
      expect(await fs.readFile(path.join(analysis, 'node-refinement-state.json'), 'utf8')).toBe(
        'node-refinement-state.json',
      );
      if (rank <= 4) expect(update.advanced?.currentNodeRefinementArtifact).toBeNull();
      if (rank <= 5)
        expect(update.advanced).toMatchObject({
          currentGraphArtifact: null,
          currentGraphResponseArtifact: null,
          currentGraphReviewCompleted: false,
        });
    },
  });
  const expectedStages = [0, 0, 1, 1, 2, 3, 4, 4, 5, 6, 6];
  for (const [index, name] of names.entries()) {
    if (expectedStages[index] >= rank)
      await expect(fs.access(path.join(analysis, name))).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await fs.readFile(path.join(analysis, name), 'utf8')).toBe(name);
  }
  if (rank <= 4)
    await expect(fs.access(path.join(analysis, 'node-refinement-cache'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  else
    expect(
      await fs.readFile(path.join(analysis, 'node-refinement-cache/cached.json'), 'utf8'),
    ).toBe('cached');
  await fs.rm(jobRoot, { recursive: true, force: true });
});
