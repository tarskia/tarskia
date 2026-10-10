import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../artifacts';
import { execFileCancellable } from '../cancellable-command';
import { currentCancellationSignal, throwIfCancelled } from '../cancellation';
import type { Logger } from '../logger';
import type { PreparedWorkspace } from '../workspace';

export type GraphifyHintsMode = 'auto' | 'off' | 'required';

export interface GraphifyNodeHint {
  id: string;
  label: string;
  degree?: number;
  sourceFile?: string | null;
  sourceLocation?: string | null;
  community?: number | null;
}

export interface GraphifyCommunityHint {
  id: number;
  size: number;
  cohesion?: number | null;
  representativeNodes: GraphifyNodeHint[];
  sourceFiles: string[];
  relationTypes: string[];
}

export interface GraphifyRelationHint {
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | string;
  confidenceScore?: number | null;
  sourceFile?: string | null;
  sourceLocation?: string | null;
}

export interface GraphifyHints {
  version: 1;
  status: 'available';
  mode: 'code-only';
  generatedAt: string;
  graphifyPackage: string;
  corpus: {
    codeFiles: number;
    nodes: number;
    edges: number;
    communities: number;
    extractedEdges: number;
    inferredEdges: number;
    ambiguousEdges: number;
  };
  centralNodes: GraphifyNodeHint[];
  communities: GraphifyCommunityHint[];
  bridgeNodes: GraphifyNodeHint[];
  extractedRelations: GraphifyRelationHint[];
  inferredRelations: GraphifyRelationHint[];
  warnings: string[];
  artifacts: {
    graphJson: string;
    extractionJson: string;
    reportMarkdown: string;
    summaryMarkdown: string;
  };
  summaryMarkdown?: string;
}

export interface GraphifyHintsBuilderInput {
  workspace: PreparedWorkspace;
  mode: GraphifyHintsMode;
  logger: Logger;
}

export interface GraphifyHintsBuilder {
  buildGraphifyHints(input: GraphifyHintsBuilderInput): Promise<GraphifyHints | undefined>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface GraphifyCommandRunner {
  execFile(
    file: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      maxBuffer?: number;
      timeout?: number;
      signal?: AbortSignal;
    },
  ): Promise<CommandResult>;
}

export class GraphifyHintsError extends Error {
  constructor(
    message: string,
    readonly failureArtifactPath?: string,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'GraphifyHintsError';
  }
}

const GRAPHIFY_DIR_ARTIFACT = 'analysis/graphify';
const GRAPHIFY_SCRIPT_ARTIFACT = `${GRAPHIFY_DIR_ARTIFACT}/build-graphify-hints.py`;
const GRAPHIFY_SUMMARY_JSON_ARTIFACT = 'analysis/graphify-hints.json';
const GRAPHIFY_SUMMARY_MD_ARTIFACT = 'analysis/graphify-hints.md';
const GRAPHIFY_FAILURE_ARTIFACT = 'analysis/graphify-hints.failure.json';

