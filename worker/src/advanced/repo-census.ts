import { promises as fs } from 'node:fs';
import path from 'node:path';
import { throwIfCancelled } from '../cancellation';
import { redactRepositorySpecifier } from '../repository-identity';
import type {
  RepoCensus,
  RepoCensusDirectorySummary,
  RepoCensusFileEntry,
  RepoCensusManifest,
  RepoCensusSignal,
} from './types';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.nuxt',
  '.svelte-kit',
  '__pycache__',
  '.venv',
  '.idea',
  '.vscode',
]);

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.cjs', 'javascript'],
  ['.cts', 'typescript'],
  ['.css', 'css'],
  ['.go', 'go'],
  ['.graphql', 'graphql'],
  ['.hcl', 'hcl'],
  ['.html', 'html'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.json', 'json'],
  ['.jsx', 'jsx'],
  ['.kt', 'kotlin'],
  ['.md', 'markdown'],
  ['.mjs', 'javascript'],
  ['.mts', 'typescript'],
  ['.php', 'php'],
  ['.proto', 'proto'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.scss', 'scss'],
  ['.sh', 'shell'],
  ['.sql', 'sql'],
  ['.svg', 'svg'],
  ['.swift', 'swift'],
  ['.tf', 'terraform'],
  ['.toml', 'toml'],
  ['.ts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.vue', 'vue'],
  ['.xml', 'xml'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.zig', 'zig'],
]);

const MANIFEST_KINDS = new Map<string, string>([
  ['Cargo.toml', 'rust-package'],
  ['Chart.yaml', 'helm-chart'],
  ['compose.yaml', 'docker-compose'],
  ['compose.yml', 'docker-compose'],
  ['docker-compose.yaml', 'docker-compose'],
  ['docker-compose.yml', 'docker-compose'],
  ['Dockerfile', 'dockerfile'],
  ['fly.toml', 'fly-app'],
  ['go.mod', 'go-module'],
  ['kustomization.yaml', 'kustomize'],
  ['kustomization.yml', 'kustomize'],
  ['lerna.json', 'lerna-workspace'],
  ['Makefile', 'makefile'],
  ['nx.json', 'nx-workspace'],
  ['package.json', 'node-package'],
  ['pnpm-workspace.yaml', 'pnpm-workspace'],
  ['Procfile', 'procfile'],
  ['pyproject.toml', 'python-package'],
  ['render.yaml', 'render-blueprint'],
  ['render.yml', 'render-blueprint'],
  ['Taskfile.yaml', 'taskfile'],
  ['Taskfile.yml', 'taskfile'],
  ['terraform.tf', 'terraform'],
  ['turbo.json', 'turbo-workspace'],
  ['vite.config.ts', 'vite-config'],
  ['vitest.config.ts', 'vitest-config'],
]);

function detectLanguage(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (fileName === 'Dockerfile') {
    return 'dockerfile';
  }
  return LANGUAGE_BY_EXTENSION.get(extension) ?? 'other';
}

function normalizeRelativePath(repoRoot: string, targetPath: string): string {
  const relative = path.relative(repoRoot, targetPath);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

// LF bytes are exactly the separators used by UTF-8 decoding followed by
// split(/\r?\n/), including invalid UTF-8 and CRLF spanning read boundaries.
async function measureFile(
  filePath: string,
  buffer: Buffer,
): Promise<{ byteCount: number; lineCount: number }> {
  throwIfCancelled();
  const file = await fs.open(filePath, 'r');
  let byteCount = 0;
  let newlines = 0;
  try {
    while (true) {
      throwIfCancelled();
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      byteCount += bytesRead;
      for (let i = 0; i < bytesRead; i++) if (buffer[i] === 10) newlines++;
    }
  } finally {
    await file.close();
  }
  return { byteCount, lineCount: byteCount === 0 ? 0 : newlines + 1 };
}

function sortRecordDescending(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    }),
  );
}

function getTopLevelDirectory(relativePath: string): string {
  if (relativePath === '.') {
    return '.';
  }
  const [topLevel] = relativePath.split('/');
  return topLevel || '.';
}

