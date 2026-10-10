#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { version } from '../package.json';
import {
  ADVANCED_CHECKPOINT_STAGES,
  compareAdvancedCheckpointStage,
  normalizeBuildMode,
  parseAdvancedCheckpointStage,
} from './advanced/types';
import { BuildDiagramError, buildDiagram, derivePartialOutputPath } from './build-diagram';
import { installCancellationHandlers, withCancellation } from './cancellation';
import { ConfigError, UsageError } from './cli-errors';
import { resolveDefaultSchemaSource } from './default-assets';
import { deriveGeneratedSchemaId } from './generated-schema';
import { runValidateGeneratedSchemaCli } from './generated-schema-validator-cli';
import { workerGit } from './git';
import { deriveDefaultJobRoot, isCompatibleResumeMetadata, readJobMetadata } from './job-metadata';
import { runValidateNodeRefinementCli } from './node-refinement-validator-cli';
import { resolvePathOption } from './path-option';
import { REASONING_EFFORTS, resolveReasoningEffort } from './reasoning-effort';
import { redactRepositoryText } from './repository-identity';
import { runValidateSchemaSelectionCli } from './schema-selection-validator-cli';
import { emptyBuildSecrets, formatSecretsAlert, type UnmaskedSecrets } from './secret-masking';
import { checkSetup, runBuildWithPreflight, type SetupCheck } from './setup-preflight';
import { runValidateCli, type ValidateKind } from './validate-cli';

let lastBuildSecrets = emptyBuildSecrets();
let unmaskedSecrets: UnmaskedSecrets | undefined;

function printUsage(command?: string, json = false): void {
  const usage: Record<string, string[]> = {
    build: [
      `tarskia build <repo-path-or-git-url> --out <file> [--schema-out <file>] [--schema-id <repo/name>] [--schema-source <dir>] [--ref <git-ref>] [--model <model>] [--reasoning-effort <${REASONING_EFFORTS.join('|')}>] [--mode <basic|advanced>] [--graphify-hints <auto|off|required>] [--restart-from <stage>] [--stop-after <stage>] [--max-depth <n>] [--max-turns <n>] [--turn-timeout <minutes>] [--overwrite] [--fresh]`,
      '  --max-turns: optional invocation-wide limit, including repairs and retries; checkpoints to .partial.yaml.',
      '  --turn-timeout: per-turn minutes (0 disables); default 5 for minimal/low/medium, 15 high/xhigh, 30 max/ultra/persistent.',
      '  --repo <path-or-git-url> is an alternative to the positional repository.',
      `  --restart-from: ${ADVANCED_CHECKPOINT_STAGES.join(', ')}`,
      '  --stop-after: level0-backbone, level0-review (advanced mode only); writes <out>.partial.yaml and records a stopped job.',
      '  --overwrite replaces output files without discarding checkpoints; --fresh discards checkpoints and caches but does not imply --overwrite.',
      '  --restart-from requires an existing advanced job and allows replacing its output.',
    ],
    validate: [
      'tarskia validate <path> [--kind <auto|diagram|schema|schema-registry>] [--schema <file>...] [--schema-source <dir>] [--json] [--strict]',
    ],
    check: ['tarskia check'],
    internal: [
      'tarskia internal validate-generated-schema [--job-root <path>] --schema-id <repo/name>',
      'tarskia internal validate-node-refinement [--job-root <path>] --context <path>',
      'tarskia internal validate-schema-selection [--job-root <path>] --context <path>',
    ],
  };
  const text = `Usage:\n${(command && usage[command] ? usage[command] : [...usage.build, ...usage.validate, ...usage.check, 'tarskia --version']).join('\n')}\n`;
  process.stdout.write(json ? `${JSON.stringify({ usage: text })}\n` : text);
}

