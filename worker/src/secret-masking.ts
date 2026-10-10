import { promises as fs } from 'node:fs';
import path from 'node:path';
import { lintSource } from '@secretlint/core';
import { secretLintProfiler } from '@secretlint/profiler';
import { creator } from '@secretlint/secretlint-rule-preset-recommend';
import { throwIfCancelled } from './cancellation';
import type { Logger } from './logger';
import { writeFileAtomic } from './write-file-atomic';

// The library profiler retains per-rule marks; this CLI does not consume profiling.
secretLintProfiler.setEnabled(false);

export const SECRET_LINT_VERSION = '13.0.7';
export interface BuildSecrets {
  maskedInRepo: number;
  files: { path: string; rules: string[] }[];
  redactedFromOutput: number;
}
export interface UnmaskedSecrets {
  count: number;
  files: { path: string; rules: string[] }[];
}
export type SecretsReporter = (report: BuildSecrets, unmasked?: UnmaskedSecrets) => void;
export function formatSecretsAlert(report: BuildSecrets, unmasked?: UnmaskedSecrets): string {
  const pending = unmasked?.count ?? 0;
  const count = report.maskedInRepo + pending;
  let alert = '';
  if (count > 0) {
    const files = [...report.files, ...(unmasked?.files ?? [])].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const listed = files
      .slice(0, 10)
      .map((file) => `${file.rules.join(', ')} in ${file.path}`)
      .join('; ');
    const rest = files.length > 10 ? `; and ${files.length - 10} more` : '';
    alert = `Warning: found ${count} possible secrets in your repository's files (${listed}${rest}).\n`;
    alert +=
      pending > 0
        ? `Masking could not complete; the build stopped before analysis. They're still in your repository. Consider rotating them.\n`
        : `They were masked before analysis and aren't in the diagram, but they're still in your repository. Consider rotating them.\n`;
  }
  if (report.redactedFromOutput > 0)
    alert += `${report.redactedFromOutput} possible secret(s) were also redacted from the diagram output.\n`;
  return alert;
}
export const emptyBuildSecrets = (): BuildSecrets => ({
  maskedInRepo: 0,
  files: [],
  redactedFromOutput: 0,
});
export interface RepositoryMaskingResult {
  maskedFiles: number;
  maskedSecrets: number;
  files: { path: string; rules: string[] }[];
}
export interface OutputRedaction {
  rule: string;
  location: string;
}

// Repository comments must never suppress the worker's security boundary.
const scanningPreset: typeof creator = {
  ...creator,
  create(context) {
    for (const rule of creator.rules) {
      if (rule.meta.id !== '@secretlint/secretlint-rule-filter-comments')
        context.registerRule(rule);
    }
  },
};

async function scan(content: string, filePath: string) {
  const result = await lintSource({
    source: { content, filePath, ext: path.extname(filePath), contentType: 'text' },
    options: {
      config: {
        rules: [{ id: '@secretlint/secretlint-rule-preset-recommend', rule: scanningPreset }],
      },
      noPhysicFilePath: true,
    },
  });
  return result.messages.map((message) => {
    const values = Object.values(message.data ?? {}).filter(
      (value): value is string =>
        typeof value === 'string' && value.length > 0 && content.includes(value),
    );
    // Some rules report contextual ranges; use them only without a matching data value.
    if (values.length === 0) {
      const value = content.slice(message.range[0], message.range[1]);
      if (value) values.push(value);
    }
    return { rule: message.ruleId.replace('@secretlint/secretlint-rule-', ''), values };
  });
}

function replaceValues(content: string, values: string[]): string {
  for (const value of [...new Set(values)].sort((a, b) => b.length - a.length)) {
    content = content.split(value).join('[REDACTED]');
  }
  return content;
}

function replaceBytes(bytes: Buffer, values: string[]): Buffer {
  for (const value of [...new Set(values)].sort((a, b) => b.length - a.length)) {
    const needle = Buffer.from(value, 'utf8');
    const chunks: Buffer[] = [];
    let cursor = 0;
    let found = bytes.indexOf(needle, cursor);
    if (found < 0) continue;
    while (found >= 0) {
      chunks.push(bytes.subarray(cursor, found), Buffer.from('[REDACTED]'));
      cursor = found + needle.length;
      found = bytes.indexOf(needle, cursor);
    }
    chunks.push(bytes.subarray(cursor));
    bytes = Buffer.concat(chunks);
  }
  return bytes;
}