class DefaultCommandRunner implements GraphifyCommandRunner {
  async execFile(
    file: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      maxBuffer?: number;
      timeout?: number;
      signal?: AbortSignal;
    },
  ): Promise<CommandResult> {
    const result = await execFileCancellable(file, args, {
      signal: options.signal,
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildGraphifySubprocessEnv(): NodeJS.ProcessEnv {
  const allowedKeys = [
    'HOME',
    'PATH',
    'REQUESTS_CA_BUNDLE',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'UV_CACHE_DIR',
    'UV_PYTHON',
    'UV_PYTHON_INSTALL_DIR',
    'WINDIR',
  ];
  return Object.fromEntries(
    allowedKeys.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

async function readExistingGraphifyHints(workspace: PreparedWorkspace): Promise<GraphifyHints> {
  const raw = await fs.readFile(
    path.join(workspace.workspaceOutputDir, GRAPHIFY_SUMMARY_JSON_ARTIFACT),
    'utf8',
  );
  const markdown = await fs.readFile(
    path.join(workspace.workspaceOutputDir, GRAPHIFY_SUMMARY_MD_ARTIFACT),
    'utf8',
  );
  return normalizeGraphifyHints(JSON.parse(raw), markdown);
}

function normalizeGraphifyHints(value: unknown, markdown: string): GraphifyHints {
  if (!value || typeof value !== 'object') {
    throw new Error('Graphify hints artifact is not an object');
  }
  const record = value as Partial<GraphifyHints>;
  if (record.version !== 1 || record.status !== 'available' || record.mode !== 'code-only') {
    throw new Error('Graphify hints artifact has an unsupported shape');
  }
  if (!record.corpus || typeof record.corpus.nodes !== 'number') {
    throw new Error('Graphify hints artifact is missing corpus statistics');
  }
  return {
    ...record,
    summaryMarkdown: markdown,
  } as GraphifyHints;
}

export class DefaultGraphifyHintsBuilder implements GraphifyHintsBuilder {
  private readonly commandRunner: GraphifyCommandRunner;

  constructor(dependencies: { commandRunner?: GraphifyCommandRunner } = {}) {
    this.commandRunner = dependencies.commandRunner ?? new DefaultCommandRunner();
  }

  async buildGraphifyHints(input: GraphifyHintsBuilderInput): Promise<GraphifyHints | undefined> {
    throwIfCancelled();
    if (input.mode === 'off') {
      return undefined;
    }

    try {
      const existing = await readExistingGraphifyHints(input.workspace);
      input.logger.info(
        `Reusing Graphify hints artifact (${existing.corpus.nodes} nodes, ${existing.corpus.edges} edges)`,
      );
      return existing;
    } catch (error) {
      throwIfCancelled();
      input.logger.info(`Graphify hints artifact unavailable or invalid: ${summarizeError(error)}`);
    }

    const fail = async (status: 'skipped' | 'failed', message: string, error?: unknown) => {
      const failureArtifactPath = await writeWorkspaceJsonArtifact(
        input.workspace,
        GRAPHIFY_FAILURE_ARTIFACT,
        {
          version: 1,
          status,
          mode: 'code-only',
          generatedAt: new Date().toISOString(),
          message,
          error: error ? summarizeError(error) : undefined,
        },
      );
      if (input.mode === 'required') {
        throw new GraphifyHintsError(message, failureArtifactPath, { cause: error });
      }
      input.logger.warn(message);
      return undefined;
    };

    try {
      await this.commandRunner.execFile('uv', ['--version'], {
        signal: currentCancellationSignal(),
        cwd: input.workspace.jobRoot,
        env: buildGraphifySubprocessEnv(),
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      });
    } catch (error) {
      throwIfCancelled();
      return fail(
        'skipped',
        'Graphify hints skipped because the uv executable is unavailable',
        error,
      );
    }

    try {
      const scriptPath = await writeWorkspaceArtifact(
        input.workspace,
        GRAPHIFY_SCRIPT_ARTIFACT,
        await fs.readFile(new URL('./build-graphify-hints.py', import.meta.url), 'utf8'),
      );
      await writeWorkspaceArtifact(
        input.workspace,
        `${GRAPHIFY_SCRIPT_ARTIFACT}.lock`,
        await fs.readFile(new URL('./build-graphify-hints.py.lock', import.meta.url), 'utf8'),
      );
      const graphifyOutDir = path.join(input.workspace.workspaceOutputDir, GRAPHIFY_DIR_ARTIFACT);
      const summaryJsonPath = path.join(
        input.workspace.workspaceOutputDir,
        GRAPHIFY_SUMMARY_JSON_ARTIFACT,
      );
      const summaryMarkdownPath = path.join(
        input.workspace.workspaceOutputDir,
        GRAPHIFY_SUMMARY_MD_ARTIFACT,
      );
      const result = await this.commandRunner.execFile(
        'uv',
        [
          'run',
          '--no-config',
          '--isolated',
          '--locked',
          '--no-build',
          '--script',
          scriptPath,
          '--repo-root',
          input.workspace.targetRepoPath,
          '--out-dir',
          graphifyOutDir,
          '--summary-json',
          summaryJsonPath,
          '--summary-md',
          summaryMarkdownPath,
        ],
        {
          signal: currentCancellationSignal(),
          cwd: input.workspace.jobRoot,
          env: buildGraphifySubprocessEnv(),
          maxBuffer: 20 * 1024 * 1024,
          timeout: 10 * 60_000,
        },
      );
      if (result.stderr.trim().length > 0) {
        input.logger.info(`Graphify hints stderr: ${result.stderr.trim()}`);
      }
      const hints = await readExistingGraphifyHints(input.workspace);
      input.logger.info(
        `Generated Graphify hints (${hints.corpus.nodes} nodes, ${hints.corpus.edges} edges, ${hints.corpus.communities} communities)`,
      );
      return hints;
    } catch (error) {
      throwIfCancelled();
      return fail('failed', `Graphify hints generation failed: ${summarizeError(error)}`, error);
    }
  }
}

export function getGraphifyHintsSummaryArtifactPath(): string {
  return GRAPHIFY_SUMMARY_MD_ARTIFACT;
}