function parsePositiveInteger(value?: string): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertBuildOutputsAreSafe(params: {
  repo: string;
  ref?: string;
  mode: ReturnType<typeof normalizeBuildMode>;
  out: string;
  schemaSource: string;
  schemaOut?: string;
  schemaId?: string;
  overwrite?: boolean;
  fresh?: boolean;
  writeTarget?: string;
}): Promise<void> {
  if (params.overwrite) return;
  const existingTargets = (
    await Promise.all([
      pathExists(params.writeTarget ?? params.out).then((exists) =>
        exists ? (params.writeTarget ?? params.out) : undefined,
      ),
      params.schemaOut
        ? pathExists(params.schemaOut).then((exists) => (exists ? params.schemaOut : undefined))
        : undefined,
    ])
  ).filter((target): target is string => Boolean(target));
  if (existingTargets.length === 0) return;

  const jobRoot = deriveDefaultJobRoot(params.out);
  const metadata = await readJobMetadata(jobRoot);
  const compatibleResume =
    metadata?.status !== 'succeeded' &&
    isCompatibleResumeMetadata(metadata, {
      mode: params.mode,
      repo: params.repo,
      ref: params.ref,
      generateSchema: Boolean(params.schemaOut),
      schemaId: params.schemaId ?? null,
      schemaOutPath: params.schemaOut ?? null,
      schemaSource: params.schemaSource,
      outputPath: params.out,
    });
  if (compatibleResume && !params.fresh) return;

  throw new ConfigError(
    `Refusing to overwrite existing output${existingTargets.length === 1 ? '' : 's'} without --overwrite: ${existingTargets.join(
      ', ',
    )}`,
  );
}

