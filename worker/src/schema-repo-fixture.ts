import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { resolveDefaultSchemaSource } from './default-assets';

let directory: string | undefined;
/** A disposable schema repository assembled from canonical core schemas and extra fixtures. */
export function schemaRepoFixture(): string {
  if (!directory) {
    directory = mkdtempSync(path.join(os.tmpdir(), 'tarskia-schema-fixture-'));
    cpSync(fileURLToPath(new URL('../test/fixtures/schema-repo', import.meta.url)), directory, {
      recursive: true,
    });
    cpSync(resolveDefaultSchemaSource(), path.join(directory, 'src/schemas'), {
      recursive: true,
      filter: (source) => !source.endsWith('README.md'),
    });
  }
  return directory;
}
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