function addLanguageCount(
  record: Record<string, number>,
  language: string,
  lineCount: number,
): void {
  record[language] = (record[language] ?? 0) + lineCount;
}

function buildSignals(
  files: RepoCensusFileEntry[],
  manifests: RepoCensusManifest[],
): RepoCensusSignal[] {
  const signals: RepoCensusSignal[] = [];

  for (const manifest of manifests) {
    if (manifest.kind === 'pnpm-workspace' || manifest.kind === 'turbo-workspace') {
      signals.push({
        path: manifest.path,
        kind: 'monorepo-root',
        confidence: 'high',
        reason: `${manifest.kind} manifest present`,
      });
    }
    if (
      manifest.kind === 'dockerfile' ||
      manifest.kind === 'docker-compose' ||
      manifest.kind === 'render-blueprint' ||
      manifest.kind === 'fly-app' ||
      manifest.kind === 'helm-chart' ||
      manifest.kind === 'kustomize' ||
      manifest.kind === 'terraform'
    ) {
      signals.push({
        path: manifest.path,
        kind: 'infra-surface',
        confidence: 'high',
        reason: `${manifest.kind} manifest present`,
      });
    }
  }

  for (const file of files) {
    if (file.path.startsWith('cmd/') || file.path.endsWith('/main.go') || file.path === 'main.go') {
      signals.push({
        path: file.path,
        kind: 'backend-entrypoint',
        confidence: 'medium',
        reason: 'Go main entrypoint heuristic matched',
      });
    }
    if (
      file.fileName === 'server.ts' ||
      file.fileName === 'server.js' ||
      file.fileName === 'main.ts' ||
      file.fileName === 'main.js'
    ) {
      signals.push({
        path: file.path,
        kind: 'runtime-entrypoint',
        confidence: 'medium',
        reason: 'Common runtime entrypoint filename matched',
      });
    }
    if (/(^|\/)(pages|app|routes)\//.test(file.path)) {
      signals.push({
        path: file.path,
        kind: 'route-surface',
        confidence: 'medium',
        reason: 'Common route directory heuristic matched',
      });
    }
    if (/(^|\/)(migrations|db\/migrations)\//.test(file.path)) {
      signals.push({
        path: file.path,
        kind: 'database-surface',
        confidence: 'medium',
        reason: 'Migration directory heuristic matched',
      });
    }
    if (/(^|\/)(workers?|jobs?|queues?)\//.test(file.path)) {
      signals.push({
        path: file.path,
        kind: 'async-runtime-surface',
        confidence: 'medium',
        reason: 'Worker/job directory heuristic matched',
      });
    }
  }

  return signals.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.path.localeCompare(right.path);
  });
}

export interface BuildRepoCensusOptions {
  repoRoot: string;
  repoUrl: string;
  requestedRef?: string;
  repoRevision: string;
}

