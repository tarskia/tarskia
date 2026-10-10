import path from 'node:path';
import { throwIfCancelled } from './cancellation';
import { workerGit } from './git';
import { redactRepositoryError, redactRepositorySpecifier } from './repository-identity';
import type { DocumentInput } from './semantic';
import { type SourceRepositoryMetadata, summarizeSourceRepository } from './source-repository';
import {
  type PreparedWorkspace,
  type PrepareWorkspaceOptions,
  prepareWorkspace,
} from './workspace';

export interface RepositoryContext {
  workspace: PreparedWorkspace;
  primaryDocumentInput: DocumentInput;
  sourceRepository: SourceRepositoryMetadata | null;
}

export interface RepositoryService {
  prepareRepositoryContext(options: PrepareWorkspaceOptions): Promise<RepositoryContext>;
}

export class RepositoryServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'RepositoryServiceError';
  }
}

function isRemoteRepoSpecifier(value: string): boolean {
  return value.includes('://') || value.startsWith('git@');
}

function isLocalRepoSpecifier(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').trim();
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:\//.test(normalized)
  );
}

async function resolveDocumentInputRepo(repo: string): Promise<string> {
  if (isRemoteRepoSpecifier(repo)) {
    return redactRepositorySpecifier(repo);
  }

  const localRepoPath = path.resolve(repo);

  try {
    const git = workerGit(localRepoPath);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((remote) => remote.name === 'origin');
    const originUrl = origin?.refs.fetch || origin?.refs.push;
    if (originUrl && isRemoteRepoSpecifier(originUrl) && !isLocalRepoSpecifier(originUrl)) {
      return redactRepositorySpecifier(originUrl);
    }
  } catch {
    throwIfCancelled();
    // Fall through to a safe local identifier.
  }

  return `local:${path.basename(localRepoPath)}`;
}

async function buildPrimaryDocumentInput(
  options: PrepareWorkspaceOptions,
  workspace: PreparedWorkspace,
): Promise<DocumentInput> {
  return {
    id: 'primary',
    kind: 'git',
    repo: await resolveDocumentInputRepo(options.repo),
    ref: options.ref,
    revision: workspace.repoRevision,
    role: 'primary',
  };
}

function buildSourceRepositoryMetadata(
  options: PrepareWorkspaceOptions,
  workspace: PreparedWorkspace,
  primaryDocumentInput: DocumentInput,
): SourceRepositoryMetadata | null {
  return summarizeSourceRepository({
    repo: primaryDocumentInput.repo,
    ref: options.ref,
    commit: workspace.repoRevision,
    committedAt: workspace.repoCommittedAt,
  });
}

export class DefaultRepositoryService implements RepositoryService {
  async prepareRepositoryContext(options: PrepareWorkspaceOptions): Promise<RepositoryContext> {
    let workspace: PreparedWorkspace;
    try {
      workspace = await prepareWorkspace(options);
    } catch (error) {
      throwIfCancelled();
      throw new RepositoryServiceError(
        `Failed to prepare repository workspace for ${redactRepositorySpecifier(options.repo)}: ${redactRepositoryError(error, options.repo).message}`,
        {
          cause: redactRepositoryError(error, options.repo),
        },
      );
    }

    try {
      const primaryDocumentInput = await buildPrimaryDocumentInput(options, workspace);
      return {
        workspace,
        primaryDocumentInput,
        sourceRepository: buildSourceRepositoryMetadata(options, workspace, primaryDocumentInput),
      };
    } catch (error) {
      throwIfCancelled();
      throw new RepositoryServiceError(
        `Failed to resolve repository metadata for ${redactRepositorySpecifier(options.repo)}`,
        {
          cause: redactRepositoryError(error, options.repo),
        },
      );
    }
  }
}
