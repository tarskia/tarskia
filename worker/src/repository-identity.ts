import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './write-file-atomic';

/** Repository identity for artifacts and logs. SSH usernames are transport identities. */
export function redactRepositorySpecifier(repo: string): string {
  return repo
    .trim()
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i, (_match, scheme: string, authority: string) => {
      const at = authority.lastIndexOf('@');
      if (at < 0) return scheme + authority;
      const userinfo = authority.slice(0, at);
      const host = authority.slice(at + 1);
      if (scheme.toLowerCase() === 'ssh://') {
        const username = userinfo.split(':', 1)[0];
        return `${scheme}${username ? `${username}@` : ''}${host}`;
      }
      return scheme + host;
    });
}

export function redactRepositoryText(text: string, originalRepo?: string): string {
  // Decode structured artifacts before scanning strings, so JSON escaping cannot
  // hide userinfo and a neighboring JSON field cannot become part of a URL.
  if (/^[\s]*[[{"]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      const visit = (value: unknown): unknown => {
        if (typeof value === 'string') return redactRepositoryText(value, originalRepo);
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === 'object') {
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, visit(entry)]),
          );
        }
        return value;
      };
      const safeValue = visit(parsed);
      if (JSON.stringify(safeValue) === JSON.stringify(parsed)) return text;
      return JSON.stringify(safeValue, null, 2);
    } catch {
      /* Plain prompt/log text uses the URL scanner below. */
    }
  }
  let safe = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>\\]+/gi, redactRepositorySpecifier);
  if (originalRepo) {
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(originalRepo.trim())?.[1];
    const at = authority?.lastIndexOf('@') ?? -1;
    if (authority && at >= 0) {
      for (const part of authority.slice(0, at).split(':')) {
        let decoded = part;
        try {
          decoded = decodeURIComponent(part);
        } catch {
          /* Keep encoded input. */
        }
        for (const secret of new Set([part, decoded])) {
          if (secret && secret !== 'git') safe = safe.split(secret).join('[redacted]');
        }
      }
    }
  }
  return safe;
}

/** Rebuild errors so Git task fields and stacks cannot retain the raw clone command. */
export function redactRepositoryError(error: unknown, repo: string): Error {
  const message = redactRepositoryText(
    error instanceof Error ? error.message : String(error),
    repo,
  );
  if (error instanceof AggregateError) {
    return new AggregateError(
      error.errors.map((entry) => redactRepositoryError(entry, repo)),
      message,
    );
  }
  return new Error(
    message,
    error instanceof Error && error.cause !== undefined
      ? { cause: redactRepositoryError(error.cause, repo) }
      : undefined,
  );
}

/** Migrate only worker-owned text artifacts; never traverse source checkouts or symlinks. */
export async function redactLegacyRepositoryArtifacts(jobRoot: string): Promise<void> {
  const roots = ['analysis', 'prompts', 'out'];
  async function visit(file: string): Promise<void> {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file)) await visit(path.join(file, name));
    } else if (/\.(?:json|ya?ml|txt|md|log)$/i.test(file)) {
      const original = await fs.readFile(file, 'utf8');
      const safe = redactRepositoryText(original);
      if (safe !== original) await writeFileAtomic(file, safe);
    }
  }
  await visit(path.join(jobRoot, 'job-metadata.json'));
  for (const root of roots) await visit(path.join(jobRoot, root));
}