export async function maskRepository(
  root: string,
  logger?: Pick<Logger, 'info'>,
  onProgress?: (report: RepositoryMaskingResult, unmasked?: UnmaskedSecrets) => void,
): Promise<RepositoryMaskingResult> {
  const canonicalRoot = await fs.realpath(root);
  const files: string[] = [];
  const outboundLinks: string[] = [];
  const isInside = (target: string) => {
    const relative = path.relative(canonicalRoot, target);
    return (
      relative === '' ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    );
  };
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      throwIfCancelled();
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const rawTarget = path.resolve(directory, await fs.readlink(filename));
        const target = await fs.realpath(filename).catch(() => rawTarget);
        if (!isInside(rawTarget) || !isInside(target)) outboundLinks.push(filename);
      } else if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile()) files.push(filename);
    }
  }
  await walk(canonicalRoot);
  for (const filename of outboundLinks) {
    throwIfCancelled();
    await fs.unlink(filename);
  }
  const result: RepositoryMaskingResult = { maskedFiles: 0, maskedSecrets: 0, files: [] };
  const unmasked = new Map<string, { count: number; path: string; rules: string[] }>();
  const reportProgress = () =>
    onProgress?.(structuredClone(result), {
      count: [...unmasked.values()].reduce((sum, file) => sum + file.count, 0),
      files: [...unmasked.values()].map(({ path, rules }) => ({ path, rules: [...rules] })),
    });
  let cursor = 0;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (cursor < files.length) {
        throwIfCancelled();
        const filename = files[cursor++];
        const bytes = await fs.readFile(filename);
        if (bytes.subarray(0, 8192).includes(0)) continue;
        const content = bytes.toString('utf8');
        const matches = await scan(content, filename);
        const masked = replaceBytes(
          bytes,
          matches.flatMap((match) => match.values),
        );
        if (masked.equals(bytes)) continue;
        const detected = {
          count: matches.filter((match) => match.values.length > 0).length,
          path: path.relative(canonicalRoot, filename).split(path.sep).join('/'),
          rules: [...new Set(matches.map((match) => match.rule))].sort(),
        };
        unmasked.set(filename, detected);
        reportProgress();
        throwIfCancelled();
        await writeFileAtomic(filename, masked);
        unmasked.delete(filename);
        result.maskedFiles++;
        result.maskedSecrets += matches.filter((match) => match.values.length > 0).length;
        result.files.push({
          path: path.relative(canonicalRoot, filename).split(path.sep).join('/'),
          rules: [...new Set(matches.map((match) => match.rule))].sort(),
        });
        reportProgress();
      }
    }),
  );
  result.files.sort((a, b) => a.path.localeCompare(b.path));
  reportProgress();
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  throwIfCancelled();
  logger?.info(
    `Masked ${result.maskedSecrets} possible secret(s) in ${result.maskedFiles} file(s) before analysis`,
  );
  return result;
}

export async function redactOutputDocument<T>(
  doc: T,
  options: { kind?: 'diagram' | 'schema' } = {},
): Promise<{ document: T; redactions: OutputRedaction[] }> {
  const document = structuredClone(doc);
  const strings: { value: string; location: string; set: (value: string) => void }[] = [];
  function visit(
    value: unknown,
    location: string,
    mode: 'document' | 'text' | 'provenance',
    owner?: string,
  ): void {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const hasOwnId = mode === 'document' && typeof record.id === 'string';
    const id = hasOwnId ? String(record.id) : owner;
    const fieldRoot = hasOwnId ? '' : location;
    for (const [key, child] of Object.entries(record)) {
      const field = fieldRoot ? `${fieldRoot}.${key}` : key;
      const childMode =
        mode === 'text' || key === 'props' || key === 'metadata'
          ? 'text'
          : key === 'provenance'
            ? 'provenance'
            : mode;
      const freeText =
        childMode === 'text' ||
        (mode === 'provenance' && (key === 'note' || key === 'notes')) ||
        (mode === 'document' &&
          [
            'description',
            'label',
            'labels',
            ...(options.kind === 'schema' ? [] : ['name']),
          ].includes(key));
      if (typeof child === 'string' && freeText) {
        strings.push({
          value: child,
          location: id ? `${id}.${field}` : field,
          set: (replacement) => {
            record[key] = replacement;
          },
        });
      } else if (child && typeof child === 'object') {
        if (
          mode === 'document' &&
          ['schemaRefs', 'schema', 'from', 'to', 'type', 'parent', 'id'].includes(key)
        )
          continue;
        visit(child, field, freeText ? 'text' : childMode, id);
      }
    }
  }
  visit(document, '', 'document');
  const matches = await scan(strings.map((entry) => entry.value).join('\n\n'), 'output.txt');
  const redactions: OutputRedaction[] = [];
  for (const entry of strings) {
    const applicable = matches.filter((match) =>
      match.values.some((value) => entry.value.includes(value)),
    );
    const masked = replaceValues(
      entry.value,
      applicable.flatMap((match) => match.values),
    );
    if (masked === entry.value) continue;
    entry.set(masked);
    for (const rule of new Set(applicable.map((match) => match.rule)))
      redactions.push({ rule, location: entry.location });
  }
  return { document, redactions };
}
