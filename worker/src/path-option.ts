import path from 'node:path';

const MACOS_ABSOLUTE_ROOTS = new Set([
  'Applications',
  'Library',
  'System',
  'Users',
  'Volumes',
  'bin',
  'cores',
  'dev',
  'etc',
  'opt',
  'private',
  'sbin',
  'tmp',
  'usr',
  'var',
]);

function normalizePathOption(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

export function looksLikeMissingLeadingSlashPath(value: string): boolean {
  const normalized = normalizePathOption(value);
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('~/') ||
    normalized.includes('://') ||
    normalized.startsWith('git@') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return false;
  }

  const [rootSegment] = normalized.split('/');
  return rootSegment !== undefined && MACOS_ABSOLUTE_ROOTS.has(rootSegment);
}

export function resolvePathOption(value: string, label: string): string {
  if (looksLikeMissingLeadingSlashPath(value)) {
    throw new Error(
      `Invalid ${label} path "${value}": looks like an absolute path missing its leading slash.`,
    );
  }
  return path.resolve(value);
}
