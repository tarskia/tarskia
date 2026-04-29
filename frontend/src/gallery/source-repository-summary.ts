import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';

type GallerySourceRepository = DtoGalleryDiagramSummaryResponse['sourceRepository'];

function trimToUndefined(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatCommittedAt(committedAt: string): string {
  const parsed = new Date(committedAt);
  if (Number.isNaN(parsed.getTime())) {
    return committedAt;
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatCommit(commit: string): string {
  return commit.length > 7 ? commit.slice(0, 7) : commit;
}

function formatRepositoryLabel(candidate: string | undefined): string | undefined {
  const value = trimToUndefined(candidate);
  if (!value || value.startsWith('local:')) {
    return undefined;
  }

  const scpLikeMatch = value.match(/^(?:ssh:\/\/)?git@(?<host>[^/:]+)[:/](?<repoPath>.+?)(?:\/)?$/);
  if (scpLikeMatch?.groups) {
    return `${scpLikeMatch.groups.host}/${scpLikeMatch.groups.repoPath.replace(/\/+$/, '').replace(/\.git$/i, '')}`;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')}`;
  } catch {
    return undefined;
  }
}

export function describeSourceRepository(sourceRepository: GallerySourceRepository): {
  href?: string;
  label?: string;
  facts: string[];
} | null {
  if (!sourceRepository) {
    return null;
  }

  const href = trimToUndefined(sourceRepository.url);
  const label =
    formatRepositoryLabel(href) || formatRepositoryLabel(sourceRepository.repo) || undefined;
  const facts: string[] = [];

  const committedAt = trimToUndefined(sourceRepository.committedAt);
  if (committedAt) {
    facts.push(`Updated ${formatCommittedAt(committedAt)}`);
  }

  const commit = trimToUndefined(sourceRepository.commit);
  if (commit) {
    facts.push(formatCommit(commit));
  }

  if (!label && !href && facts.length === 0) {
    return null;
  }

  return {
    href,
    label,
    facts,
  };
}
