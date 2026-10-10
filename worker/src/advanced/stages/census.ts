import { writeWorkspaceJsonArtifact } from '../../artifacts';
import { runTimedStep } from '../../logger';
import type { prepareResume } from '../checkpoint-preparation';
import { restoreCensusCheckpoint } from '../checkpoint-resume';
import { DefaultGraphifyHintsBuilder, type GraphifyHints } from '../graphify-hints';
import { buildRepoCensus } from '../repo-census';

export async function runCensus(context: Awaited<ReturnType<typeof prepareResume>>) {
  const { options, dependencies, timings, emitProgress, beginStage } = context;
  await emitProgress({ activeStage: 'advanced/repo-census' });
  const resumedCensus = await restoreCensusCheckpoint(context);
  const census =
    resumedCensus ??
    (await runTimedStep(
      {
        logger: options.logger,
        label: 'advanced repo census',
        timings,
        detail: (result) =>
          `${result.summary.totalFiles} files, ${result.summary.totalDirectories} directories, ${result.signals.length} signals`,
      },
      async () => {
        await beginStage('repo-census');
        const result = await buildRepoCensus({
          repoRoot: options.workspace.targetRepoPath,
          repoUrl: options.repo,
          requestedRef: options.ref,
          repoRevision: options.workspace.repoRevision,
        });
        await writeWorkspaceJsonArtifact(options.workspace, 'analysis/repo-census.json', result);
        await emitProgress({
          advanced: {
            lastCompletedStage: 'repo-census',
          },
        });
        return result;
      },
    ));

  let graphifyHints: GraphifyHints | undefined;
  if ((options.graphifyHintsMode ?? 'auto') !== 'off') {
    await emitProgress({ activeStage: 'advanced/graphify-hints' });
    const graphifyBuilder = dependencies.graphifyHintsBuilder ?? new DefaultGraphifyHintsBuilder();
    graphifyHints = await runTimedStep(
      {
        logger: options.logger,
        label: 'advanced graphify hints',
        timings,
        detail: (result) =>
          result
            ? `${result.corpus.nodes} nodes, ${result.corpus.edges} edges, ${result.corpus.communities} communities`
            : 'not available',
      },
      async () =>
        graphifyBuilder.buildGraphifyHints({
          workspace: options.workspace,
          mode: options.graphifyHintsMode ?? 'auto',
          logger: options.logger,
        }),
    );
  }

  return { ...context, census, graphifyHints };
}
