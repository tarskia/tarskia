import { combineRepoDiagrams, pickRepoDiagramFiles } from '@tarskia/diagram-semantics';
import { type DiagramComparison, isCurrentComparison } from './diagram-comparison';

export const comparePaths = (diagramPath: string, name: string) => {
  const directory = diagramPath.slice(0, diagramPath.lastIndexOf('/') + 1);
  return [
    `${directory}.job/compare/${name}.base.yaml`,
    `${directory}.job/compare/${name}.json`,
  ] as const;
};

export async function readRepoComparison(
  name: string,
  files: { path: string; raw: string }[],
): Promise<DiagramComparison | undefined> {
  const byPath = new Map(files.map((file) => [file.path, file.raw]));
  const repos = pickRepoDiagramFiles([...byPath.keys()]);
  const before = [];
  const after = [];
  const baseCommits: string[] = [];
  for (const repo of repos) {
    const raw = byPath.get(repo.diagramPath)!;
    const [basePath, metadataPath] = comparePaths(repo.diagramPath, repo.name);
    const baseRaw = byPath.get(basePath);
    const metadata = byPath.get(metadataPath);
    const baseCommit =
      baseRaw !== undefined && metadata !== undefined
        ? await isCurrentComparison(raw, metadata)
        : undefined;
    after.push({ name: repo.name, raw });
    before.push({ name: repo.name, raw: baseCommit ? baseRaw! : raw });
    if (baseCommit) baseCommits.push(baseCommit);
  }
  if (!baseCommits.length) return;
  const beforeResult = combineRepoDiagrams({ name, diagrams: before });
  const afterResult = combineRepoDiagrams({ name, diagrams: after });
  if (!beforeResult.doc || !afterResult.doc)
    throw new Error(
      `The diagrams in ${name} couldn't be combined: ${[...beforeResult.diagnostics, ...afterResult.diagnostics].find((diagnostic) => diagnostic.severity === 'error')?.message ?? 'Invalid comparison'}`,
    );
  return { before: beforeResult.doc, after: afterResult.doc, baseCommits };
}
