import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentCancellationSignal, throwIfCancelled } from './cancellation';
import { resolveBundledSchemaRevision } from './default-assets';
import { workerGit, workerGitTimeoutMs } from './git';
import { ensureJobRoot } from './job-root';
import type { Logger } from './logger';
import {
  redactLegacyRepositoryArtifacts,
  redactRepositoryError,
  redactRepositorySpecifier,
  redactRepositoryText,
} from './repository-identity';
import {
  type BuildSecrets,
  maskRepository,
  SECRET_LINT_VERSION,
  type SecretsReporter,
} from './secret-masking';
import { writeFileAtomic } from './write-file-atomic';

const COPY_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);
const WORKER_EXCLUDED_SCHEMA_IDS = new Set(['core/data-model']);
const isYamlFile = (filePath: string) => /\.(ya?ml)$/i.test(filePath);

export interface PrepareWorkspaceOptions {
  repo: string;
  ref?: string;
  schemaSource: string;
  jobRoot?: string;
  hardRefresh?: boolean;
  logger?: Logger;
  onSecrets?: SecretsReporter;
  resume?: {
    expectedRepoRevision?: string | null;
    expectedSchemaSourceRevision?: string | null;
    allowMissingTargetRepo?: boolean;
    requiredArtifactPaths?: string[];
  };
}

function getErrorField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

function summarizeWorkspaceError(error: unknown, depth = 0): string {
  if (depth > 3) {
    return '[nested error omitted]';
  }

  if (error instanceof AggregateError) {
    const nested = error.errors
      .map(
        (nestedError, index) => `${index + 1}. ${summarizeWorkspaceError(nestedError, depth + 1)}`,
      )
      .join('; ');
    return `${error.name}: ${error.message}${nested ? ` (${nested})` : ''}`;
  }

  if (error instanceof Error) {
    const details: string[] = [`${error.name}: ${error.message}`];
    for (const field of ['code', 'errno', 'syscall', 'path', 'dest', 'command']) {
      const value = getErrorField(error, field);
      if (value !== undefined && value !== null && value !== '') {
        details.push(`${field}=${String(value)}`);
      }
    }
    const cause = getErrorField(error, 'cause');
    if (cause) {
      details.push(`cause=${summarizeWorkspaceError(cause, depth + 1)}`);
    }
    return details.join(' ');
  }

  return String(error);
}