async function runCheck(json = false): Promise<void> {
  const checks: SetupCheck[] = [];
  checks.push({
    name: 'node',
    ok: Number(process.versions.node.split('.')[0]) >= 22,
    detail: process.version,
  });
  try {
    const schemaSource = resolveDefaultSchemaSource();
    checks.push({ name: 'bundled schemas', ok: true, detail: schemaSource });
  } catch (error) {
    checks.push({
      name: 'bundled schemas',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  await new Promise<void>((resolve) => {
    workerGit()
      .raw(['--version'])
      .then((stdout) => {
        checks.push({ name: 'git', ok: true, detail: stdout.trim() });
        resolve();
      })
      .catch(() => {
        checks.push({ name: 'git', ok: false, detail: 'git not found or unavailable' });
        resolve();
      });
  });
  checks.push(...(await checkSetup()));
  if (json)
    process.stdout.write(
      `${JSON.stringify({ ok: checks.every((check) => check.ok || check.warning), checks })}\n`,
    );
  else
    for (const check of checks) {
      process.stdout.write(
        `${check.ok ? 'OK' : check.warning ? 'WARN' : 'FAIL'} ${check.name}: ${check.detail}\n`,
      );
    }
  if (checks.some((check) => !check.ok && !check.warning)) process.exitCode = 2;
}

async function runInternalCommand(
  command: string | undefined,
  values: ParsedValues,
): Promise<void> {
  if (command === 'validate-node-refinement') {
    const contextPath = values.context?.trim();
    if (!contextPath) {
      throw new UsageError('missing required --context');
    }
    await runValidateNodeRefinementCli({
      jobRoot: values['job-root']?.trim() || process.cwd(),
      contextPath,
    });
    return;
  }
  if (command === 'validate-schema-selection') {
    const contextPath = values.context?.trim();
    if (!contextPath) {
      throw new UsageError('missing required --context');
    }
    await runValidateSchemaSelectionCli({
      jobRoot: values['job-root']?.trim() || process.cwd(),
      contextPath,
    });
    return;
  }
  if (command === 'validate-generated-schema') {
    const schemaId = values['schema-id']?.trim();
    if (!schemaId) {
      throw new UsageError('missing required --schema-id');
    }
    await runValidateGeneratedSchemaCli({
      jobRoot: values['job-root']?.trim() || process.cwd(),
      schemaId,
    });
    return;
  }
  throw new UsageError(`unknown internal command '${command ?? ''}'`);
}

type ParsedValues = {
  repo?: string;
  ref?: string;
  'schema-source'?: string;
  schema?: string[];
  'schema-out'?: string;
  'schema-id'?: string;
  out?: string;
  model?: string;
  'reasoning-effort'?: string;
  mode?: string;
  'graphify-hints'?: string;
  overwrite?: boolean;
  fresh?: boolean;
  'restart-from'?: string;
  'stop-after'?: string;
  'max-depth'?: string;
  'max-turns'?: string;
  'turn-timeout'?: string;
  'job-root'?: string;
  context?: string;
  kind?: string;
  json?: boolean;
  strict?: boolean;
  help?: boolean;
  version?: boolean;
};

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        repo: { type: 'string' },
        ref: { type: 'string' },
        'schema-source': { type: 'string' },
        schema: { type: 'string', multiple: true },
        'schema-out': { type: 'string' },
        'schema-id': { type: 'string' },
        out: { type: 'string' },
        model: { type: 'string' },
        'reasoning-effort': { type: 'string' },
        mode: { type: 'string' },
        'graphify-hints': { type: 'string' },
        overwrite: { type: 'boolean' },
        fresh: { type: 'boolean' },
        'restart-from': { type: 'string' },
        'stop-after': { type: 'string' },
        'max-depth': { type: 'string' },
        'max-turns': { type: 'string' },
        'turn-timeout': { type: 'string' },
        'job-root': { type: 'string' },
        context: { type: 'string' },
        kind: { type: 'string' },
        json: { type: 'boolean' },
        strict: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = message.match(/Unknown option '([^']+)'/);
    throw new UsageError(unknown ? `unknown option '${unknown[1]}'` : message, { cause: error });
  }
  const { positionals, values } = parsed;
  const parsedValues = values as ParsedValues;

  const command = positionals[0];
  if (parsedValues.version) {
    process.stdout.write(parsedValues.json ? `${JSON.stringify({ version })}\n` : `${version}\n`);
    return;
  }
  if (parsedValues.help) {
    printUsage(command, parsedValues.json);
    return;
  }

  if (command === 'internal') {
    await runInternalCommand(positionals[1], parsedValues);
    return;
  }
  if (command === 'check') {
    await runCheck(parsedValues.json);
    return;
  }
  if (command === 'validate') {
    const targetPath = positionals[1];
    const kind = parsedValues.kind?.trim() as ValidateKind | undefined;
    if (!targetPath) throw new UsageError('missing validation path');
    if (kind && !['auto', 'diagram', 'schema', 'schema-registry'].includes(kind))
      throw new UsageError(
        `invalid --kind '${kind}' (expected auto, diagram, schema or schema-registry)`,
      );
    await runValidateCli({
      path: targetPath,
      kind,
      schemaSource: parsedValues['schema-source']?.trim() || undefined,
      schemas: parsedValues.schema,
      json: Boolean(parsedValues.json),
      strict: Boolean(parsedValues.strict),
    });
    return;
  }

  if (command !== 'build') {
    throw new UsageError(command ? `unknown command '${command}'` : 'missing command');
  }

  const repo = positionals[1]?.trim() || parsedValues.repo?.trim();
  const out = parsedValues.out?.trim();
  if (!repo || !out) {
    throw new UsageError(
      !repo ? 'missing repository (positional or --repo)' : 'missing required --out',
    );
  }
  const mode = parsedValues.mode?.trim();
  if (mode && mode !== 'simple' && mode !== 'basic' && mode !== 'advanced') {
    throw new UsageError(`invalid --mode '${mode}' (expected basic or advanced)`);
  }
  const normalizedMode = normalizeBuildMode(mode);
  const effort = parsedValues['reasoning-effort'];
  if (effort !== undefined && !REASONING_EFFORTS.includes(effort.trim() as never))
    throw new UsageError(
      `invalid --reasoning-effort '${effort}' (expected ${REASONING_EFFORTS.slice(0, -1).join(', ')} or ${REASONING_EFFORTS.at(-1)})`,
    );
  const reasoningEffort = resolveReasoningEffort(effort);
  const graphifyHintsMode = parsedValues['graphify-hints']?.trim();
  if (
    graphifyHintsMode &&
    graphifyHintsMode !== 'auto' &&
    graphifyHintsMode !== 'off' &&
    graphifyHintsMode !== 'required'
  ) {
    throw new UsageError(
      `invalid --graphify-hints '${graphifyHintsMode}' (expected auto, off or required)`,
    );
  }
  const restartFrom = parseAdvancedCheckpointStage(parsedValues['restart-from']);
  if (parsedValues['restart-from'] && !restartFrom) {
    throw new UsageError(
      `invalid --restart-from '${parsedValues['restart-from']}' (expected ${ADVANCED_CHECKPOINT_STAGES.join(', ')})`,
    );
  }
  if (restartFrom && parsedValues.fresh) {
    throw new UsageError('--fresh cannot be combined with --restart-from');
  }
  const stopAfter = parseAdvancedCheckpointStage(parsedValues['stop-after']);
  if (
    parsedValues['stop-after'] &&
    stopAfter !== 'level0-backbone' &&
    stopAfter !== 'level0-review'
  ) {
    throw new UsageError(
      `invalid --stop-after '${parsedValues['stop-after']}' (expected level0-backbone or level0-review)`,
    );
  }
  if (restartFrom && normalizedMode !== 'advanced') {
    throw new UsageError('--restart-from requires --mode advanced');
  }
  if (stopAfter && normalizedMode !== 'advanced') {
    throw new UsageError('--stop-after requires --mode advanced');
  }
  const maxTurns = parsePositiveInteger(parsedValues['max-turns']);
  if (parsedValues['max-turns'] !== undefined && (!maxTurns || !Number.isSafeInteger(maxTurns)))
    throw new UsageError('invalid --max-turns (expected a positive integer)');
  const turnTimeoutMinutes =
    parsedValues['turn-timeout'] === undefined ? undefined : Number(parsedValues['turn-timeout']);
  if (
    turnTimeoutMinutes !== undefined &&
    (!parsedValues['turn-timeout']?.trim() ||
      !Number.isFinite(turnTimeoutMinutes) ||
      turnTimeoutMinutes < 0)
  )
    throw new UsageError(
      'invalid --turn-timeout (expected non-negative minutes; 0 disables the timeout)',
    );
  const maxDepth = parsePositiveInteger(parsedValues['max-depth']);
  if (parsedValues['max-depth'] && !maxDepth) {
    throw new UsageError(
      `invalid --max-depth '${parsedValues['max-depth']}' (expected a positive integer)`,
    );
  }
  if (maxDepth && normalizedMode !== 'advanced') {
    throw new UsageError('--max-depth requires --mode advanced');
  }
  if (restartFrom && stopAfter && compareAdvancedCheckpointStage(stopAfter, restartFrom) < 0) {
    throw new UsageError('--stop-after must not precede --restart-from');
  }

  const schemaSource = parsedValues['schema-source']?.trim() || resolveDefaultSchemaSource();
  const resolvedOut = resolvePathOption(out, 'out');
  const schemaOut = parsedValues['schema-out']?.trim()
    ? resolvePathOption(parsedValues['schema-out'], 'schema-out')
    : undefined;
  const schemaId = schemaOut ? deriveGeneratedSchemaId(repo, parsedValues['schema-id']) : undefined;

  if (restartFrom) {
    const metadata = await readJobMetadata(deriveDefaultJobRoot(resolvedOut));
    if (
      !isCompatibleResumeMetadata(metadata, {
        mode: normalizedMode,
        repo,
        ref: parsedValues.ref?.trim() || undefined,
        generateSchema: Boolean(schemaOut),
        schemaId: schemaId ?? null,
        schemaOutPath: schemaOut ?? null,
        schemaSource,
        outputPath: resolvedOut,
      })
    ) {
      throw new UsageError(
        '--restart-from needs an existing advanced job for this repo and output; none was found.',
      );
    }
  }

  await assertBuildOutputsAreSafe({
    repo,
    ref: parsedValues.ref?.trim() || undefined,
    mode: normalizedMode,
    out: resolvedOut,
    schemaSource,
    schemaOut,
    schemaId,
    overwrite: Boolean(parsedValues.overwrite || restartFrom),
    fresh: Boolean(parsedValues.fresh),
    writeTarget: stopAfter ? derivePartialOutputPath(resolvedOut) : resolvedOut,
  });

  const result = await runBuildWithPreflight(
    { model: parsedValues.model?.trim(), reasoningEffort, graphifyHintsMode },
    () =>
      buildDiagram({
        onSecrets: (report, unmasked) => {
          lastBuildSecrets = report;
          unmaskedSecrets = unmasked;
        },
        repo,
        ref: parsedValues.ref?.trim() || undefined,
        schemaSource,
        out: resolvedOut,
        schemaOut,
        schemaId,
        model: parsedValues.model?.trim() || undefined,
        reasoningEffort,
        mode: normalizedMode,
        hardRefresh: parsedValues.fresh || undefined,
        restartFrom,
        stopAfter,
        nodeRefinementMaxDepth: maxDepth,
        maxTurns,
        turnTimeoutMinutes,
        graphifyHintsMode: graphifyHintsMode as 'auto' | 'off' | 'required' | undefined,
      }),
  );
  console.log(
    JSON.stringify(
      {
        outputPath: result.outputPath,
        schemaOutputPath: schemaOut,
        workspaceRoot: result.workspace.jobRoot,
        threadId: result.threadId,
        repaired: result.repaired,
        generatedSchema: result.generatedSchema,
        buildSummary: result.buildSummary,
        secrets: result.secrets,
      },
      null,
      2,
    ),
  );
}

