import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getSchemaModuleRef,
  pickRepoDiagramFiles,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
} from '@tarskia/diagram-semantics';
import { execFileCancellable } from './cancellable-command';
import { throwIfCancelled } from './cancellation';
import { ConfigError } from './cli-errors';
import { CodexDiagramEvolver, type DiagramEvolver } from './codex/diagram-evolver';
import {
  buildDiagramPromptPackage,
  renderSharedDiagramPromptGuidance,
} from './codex/prompt-package';
import { UsageAccounting, withUsageAccounting } from './codex/usage-accounting';
import { resolveDefaultSchemaSource } from './default-assets';
import { assertAdditiveSchema, completeEvolveCandidate } from './evolve-candidate';
import { validateGeneratedSchemaCandidate } from './generated-schema';
import { workerGit, workerGitEnv, workerGitTimeoutMs } from './git';
import { acquireJobLock } from './job-lock';
import { defaultLogger, type Logger } from './logger';
import type { ReasoningEffort } from './reasoning-effort';
import { runRepairableStage } from './run-repairable-stage';
import { parseDocument, parseSchema, serializeDocument } from './semantic';
import { buildDiagramSynthesisContract } from './semantic/diagram-synthesis-contract';
import { loadSchemaRegistry, validateDiagramYaml } from './semantic/schema-loader';
import { writeFileAtomic } from './write-file-atomic';

const NO_DIAGRAM =
  'No committed diagram in .tarskia/. Run tarskia build, then commit its output there.';
const NO_CHANGES = 'Nothing to evolve: no code changes since the diagram was last updated.';

export interface EvolveDiagramOptions {
  cwd?: string;
  ref?: string;
  diagram?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  schemaSource?: string;
  logger?: Logger;
  evolver?: DiagramEvolver;
}

