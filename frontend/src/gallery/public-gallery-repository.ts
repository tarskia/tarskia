import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';

type GallerySourceRepository = DtoGalleryDiagramSummaryResponse['sourceRepository'];

function trimToUndefined(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatPublicGalleryCommit(commit: string | undefined): string | undefined {
  const value = trimToUndefined(commit);
  if (!value) {
    return undefined;
  }
  return value.length > 7 ? value.slice(0, 7) : value;
}

function extractRepositoryPath(
  candidate: string | undefined,
): { host: string; path: string } | null {
  const value = trimToUndefined(candidate);
  if (!value || value.startsWith('local:')) {
    return null;
  }

  const scpLikeMatch = value.match(/^(?:ssh:\/\/)?git@(?<host>[^/:]+)[:/](?<repoPath>.+?)(?:\/)?$/);
  if (scpLikeMatch?.groups) {
    return {
      host: scpLikeMatch.groups.host.toLowerCase(),
      path: scpLikeMatch.groups.repoPath.replace(/\/+$/, '').replace(/\.git$/i, ''),
    };
  }

  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname.toLowerCase(),
      path: parsed.pathname
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

export function describePublicGalleryRepository(params: {
  sourceRepository: GallerySourceRepository;
  namespace: string;
  slug: string;
}): {
  href?: string;
  label: string;
  searchText: string;
} {
  const href = trimToUndefined(params.sourceRepository?.url);
  const repoPath =
    extractRepositoryPath(href) || extractRepositoryPath(params.sourceRepository?.repo) || null;
  const label =
    repoPath?.host === 'github.com'
      ? repoPath.path
      : repoPath
        ? `${repoPath.host}/${repoPath.path}`
        : `${params.namespace}/${params.slug}`;
  const title = params.sourceRepository?.repo?.trim();
  const searchText = [label, title, href, `${params.namespace}/${params.slug}`]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
    .toLowerCase();

  return {
    href,
    label,
    searchText,
  };
}
