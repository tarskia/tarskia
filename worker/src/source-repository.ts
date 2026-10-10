import { redactRepositorySpecifier } from './repository-identity';
export interface SourceRepositoryMetadata {
  repo: string;
  url?: string;
  ref?: string;
  commit: string;
  committedAt?: string;
}

function trimToUndefined(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRepoPath(pathname: string): string {
  return pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
}

export function normalizeRepositoryBrowseUrl(repo: string): string | undefined {
  const trimmedRepo = trimToUndefined(repo);
  if (!trimmedRepo || trimmedRepo.startsWith('local:')) {
    return undefined;
  }

  const scpLikeMatch = trimmedRepo.match(/^git@(?<host>[^/:]+)[:/](?<repoPath>.+?)(?:\/)?$/);
  if (scpLikeMatch?.groups) {
    const repoPath = normalizeRepoPath(scpLikeMatch.groups.repoPath);
    if (!repoPath) {
      return undefined;
    }
    return `https://${scpLikeMatch.groups.host}/${repoPath}`;
  }

  try {
    const parsed = new URL(trimmedRepo);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const repoPath = normalizeRepoPath(parsed.pathname);
      if (!repoPath) {
        return undefined;
      }
      return `${parsed.origin}/${repoPath}`;
    }
    if (parsed.protocol === 'ssh:' && parsed.username === 'git') {
      const repoPath = normalizeRepoPath(parsed.pathname);
      if (!repoPath) {
        return undefined;
      }
      return `https://${parsed.hostname}/${repoPath}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function summarizeSourceRepository(params: {
  repo: string;
  ref?: string | null;
  commit?: string;
  committedAt?: string;
}): SourceRepositoryMetadata | null {
  const repo = trimToUndefined(redactRepositorySpecifier(params.repo));
  const commit = trimToUndefined(params.commit);
  if (!repo || !commit) {
    return null;
  }

  return {
    repo,
    url: normalizeRepositoryBrowseUrl(repo),
    ref: trimToUndefined(params.ref),
    commit,
    committedAt: trimToUndefined(params.committedAt),
  };
}