const controller = new AbortController();
const cancellation = installCancellationHandlers(controller);
withCancellation(controller.signal, main)
  .catch((error: unknown) => {
    if (controller.signal.aborted) {
      const message = controller.signal.reason.message;
      process.stderr.write(`tarskia: ${message}\n`);
      if (process.argv.includes('--json'))
        process.stdout.write(
          `${JSON.stringify({ ok: false, error: { message }, ...(process.argv[2] === 'build' ? { secrets: lastBuildSecrets } : {}) })}\n`,
        );
      process.exitCode = cancellation.exitCode;
      return;
    }
    const command = ['build', 'validate', 'check', 'internal'].includes(process.argv[2])
      ? process.argv[2]
      : undefined;
    const repoFlag = process.argv.indexOf('--repo');
    const rawRepo =
      repoFlag >= 0
        ? process.argv[repoFlag + 1]
        : command === 'build' && !process.argv[3]?.startsWith('-')
          ? process.argv[3]
          : undefined;
    const errno = error as NodeJS.ErrnoException;
    const message = redactRepositoryText(
      errno?.code === 'ENOENT'
        ? `file not found: ${errno.path ?? 'unknown path'}`
        : error instanceof Error
          ? error.message
          : String(error),
      rawRepo,
    );
    const validation =
      error instanceof BuildDiagramError &&
      error.diagnostics.some((item) => item.severity === 'error');
    process.stderr.write(
      `tarskia: ${message}\nRun 'tarskia${command ? ` ${command}` : ''} --help' for usage.\n`,
    );
    if (process.env.TARSKIA_DEBUG === '1' && error instanceof Error)
      process.stderr.write(`${redactRepositoryText(error.stack ?? error.message, rawRepo)}\n`);
    if (process.argv.includes('--json'))
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: { message }, ...(process.argv[2] === 'build' ? { secrets: lastBuildSecrets } : {}) })}\n`,
      );
    process.exitCode = validation ? 1 : 2;
  })
  .finally(() => {
    cancellation.dispose();
    process.stderr.write(formatSecretsAlert(lastBuildSecrets, unmaskedSecrets));
  });
