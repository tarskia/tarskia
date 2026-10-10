import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagramGenerationResumeOptions } from '../ai-diagram-service';
import {
  loadLevel0BackboneCheckpoint,
  loadLevel0ReviewCheckpoint,
  loadLevel0Wave1Checkpoint,
  loadNodeRefinementCheckpoint,
  prepareBackboneCheckpoints,
} from './checkpoints';

async function createWorkspace() {
  const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-test-'));
  const workspace = {
    jobRoot,
    targetRepoPath: path.join(jobRoot, 'target-repo'),
    schemaRepoPath: path.join(jobRoot, 'schema-repo'),
    workspaceOutputDir: path.join(jobRoot, 'out'),
    repoRevision: 'abc123',
  };
  await fs.mkdir(workspace.workspaceOutputDir, { recursive: true });
  return workspace;
}

describe('checkpoint loading', () => {
  it('rejects resume artifact paths outside the workspace output directory', async () => {
    const workspace = await createWorkspace();
    const outsideArtifact = path.join(jobRootParent(workspace.jobRoot), 'outside.json');
    await fs.writeFile(outsideArtifact, '{}\n', 'utf8');

    await expect(
      loadNodeRefinementCheckpoint({
        workspace,
        artifactPath: outsideArtifact,
      }),
    ).rejects.toThrow('escapes the workspace output directory');
  });
});

function jobRootParent(jobRoot: string): string {
  return path.dirname(jobRoot);
}

const resume = (
  lastCompletedStage: NonNullable<DiagramGenerationResumeOptions['advanced']>['lastCompletedStage'],
): NonNullable<DiagramGenerationResumeOptions['advanced']> => ({
  lastCompletedStage,
  restartFrom: null,
  previousRepoRevision: null,
  previousSchemaSourceRevision: null,
  currentAdvancedThreadId: null,
  currentNodeRefinementArtifact: null,
  currentGraphArtifact: null,
  currentGraphResponseArtifact: null,
  currentGraphReviewCompleted: false,
});

it.each([
  { reviewedDepths: undefined },
  { reviewedDepths: [] },
  { reviewedDepths: [1] },
])('uses the persisted wave-1 completion marker $reviewedDepths for legacy migration', async ({
  reviewedDepths,
}) => {
  const workspace = await createWorkspace();
  const analysis = path.join(workspace.workspaceOutputDir, 'analysis');
  await fs.mkdir(analysis);
  const latest =
    '# latest reviewed backbone\nversion: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n';
  await fs.writeFile(path.join(analysis, 'level0-backbone.yaml'), latest);
  if (reviewedDepths)
    await fs.writeFile(
      path.join(analysis, 'node-refinement-state.json'),
      JSON.stringify({
        rootNodeIds: [],
        queue: [],
        tasksByNodeId: {},
        nodesById: {},
        refinementsByNodeId: {},
        edgeContracts: [],
        activeEdgeProposals: [],
        budgets: { maxDepth: 8, maxTurns: 100, turnsUsed: 0 },
        reviewedDepths,
      }),
    );
  const completed = await prepareBackboneCheckpoints(workspace, resume('level0-review'));
  expect(completed).toBe(Boolean(reviewedDepths?.includes(1)));
  expect((await loadLevel0ReviewCheckpoint(workspace)).rawYaml).toBe(latest);
  if (completed) expect((await loadLevel0Wave1Checkpoint(workspace)).rawYaml).toBe(latest);
  else
    await expect(fs.access(path.join(analysis, 'level0-wave1.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
});

it('loads only stage-owned files and never overwrites existing checkpoints during legacy preparation', async () => {
  const workspace = await createWorkspace();
  const analysis = path.join(workspace.workspaceOutputDir, 'analysis');
  await fs.mkdir(analysis);
  const yaml = 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n';
  const stages = ['level0-backbone.pre-review.yaml', 'level0-review.yaml', 'level0-wave1.yaml'];
  for (const name of stages) await fs.writeFile(path.join(analysis, name), `# ${name}\n${yaml}`);
  await fs.writeFile(path.join(analysis, 'level0-backbone.yaml'), '# mutable handoff\n' + yaml);
  await fs.writeFile(
    path.join(analysis, 'node-refinement-state.json'),
    JSON.stringify({
      rootNodeIds: [],
      queue: [],
      tasksByNodeId: {},
      nodesById: {},
      refinementsByNodeId: {},
      edgeContracts: [],
      activeEdgeProposals: [],
      budgets: { maxDepth: 8, maxTurns: 100, turnsUsed: 0 },
      reviewedDepths: [1],
    }),
  );
  await prepareBackboneCheckpoints(workspace, resume('node-refinement'));
  const loaded = await Promise.all([
    loadLevel0BackboneCheckpoint(workspace),
    loadLevel0ReviewCheckpoint(workspace),
    loadLevel0Wave1Checkpoint(workspace),
  ]);
  expect(loaded.map((result) => result.rawYaml)).toEqual(
    stages.map((name) => `# ${name}\n${yaml}`),
  );
  await fs.rm(path.join(analysis, 'level0-review.yaml'));
  await expect(loadLevel0ReviewCheckpoint(workspace)).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