async function logWorkspaceStep<T>(
  logger: Logger | undefined,
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  logger?.info(`Workspace prep: starting ${label}`);
  try {
    const result = await action();
    logger?.info(`Workspace prep: completed ${label} in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    throwIfCancelled();
    logger?.error(
      `Workspace prep: failed ${label} after ${Date.now() - startedAt}ms: ${redactRepositoryText(summarizeWorkspaceError(error))}`,
    );
    throw error;
  }
}

interface SanitizedRepositoryMarker {
  revision: string;
  committedAt?: string;
  secretlintVersion: string;
  maskedFiles: number;
  maskedSecrets: number;
  files: Array<{ path: string; rules: string[] }>;
}

async function readSanitizedRepositoryMarker(
  jobRoot: string,
  targetRepoPath: string,
): Promise<SanitizedRepositoryMarker | undefined> {
  try {
    const markerPath = path.join(jobRoot, 'target-repo.json');
    if (!(await fs.lstat(targetRepoPath)).isDirectory() || !(await fs.lstat(markerPath)).isFile())
      return;
    if (
      await fs.lstat(path.join(targetRepoPath, '.git')).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      )
    )
      return;
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    if (
      !marker ||
      typeof marker !== 'object' ||
      typeof marker.revision !== 'string' ||
      !/^[a-f0-9]{40,64}$/i.test(marker.revision) ||
      (marker.committedAt !== undefined && typeof marker.committedAt !== 'string') ||
      marker.secretlintVersion !== SECRET_LINT_VERSION ||
      !Number.isSafeInteger(marker.maskedFiles) ||
      marker.maskedFiles < 0 ||
      !Number.isSafeInteger(marker.maskedSecrets) ||
      marker.maskedSecrets < 0 ||
      !Array.isArray(marker.files) ||
      marker.files.length !== marker.maskedFiles ||
      !marker.files.every((file: unknown) => {
        if (!file || typeof file !== 'object') return false;
        const entry = file as Record<string, unknown>;
        return (
          typeof entry.path === 'string' &&
          entry.path.length > 0 &&
          !path.isAbsolute(entry.path) &&
          !entry.path.split(/[\\/]/).includes('..') &&
          Array.isArray(entry.rules) &&
          entry.rules.every((rule: unknown) => typeof rule === 'string')
        );
      })
    )
      return;
    return marker;
  } catch (error) {
    throwIfCancelled();
    return undefined;
  }
}

export interface PreparedWorkspace {
  secrets?: BuildSecrets;
  /** False after rebuilding the clone: old analysis artifacts must not be reused. */
  analysisReusable?: boolean;
  jobRoot: string;
  targetRepoPath: string;
  schemaRepoPath: string;
  workspaceOutputDir: string;
  repoRevision: string;
  repoCommittedAt?: string;
  schemaSourceRevision?: string;
}

async function resolveGitRevision(repoPath: string): Promise<string | undefined> {
  try {
    const git = workerGit(repoPath);
    const revision = await git.revparse(['HEAD']);
    return revision.trim();
  } catch {
    throwIfCancelled();
    return undefined;
  }
}

async function resolveSchemaSourceRevision(source: string): Promise<string | undefined> {
  const revision =
    (await resolveBundledSchemaRevision(source)) ?? (await resolveGitRevision(source));
  if (revision) return revision;
  const digest = createHash('sha256');
  for (const file of (await collectYamlFiles(source)).sort()) {
    digest
      .update(path.relative(source, file))
      .update('\0')
      .update(await fs.readFile(file))
      .update('\0');
  }
  return `content:${digest.digest('hex')}`;
}

async function warnAboutDirtyLocalInput(
  repo: string,
  jobRoot: string,
  revision: string,
  logger?: Logger,
): Promise<void> {
  if (!logger) return;
  let localPath: string;
  try {
    localPath = repo.trim().startsWith('file:') ? fileURLToPath(repo.trim()) : path.resolve(repo);
    if (!(await fs.stat(localPath)).isDirectory()) return;
  } catch {
    return;
  }
  try {
    const excluded = path.relative(localPath, jobRoot).split(path.sep).join('/');
    const paths = ['.'];
    if (excluded && excluded !== '..' && !excluded.startsWith('../') && !path.isAbsolute(excluded))
      paths.push(`:(exclude,literal)${excluded}`);
    const status = await workerGit(localPath).raw([
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      ...paths,
    ]);
    if (status.trim())
      logger.warn(
        `Building from commit ${revision.slice(0, 12)}; uncommitted changes in ${localPath} are not included.`,
      );
  } catch {
    throwIfCancelled();
    // Bare repositories have no working tree; preparation reports actual Git errors.
  }
}

async function resolveGitCommittedAt(repoPath: string): Promise<string | undefined> {
  try {
    const git = workerGit(repoPath);
    const committedAt = await git.show(['-s', '--format=%cI', 'HEAD']);
    const trimmed = committedAt.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    throwIfCancelled();
    return undefined;
  }
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch {
    throwIfCancelled();
    return false;
  }
}

async function collectYamlFiles(rootPath: string): Promise<string[]> {
  const preferredSchemaDir = path.join(rootPath, 'src', 'schemas');
  const searchRoot = (await pathExists(preferredSchemaDir)) ? preferredSchemaDir : rootPath;
  const results: string[] = [];

  const visit = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') {
        if (entry.isDirectory()) continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (COPY_SKIP_DIRS.has(entry.name)) continue;
        await visit(entryPath);
        continue;
      }
      if (isYamlFile(entryPath)) {
        results.push(entryPath);
      }
    }
  };

  if (await pathExists(searchRoot)) {
    await visit(searchRoot);
  }
  return results;
}

function extractSchemaId(raw: string): string | undefined {
  const idMatch = raw.match(/^\s*id:\s*["']?([^"'#\n]+)["']?\s*$/m)?.[1]?.trim();
  if (idMatch) {
    return idMatch.replace(/@\S+$/, '');
  }

  const owner = raw.match(/^\s*owner:\s*["']?([^"'#\n]+)["']?\s*$/m)?.[1]?.trim();
  const name = raw.match(/^\s*name:\s*["']?([^"'#\n]+)["']?\s*$/m)?.[1]?.trim();
  if (owner && name) {
    return `${owner}/${name}`;
  }

  return undefined;
}

async function pruneExcludedSchemas(schemaRepoPath: string): Promise<void> {
  const schemaFiles = await collectYamlFiles(schemaRepoPath);
  await Promise.all(
    schemaFiles.map(async (schemaFile) => {
      const raw = await fs.readFile(schemaFile, 'utf8');
      const schemaId = extractSchemaId(raw);
      if (!schemaId || !WORKER_EXCLUDED_SCHEMA_IDS.has(schemaId)) {
        return;
      }
      await fs.rm(schemaFile, { force: true });
    }),
  );
}

async function tryReusePreparedWorkspace(params: {
  onSecrets?: SecretsReporter;
  jobRoot: string;
  targetRepoPath: string;
  schemaRepoPath: string;
  workspaceOutputDir: string;
  schemaSource: string;
  expectedRepoRevision?: string | null;
  expectedSchemaSourceRevision?: string | null;
}): Promise<PreparedWorkspace | undefined> {
  const {
    jobRoot,
    targetRepoPath,
    schemaRepoPath,
    workspaceOutputDir,
    schemaSource,
    expectedRepoRevision,
    expectedSchemaSourceRevision,
  } = params;

  const [hasTargetRepo, hasSchemaRepo] = await Promise.all([
    pathExists(targetRepoPath),
    pathExists(schemaRepoPath),
  ]);
  if (!hasTargetRepo || !hasSchemaRepo) {
    return undefined;
  }

  const marker = await readSanitizedRepositoryMarker(jobRoot, targetRepoPath);
  if (!marker) return;
  const { revision: repoRevision, committedAt: repoCommittedAt } = marker;
  params.onSecrets?.({
    maskedInRepo: marker.maskedSecrets,
    files: marker.files,
    redactedFromOutput: 0,
  });
  const schemaSourceRevision = await resolveSchemaSourceRevision(schemaSource);

  if (expectedRepoRevision && repoRevision !== expectedRepoRevision) {
    return undefined;
  }

  const normalizedExpectedSchemaRevision = expectedSchemaSourceRevision ?? null;
  const normalizedCurrentSchemaRevision = schemaSourceRevision ?? null;
  if (
    expectedSchemaSourceRevision !== undefined &&
    normalizedCurrentSchemaRevision !== normalizedExpectedSchemaRevision
  ) {
    // The clone is already sanitized. Refresh only schemas; checkpoint input
    // fingerprints invalidate dependent stages without discarding the census.
    await fs.rm(schemaRepoPath, { recursive: true, force: true });
    await copySchemaSource(schemaSource, schemaRepoPath);
  }

  await fs.mkdir(workspaceOutputDir, { recursive: true });
  return {
    jobRoot,
    targetRepoPath,
    schemaRepoPath,
    workspaceOutputDir,
    repoRevision,
    repoCommittedAt,
    schemaSourceRevision,
    analysisReusable: true,
    secrets: { maskedInRepo: marker.maskedSecrets, files: marker.files, redactedFromOutput: 0 },
  };
}

async function copySchemaSource(
  sourcePath: string,
  destinationPath: string,
  logger?: Logger,
): Promise<void> {
  const absoluteSourcePath = path.resolve(sourcePath);
  await logWorkspaceStep(
    logger,
    `schema source copy ${absoluteSourcePath} -> ${destinationPath}`,
    async () => {
      await fs.cp(absoluteSourcePath, destinationPath, {
        recursive: true,
        filter: (entrySource) => {
          const basename = path.basename(entrySource);
          if (COPY_SKIP_DIRS.has(basename)) {
            return false;
          }
          return true;
        },
      });
      await pruneExcludedSchemas(destinationPath);
    },
  );
}

function normalizeSshClonePath(pathname: string): string | undefined {
  const repoPath = pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (!repoPath || repoPath.split('/').filter(Boolean).length < 2) {
    return undefined;
  }
  return `${repoPath}.git`;
}

const SSH_FALLBACK_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

export function buildSshCloneFallbackUrl(repo: string): string | undefined {
  const trimmedRepo = repo.trim();
  if (!trimmedRepo) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmedRepo);
    if (parsed.protocol !== 'https:' || !SSH_FALLBACK_HOSTS.has(parsed.hostname)) {
      return undefined;
    }

    const repoPath = normalizeSshClonePath(parsed.pathname);
    if (!repoPath) {
      return undefined;
    }

    return `git@${parsed.hostname}:${repoPath}`;
  } catch {
    throwIfCancelled();
    return undefined;
  }
}

function isHttpsAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\r?\n/)
    .some((line) =>
      /^fatal: (?:Authentication failed(?: for |$)|could not read (?:Username|Password) for .+: (?:terminal prompts disabled|No such device or address)$|unable to access .+: The requested URL returned error: 401$)/i.test(
        line,
      ),
    );
}

function gitPreparationError(error: unknown, repo: string, operation: string): Error {
  if (getErrorField(error, 'plugin') === 'timeout') {
    return new Error(
      `Git ${operation} timed out after ${workerGitTimeoutMs()}ms for ${redactRepositorySpecifier(repo)}`,
    );
  }
  return redactRepositoryError(error, repo);
}

function assertNotGitOption(value: string, label: string): void {
  if (value.trim().startsWith('-')) {
    throw new Error(
      `Invalid ${label} "${redactRepositorySpecifier(value)}": values starting with "-" can be interpreted as git options. Prefix local paths with ./ or use a full URL.`,
    );
  }
}

function assertSafeGitSpecifier(value: string, label: string): void {
  const trimmed = value.trim();
  assertNotGitOption(trimmed, label);
  if (/[\0\r\n]/.test(trimmed)) {
    throw new Error(
      `Invalid ${label} "${redactRepositorySpecifier(value)}": git specifiers must not contain control characters.`,
    );
  }
  if (/^ext::/i.test(trimmed)) {
    throw new Error(
      `Invalid ${label} "${redactRepositorySpecifier(value)}": the git remote-ext protocol is not supported.`,
    );
  }

  try {
    const parsed = new URL(trimmed);
    if (!['file:', 'git:', 'http:', 'https:', 'ssh:'].includes(parsed.protocol)) {
      throw new Error(
        `Invalid ${label} "${redactRepositorySpecifier(value)}": unsupported git URL protocol ${parsed.protocol}`,
      );
    }
    return;
  } catch (error) {
    throwIfCancelled();
    if (error instanceof Error && error.message.includes('unsupported git URL protocol')) {
      throw error;
    }
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) && !trimmed.startsWith('git@')) {
    throw new Error(
      `Invalid ${label} "${redactRepositorySpecifier(value)}": unsupported git URL protocol`,
    );
  }
}

async function redactCheckoutRemotes(repoPath: string): Promise<void> {
  const git = workerGit(repoPath);
  for (const remote of await git.getRemotes(true)) {
    for (const [kind, url] of Object.entries(remote.refs)) {
      const safe = redactRepositorySpecifier(url);
      if (safe !== url) {
        await git.raw([
          'remote',
          'set-url',
          ...(kind === 'push' ? ['--push'] : []),
          '--',
          remote.name,
          safe,
        ]);
      }
    }
  }
}

async function cloneTargetRepo(params: {
  repo: string;
  ref?: string;
  destinationPath: string;
  logger?: Logger;
}): Promise<string> {
  const { repo, ref, destinationPath, logger } = params;
  assertSafeGitSpecifier(repo, 'repo');
  if (ref) {
    assertNotGitOption(ref, 'ref');
  }
  try {
    const git = workerGit();
    const cloneAttemptUrls = [repo];
    const cloneErrors: unknown[] = [];

    for (const cloneUrl of cloneAttemptUrls) {
      try {
        logger?.info(
          `Workspace prep: cloning ${redactRepositorySpecifier(cloneUrl)} -> ${destinationPath}`,
        );
        await git.clone(cloneUrl, destinationPath);
        logger?.info(`Workspace prep: cloned ${redactRepositorySpecifier(cloneUrl)}`);
        cloneErrors.length = 0;
        break;
      } catch (error) {
        throwIfCancelled();
        const safeError = gitPreparationError(error, repo, 'clone');
        logger?.error(
          `Workspace prep: clone failed for ${redactRepositorySpecifier(cloneUrl)}: ${redactRepositoryText(summarizeWorkspaceError(safeError), repo)}`,
        );
        cloneErrors.push(safeError);
        if (cloneAttemptUrls.length === 1 && isHttpsAuthenticationError(error)) {
          const fallback = buildSshCloneFallbackUrl(repo);
          if (fallback) cloneAttemptUrls.push(fallback);
        }
        await fs.rm(destinationPath, { recursive: true, force: true });
      }
    }

    if (cloneErrors.length > 0) {
      const suggestion =
        /^https?:\/\//i.test(repo.trim()) && !buildSshCloneFallbackUrl(repo)
          ? ' To use SSH authentication, pass an explicit SSH repository URL.'
          : '';
      throw new AggregateError(
        cloneErrors,
        `Failed to clone ${redactRepositorySpecifier(repo)}: ${cloneErrors.map((error) => (error as Error).message).join('; ')}${suggestion}`,
      );
    }

    const checkoutGit = workerGit(destinationPath);
    let revision: string | undefined;
    let failure: Error | undefined;
    try {
      if (ref) {
        await logWorkspaceStep(logger, `checkout ref ${ref}`, async () => {
          try {
            await checkoutGit.fetch(['--all', '--tags']);
            await checkoutGit.checkout(ref);
          } catch (error) {
            throwIfCancelled();
            throw gitPreparationError(error, repo, 'fetch/checkout');
          }
        });
      }
      revision = (await checkoutGit.revparse(['HEAD'])).trim();
      logger?.info(`Workspace prep: target repo HEAD ${revision}`);
    } catch (error) {
      throwIfCancelled();
      failure = redactRepositoryError(error, repo);
    }
    try {
      await redactCheckoutRemotes(destinationPath);
    } catch (error) {
      throwIfCancelled();
      // A checkout with unsanitized credentials must never become an agent workspace.
      await fs.rm(destinationPath, { recursive: true, force: true });
      throw redactRepositoryError(error, repo);
    }
    if (failure) throw failure;
    if (!revision) throw new Error('Git did not report a target revision');
    return revision;
  } catch (error) {
    if (currentCancellationSignal()?.aborted) {
      // Authentication may already have written a credential-bearing remote. Never
      // leave that checkout behind when Git itself can no longer run cleanup.
      await fs.rm(destinationPath, { recursive: true, force: true });
      throwIfCancelled();
    }
    throw error;
  }
}

export async function prepareWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<PreparedWorkspace> {
  const { logger } = options;
  const jobRoot =
    options.jobRoot?.trim() && options.jobRoot.trim().length > 0
      ? path.resolve(options.jobRoot)
      : await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-worker-'));

  await ensureJobRoot(jobRoot);
  await redactLegacyRepositoryArtifacts(jobRoot);

  const targetRepoPath = path.join(jobRoot, 'target-repo');
  const schemaRepoPath = path.join(jobRoot, 'schema-repo');
  const workspaceOutputDir = path.join(jobRoot, 'out');
  logger?.info(
    `Workspace prep: jobRoot=${jobRoot} targetRepoPath=${targetRepoPath} schemaRepoPath=${schemaRepoPath} outputDir=${workspaceOutputDir} hardRefresh=${Boolean(options.hardRefresh)}`,
  );

  if (!options.hardRefresh && options.resume) {
    logger?.info('Workspace prep: checking resumable workspace');
    const reusedWorkspace = await tryReusePreparedWorkspace({
      onSecrets: options.onSecrets,
      jobRoot,
      targetRepoPath,
      schemaRepoPath,
      workspaceOutputDir,
      schemaSource: options.schemaSource,
      expectedRepoRevision: options.resume.expectedRepoRevision,
      expectedSchemaSourceRevision: options.resume.expectedSchemaSourceRevision,
    });
    if (reusedWorkspace) {
      logger?.info(`Workspace prep: reusing prepared workspace at ${jobRoot}`);
      await warnAboutDirtyLocalInput(options.repo, jobRoot, reusedWorkspace.repoRevision, logger);
      return reusedWorkspace;
    }
  }

  await logWorkspaceStep(logger, 'workspace cleanup', async () => {
    await Promise.all([
      fs.rm(targetRepoPath, { recursive: true, force: true }),
      fs.rm(schemaRepoPath, { recursive: true, force: true }),
      fs.rm(workspaceOutputDir, { recursive: true, force: true }),
      fs.rm(path.join(jobRoot, 'target-repo.json'), { force: true }),
    ]);
    await fs.mkdir(workspaceOutputDir, { recursive: true });
  });

  const preparation = await Promise.allSettled([
    logWorkspaceStep(logger, 'target repo preparation', async () => {
      const repoRevision = await cloneTargetRepo({
        repo: options.repo,
        ref: options.ref,
        destinationPath: targetRepoPath,
        logger,
      });
      const repoCommittedAt = await resolveGitCommittedAt(targetRepoPath);
      await fs.rm(path.join(targetRepoPath, '.git'), { recursive: true, force: true });
      const masked = await maskRepository(targetRepoPath, logger, (progress, unmasked) => {
        options.onSecrets?.(
          {
            maskedInRepo: progress.maskedSecrets,
            files: progress.files,
            redactedFromOutput: 0,
          },
          unmasked,
        );
      });
      options.onSecrets?.({
        maskedInRepo: masked.maskedSecrets,
        files: masked.files,
        redactedFromOutput: 0,
      });
      throwIfCancelled();
      const marker: SanitizedRepositoryMarker = {
        revision: repoRevision,
        committedAt: repoCommittedAt,
        secretlintVersion: SECRET_LINT_VERSION,
        ...masked,
      };
      await writeFileAtomic(
        path.join(jobRoot, 'target-repo.json'),
        JSON.stringify(marker, null, 2) + '\n',
      );
      return { repoRevision, repoCommittedAt, masked };
    }),
    logWorkspaceStep(logger, 'schema repo preparation', async () => {
      await copySchemaSource(options.schemaSource, schemaRepoPath, logger);
      return resolveSchemaSourceRevision(options.schemaSource);
    }),
  ]);

  // Do not release the job lock while sibling preparation is still writing.
  const [repoResult, schemaResult] = preparation;
  if (repoResult.status === 'rejected') throw repoResult.reason;
  if (schemaResult.status === 'rejected') throw schemaResult.reason;
  throwIfCancelled();
  const repoInfo = repoResult.value;
  const schemaSourceRevision = schemaResult.value;
  await warnAboutDirtyLocalInput(options.repo, jobRoot, repoInfo.repoRevision, logger);

  return {
    jobRoot,
    targetRepoPath,
    schemaRepoPath,
    workspaceOutputDir,
    repoRevision: repoInfo.repoRevision,
    repoCommittedAt: repoInfo.repoCommittedAt,
    schemaSourceRevision,
    analysisReusable: false,
    secrets: {
      maskedInRepo: repoInfo.masked.maskedSecrets,
      files: repoInfo.masked.files,
      redactedFromOutput: 0,
    },
  };
}