export async function evolveDiagram(options: EvolveDiagramOptions = {}) {
  const logger = options.logger ?? defaultLogger();
  const cwd = await fs.realpath(options.cwd ?? process.cwd());
  const root = (await workerGit(cwd).revparse(['--show-toplevel'])).trim();
  const git = workerGit(root);
  const head = (await git.revparse(['HEAD'])).trim();
  const revision = (
    await git.raw([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${options.ref ?? 'HEAD'}^{commit}`,
    ])
  ).trim();
  const files = (await git.raw(['ls-tree', '-r', '--name-only', '-z', head, '--', '.tarskia/']))
    .split('\0')
    .filter(Boolean);
  const diagrams = pickRepoDiagramFiles(files);
  const requested = options.diagram
    ? path.relative(root, path.resolve(cwd, options.diagram)).split(path.sep).join('/')
    : undefined;
  const selected = requested
    ? diagrams.find((item) => item.diagramPath === requested)
    : diagrams.length === 1
      ? diagrams[0]
      : undefined;
  if (!diagrams.length || (requested && !selected)) throw new ConfigError(NO_DIAGRAM);
  if (!selected)
    throw new ConfigError(
      'More than one committed diagram in .tarskia/. Select one with --diagram <path>.',
    );
  const diagramPath = selected.diagramPath;
  const schemaPath = `.tarskia/${selected.name}.schema.yaml`;
  const baseCommit = (await git.raw(['log', '-1', '--format=%H', head, '--', diagramPath])).trim();
  if (!baseCommit) throw new ConfigError(NO_DIAGRAM);
  const codeDiff = await git.raw([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    baseCommit,
    revision,
    '--',
    '.',
    ':(exclude).tarskia',
  ]);
  const status = await git.raw([
    'status',
    '--porcelain',
    '--untracked-files=normal',
    '--',
    '.',
    ':(exclude).tarskia',
  ]);
  if (status.trim())
    logger.warn(
      'Uncommitted changes outside .tarskia/ are ignored; evolve uses committed code only.',
    );
  if (!codeDiff.trim()) {
    logger.info(NO_CHANGES);
    return {
      status: 'unchanged' as const,
      message: NO_CHANGES,
      outputPath: path.join(root, diagramPath),
      baseCommit,
      revision,
    };
  }

  const jobRoot = path.join(root, '.tarskia', '.job');
  const release = await acquireJobLock(jobRoot, (message) => logger.warn(message));
  const metadataPath = path.join(jobRoot, 'evolve.json');
  const accounting = new UsageAccounting(undefined, (state) =>
    writeFileAtomic(path.join(jobRoot, 'evolve-usage.json'), JSON.stringify(state, null, 2)),
  );
  try {
    const baseYaml = await git.show([`${baseCommit}:${diagramPath}`]);
    const base = parseDocument(baseYaml);
    const baseFiles = (
      await git.raw(['ls-tree', '-r', '--name-only', '-z', baseCommit, '--', '.tarskia/'])
    ).split('\0');
    const baseSchemaYaml = baseFiles.includes(schemaPath)
      ? await git.show([`${baseCommit}:${schemaPath}`])
      : undefined;
    const baseSchema = baseSchemaYaml ? parseSchema(baseSchemaYaml) : undefined;
    const workspaceRoot = path.join(jobRoot, 'workspace');
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    const repoPath = path.join(workspaceRoot, 'repo');
    const inputPath = path.join(workspaceRoot, 'input');
    const schemaRoot = path.join(workspaceRoot, 'schemas');
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(inputPath, { recursive: true });
    await writeFileAtomic(path.join(workspaceRoot, '.tarskia-evolve-root'), '');
    await fs.cp(options.schemaSource ?? resolveDefaultSchemaSource(), schemaRoot, {
      recursive: true,
    });
    const archive = path.join(jobRoot, 'repo.tar');
    await git.raw([
      'archive',
      '--format=tar',
      `--output=${archive}`,
      revision,
      '--',
      '.',
      ':(exclude).tarskia',
    ]);
    try {
      await execFileCancellable('tar', ['-xf', archive, '-C', repoPath], {
        env: workerGitEnv(),
        timeout: workerGitTimeoutMs(),
      });
    } finally {
      await fs.rm(archive, { force: true });
    }
    const registry = await loadSchemaRegistry(schemaRoot);
    if (baseSchema) registry.modulesById.set(getSchemaModuleRef(baseSchema), baseSchema);
    const prompt = buildDiagramPromptPackage(buildDiagramSynthesisContract(registry));
    await writeFileAtomic(path.join(inputPath, 'base.yaml'), baseYaml);
    if (baseSchemaYaml)
      await writeFileAtomic(path.join(inputPath, 'base.schema.yaml'), baseSchemaYaml);
    await writeFileAtomic(path.join(inputPath, 'code.diff'), codeDiff);
    await writeFileAtomic(
      path.join(inputPath, 'contract.md'),
      renderSharedDiagramPromptGuidance(prompt),
    );
    await writeFileAtomic(path.join(inputPath, 'schema-catalog.json'), prompt.schemaCatalogJson);

    let compareCommit: string;
    try {
      compareCommit = (await git.raw(['merge-base', 'origin/HEAD', head])).trim();
    } catch {
      compareCommit = (await git.raw(['merge-base', 'origin/main', head])).trim();
    }
    const compareYaml = await git.show([`${compareCommit}:${diagramPath}`]);
    const evolver = options.evolver ?? new CodexDiagramEvolver(options);
    let previousResponse: string | undefined;
    let diagnostics: string[] = [];
    let threadId: string | null = null;
    let candidateFailed = false;
    const result = await withUsageAccounting(accounting, () =>
      runRepairableStage({
        maxAttempts: 4,
        retryError: () => candidateFailed,
        afterRetryableError: async (error) => {
          throwIfCancelled();
          diagnostics = [error instanceof Error ? error.message : String(error)];
        },
        attempt: async (attempt) => {
          throwIfCancelled();
          candidateFailed = false;
          logger.info(`${attempt === 1 ? 'Evolving' : 'Repairing'} diagram (attempt ${attempt}).`);
          const turn = await evolver.evolve({
            workspaceRoot,
            hasRepoSchema: Boolean(baseSchema),
            diagnostics,
            previousResponse,
          });
          threadId = turn.threadId;
          previousResponse = turn.response;
          await writeFileAtomic(path.join(jobRoot, 'evolve-candidate.json'), turn.response);
          candidateFailed = true;
          const candidate = completeEvolveCandidate(base, turn.response);
          let schemaYaml = baseSchemaYaml;
          let addedTypes: string[] = [];
          const candidateRegistry = { ...registry, modulesById: new Map(registry.modulesById) };
          if (candidate.schema != null) {
            if (!baseSchema)
              throw new Error(
                `No repo schema exists; new types cannot be added. Use the available core types. Candidate entity types: ${candidate.diff.entities.flatMap((entry) => entry.after?.type ?? []).join(', ') || '(none)'}.`,
              );
            const proposed = parseSchema(candidate.schema);
            assertAdditiveSchema(baseSchema, proposed);
            const validation = await validateGeneratedSchemaCandidate({
              rawSchema: candidate.schema,
              schemaRegistryRoot: schemaRoot,
              schemaId: `repo/${baseSchema.name}`,
            });
            if (!validation.ok)
              throw new Error(validation.diagnostics.map((item) => item.message).join('\n'));
            const nextSchema = parseSchema(validation.rawSchema);
            addedTypes = assertAdditiveSchema(baseSchema, nextSchema);
            schemaYaml = validation.rawSchema;
            candidateRegistry.modulesById.set(getSchemaModuleRef(nextSchema), nextSchema);
          }
          const primaryInput =
            candidate.document.inputs?.find((input) => input.role === 'primary') ??
            candidate.document.inputs?.find((input) => input.kind === 'git');
          const document = {
            ...candidate.document,
            inputs: candidate.document.inputs?.map((input) =>
              input.id === primaryInput?.id ? { ...input, revision } : input,
            ),
          };
          const yaml = serializeDocument(document);
          for (const checkedYaml of [baseYaml, yaml]) {
            const validation = validateDiagramYaml({
              yaml: checkedYaml,
              schemaRegistry: candidateRegistry,
              validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
            });
            if (!validation.ok)
              throw new Error(
                validation.diagnostics
                  .filter((item) => item.severity === 'error')
                  .map((item) => item.message)
                  .join('\n'),
              );
          }
          return { yaml, schemaYaml, addedTypes, candidate, repaired: attempt > 1 };
        },
      }),
    );
    throwIfCancelled();
    const changedOutput = await git.raw([
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      diagramPath,
      schemaPath,
    ]);
    if (changedOutput.trim())
      logger.warn(
        'Replacing uncommitted diagram/schema changes with evolution from the committed base.',
      );
    const count = result.candidate.diff.entities.length;
    const entityCount = (() => {
      let n = 0;
      const visit = (items: typeof base.entities) => {
        for (const item of items) {
          n++;
          visit(item.children ?? []);
        }
      };
      visit(base.entities);
      return n;
    })();
    if (count > entityCount / 2)
      logger.warn(
        'The diff touches more than half the entities. Consider a manual rebuild if the architecture has drifted.',
      );
    const outputPath = path.join(root, diagramPath);
    const schemaOutputPath = result.schemaYaml ? path.join(root, schemaPath) : undefined;
    const compareDir = path.join(jobRoot, 'compare');
    await fs.mkdir(compareDir, { recursive: true });
    const comparePath = path.join(compareDir, `${selected.name}.base.yaml`);
    await writeFileAtomic(comparePath, compareYaml);
    await writeFileAtomic(
      path.join(compareDir, `${selected.name}.json`),
      JSON.stringify(
        {
          baseCommit: compareCommit,
          afterSha256: createHash('sha256').update(result.yaml, 'utf8').digest('hex'),
        },
        null,
        2,
      ),
    );
    await writeFileAtomic(path.join(jobRoot, 'diagram.diff.yaml'), result.candidate.rawDiff);
    if (schemaOutputPath && result.schemaYaml)
      await writeFileAtomic(schemaOutputPath, result.schemaYaml);
    await writeFileAtomic(outputPath, result.yaml);
    const summary = {
      status: 'succeeded' as const,
      outputPath,
      schemaOutputPath,
      workspaceRoot: jobRoot,
      comparePath,
      baseCommit,
      revision,
      compareCommit,
      threadId,
      repaired: result.repaired,
      addedTypes: result.addedTypes,
      tokenUsage: accounting.snapshot().totals,
    };
    await writeFileAtomic(metadataPath, JSON.stringify(summary, null, 2));
    logger.info(`Compare ${comparePath} with ${outputPath}`);
    if (result.addedTypes.length)
      logger.info(`Added schema types: ${result.addedTypes.join(', ')}`);
    return summary;
  } catch (error) {
    await writeFileAtomic(
      metadataPath,
      JSON.stringify(
        {
          status: 'failed',
          baseCommit,
          revision,
          tokenUsage: accounting.snapshot().totals,
          message: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await release();
  }
}
