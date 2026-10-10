import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { CodexNodeRefiner } from '../../codex/node-refiner';
import { runTimedStep } from '../../logger';
import { serializeDocument } from '../../semantic';
import { restoreNodeRefinementCheckpoints, restoreWave1Checkpoint } from '../checkpoint-resume';
import { assembleRefinedDocument } from '../node-refinement-engine';
import { dedupeSchemaActivations } from '../schema-set';
import type { runLevel0Review } from './level0-review';
import { prepareNodeRefinementCallbacks } from './node-refinement-callbacks';
import { runWave1Review } from './wave1-review';

export async function runNodeRefinementStage(context: Awaited<ReturnType<typeof runLevel0Review>>) {
  const {
    options,
    dependencies,
    codexAgentOptions,
    timings,
    resume,
    emitProgress,
    beginStage,
    savedSchemaSet,
    schemaSetManager,
    writeSchemaSetArtifacts,
    backbone,
  } = context;
  const resumedWave1 = await restoreWave1Checkpoint(context);
  if (resumedWave1) {
    backbone.level0BackboneResult = resumedWave1;
    const rootIds = new Set(resumedWave1.doc.entities.map((entity) => entity.id));
    backbone.level0BuildState = {
      ...backbone.level0BuildState,
      level0Doc: resumedWave1.doc,
      visibleResponsibilityIds: backbone.level0BuildState.visibleResponsibilityIds.filter((id) =>
        rootIds.has(id),
      ),
    };
    await writeWorkspaceArtifact(
      options.workspace,
      'analysis/level0-backbone.yaml',
      resumedWave1.rawYaml,
    );
  }

  if (resume.allowResume && savedSchemaSet) {
    schemaSetManager.restoreRootSchemaRefs(savedSchemaSet.rootSchemaRefs);
    await writeSchemaSetArtifacts();
  }

  const refiner = dependencies.nodeRefiner ?? new CodexNodeRefiner(codexAgentOptions);
  const repairer = dependencies.nodeRefinerRepairer ?? new CodexNodeRefiner(codexAgentOptions);

  await emitProgress({ activeStage: 'advanced/node-refinement' });
  const {
    ignoredNodeRefinementCheckpoint,
    resumedCompletedNodeRefinement,
    resumedPartialNodeRefinement,
  } = await restoreNodeRefinementCheckpoints(context);
  const nodeRefinementState =
    resumedCompletedNodeRefinement ??
    (await runTimedStep(
      {
        logger: options.logger,
        label: 'advanced node refinement',
        timings,
        detail: (result) =>
          `${Object.keys(result.nodesById).length} nodes, ${result.edgeContracts.length} edge contracts`,
      },
      async () => {
        await beginStage('node-refinement', Boolean(resumedPartialNodeRefinement));
        const callbacks = await prepareNodeRefinementCallbacks({
          ...context,
          resumedPartialNodeRefinement,
          refiner,
          repairer,
        });
        const { startingState, runNodeRefinementPass } = callbacks;
        let workingState = startingState;
        if (!workingState.reviewedDepths.includes(1)) {
          const hasPendingRootTasks = workingState.queue.some((task) => task.depth === 0);
          if (hasPendingRootTasks) {
            workingState = await runNodeRefinementPass(workingState, 1);
          }

          const hasPendingDepth1Tasks = workingState.queue.some((task) => task.depth === 1);
          if (hasPendingDepth1Tasks && !workingState.reviewedDepths.includes(1)) {
            workingState = await runWave1Review({ ...context, ...callbacks }, workingState);
          }
        }

        await emitProgress({ activeStage: 'advanced/node-refinement' });
        const result = await runNodeRefinementPass(workingState);
        const artifactPath = await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/node-refinement-state.json',
          result,
        );
        await writeSchemaSetArtifacts();
        await emitProgress({
          advanced: {
            lastCompletedStage: 'node-refinement',
            currentNodeRefinementArtifact: artifactPath,
          },
        });
        return result;
      },
    ));

  const assembledDoc = assembleRefinedDocument({
    semantics: schemaSetManager.snapshot().runtime.semantics,
    baseDoc: {
      ...backbone.level0BuildState.level0Doc,
      schemaRefs: dedupeSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
    },
    state: nodeRefinementState,
  });
  await writeWorkspaceArtifact(
    options.workspace,
    'analysis/assembled-refined-document.yaml',
    serializeDocument(assembledDoc),
  );

  return { ...context, nodeRefinementState, assembledDoc, ignoredNodeRefinementCheckpoint };
}
