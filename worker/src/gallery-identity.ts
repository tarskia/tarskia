import path from 'node:path';

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '');
}

export function slugifyKebab(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveRepoName(repo: string): string {
  const trimmed = repo.trim();
  let remotePath: string | undefined;
  if (trimmed.includes('://')) {
    const url = new URL(trimmed);
    if (url.protocol !== 'file:') remotePath = url.pathname;
    else return stripGitSuffix(path.basename(path.resolve(decodeURIComponent(url.pathname))));
  } else {
    const scp = trimmed.match(/^(?:[^/@:]+@)?[^/:]+:(.+)$/);
    if (scp) remotePath = scp[1];
  }
  if (remotePath !== undefined) {
    const segments = remotePath.split(/[?#]/, 1)[0].split('/').filter(Boolean);
    return stripGitSuffix(decodeURIComponent(segments[1] ?? segments[0] ?? ''));
  }
  return stripGitSuffix(path.basename(path.resolve(trimmed)));
}