export async function buildRepoCensus(options: BuildRepoCensusOptions): Promise<RepoCensus> {
  const { repoRoot, repoUrl, requestedRef, repoRevision } = options;
  const files: RepoCensusFileEntry[] = [];
  const directories = new Map<string, RepoCensusDirectorySummary>();
  const manifests: RepoCensusManifest[] = [];
  const languageTotals: Record<string, number> = {};

  function ensureDirectorySummary(relativeDirPath: string) {
    const existing = directories.get(relativeDirPath);
    if (existing) {
      return existing;
    }

    const created: RepoCensusDirectorySummary = {
      path: relativeDirPath,
      fileCount: 0,
      lineCount: 0,
      languages: {},
    };
    directories.set(relativeDirPath, created);
    return created;
  }

  const filePaths: string[] = [];
  async function walk(currentPath: string): Promise<void> {
    throwIfCancelled();
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      throwIfCancelled();
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        const relativeDirPath = normalizeRelativePath(repoRoot, entryPath);
        ensureDirectorySummary(relativeDirPath);
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      filePaths.push(entryPath);
    }
  }

  ensureDirectorySummary('.');
  await walk(repoRoot);

  // Fixed worker count bounds open files and content memory; output aggregation
  // follows the original traversal order regardless of read completion order.
  const measurements: Array<{ byteCount: number; lineCount: number }> = new Array(filePaths.length);
  let nextIndex = 0;
  const readers = Array.from({ length: Math.min(8, filePaths.length) }, async () => {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (nextIndex < filePaths.length) {
      throwIfCancelled();
      const index = nextIndex++;
      measurements[index] = await measureFile(filePaths[index], buffer);
    }
  });
  const results = await Promise.allSettled(readers);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  for (const [index, entryPath] of filePaths.entries()) {
    const relativeFilePath = normalizeRelativePath(repoRoot, entryPath);
    const directory = path.posix.dirname(relativeFilePath);
    const normalizedDirectory = directory === '.' ? '.' : directory;
    const { byteCount, lineCount } = measurements[index];
    const language = detectLanguage(path.basename(entryPath));
    const extension = path.extname(path.basename(entryPath)).toLowerCase() || null;

    files.push({
      path: relativeFilePath,
      directory: normalizedDirectory,
      fileName: path.basename(entryPath),
      extension,
      language,
      lineCount,
      byteCount,
    });

    addLanguageCount(languageTotals, language, lineCount);

    const manifestKind = MANIFEST_KINDS.get(path.basename(entryPath));
    if (manifestKind) {
      manifests.push({
        path: relativeFilePath,
        kind: manifestKind,
      });
    }

    const ancestry = normalizedDirectory === '.' ? ['.'] : normalizedDirectory.split('/');
    const directoryPaths = ['.'];
    let currentRelativeDir = '.';
    for (const segment of ancestry) {
      if (segment === '.') {
        continue;
      }
      currentRelativeDir =
        currentRelativeDir === '.' ? segment : `${currentRelativeDir}/${segment}`;
      ensureDirectorySummary(currentRelativeDir);
      directoryPaths.push(currentRelativeDir);
    }

    for (const relativeDirPath of directoryPaths) {
      const summary = ensureDirectorySummary(relativeDirPath);
      summary.fileCount += 1;
      summary.lineCount += lineCount;
      addLanguageCount(summary.languages, language, lineCount);
    }
  }

  const sortedDirectories = Array.from(directories.values())
    .map((summary) => ({
      ...summary,
      languages: sortRecordDescending(summary.languages),
    }))
    .sort((left, right) => {
      if (left.path === '.') {
        return -1;
      }
      if (right.path === '.') {
        return 1;
      }
      return left.path.localeCompare(right.path);
    });

  const topLevelMap = new Map<string, RepoCensusDirectorySummary>();
  for (const file of files) {
    const topLevelPath = getTopLevelDirectory(file.path);
    const summary = topLevelMap.get(topLevelPath) ?? {
      path: topLevelPath,
      fileCount: 0,
      lineCount: 0,
      languages: {},
    };
    summary.fileCount += 1;
    summary.lineCount += file.lineCount;
    addLanguageCount(summary.languages, file.language, file.lineCount);
    topLevelMap.set(topLevelPath, summary);
  }

  const topLevelPaths = Array.from(topLevelMap.values())
    .map((summary) => ({
      ...summary,
      languages: sortRecordDescending(summary.languages),
    }))
    .sort((left, right) => {
      if (right.lineCount !== left.lineCount) {
        return right.lineCount - left.lineCount;
      }
      return left.path.localeCompare(right.path);
    });

  const sortedFiles = files.sort((left, right) => left.path.localeCompare(right.path));
  const sortedManifests = manifests.sort((left, right) => left.path.localeCompare(right.path));
  const signals = buildSignals(sortedFiles, sortedManifests);

  return {
    repoUrl: redactRepositorySpecifier(repoUrl),
    requestedRef,
    repoRevision,
    repoRoot,
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: sortedFiles.length,
      totalDirectories: sortedDirectories.length,
      totalLines: sortedFiles.reduce((sum, file) => sum + file.lineCount, 0),
      languages: sortRecordDescending(languageTotals),
      topLevelPaths,
    },
    directories: sortedDirectories,
    manifests: sortedManifests,
    signals,
    files: sortedFiles,
  };
}
