import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readJobMetadata } from './job-metadata';

it('returns undefined only for absent metadata, and reports corruption with recovery instructions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-read-'));
  const file = path.join(root, 'out', 'job-metadata.json');
  try {
    expect(await readJobMetadata(root)).toBeUndefined();
    await fs.mkdir(path.dirname(file));
    for (const contents of ['{truncated', 'null', '{}', '{"version":2}']) {
      await fs.writeFile(file, contents);
      await expect(readJobMetadata(root)).rejects.toThrow(`Job metadata at ${file} is unreadable:`);
      await expect(readJobMetadata(root)).rejects.toThrow(
        'Delete the job folder or rerun with --overwrite to start fresh.',
      );
    }
    await fs.rm(file);
    await fs.mkdir(file);
    await expect(readJobMetadata(root)).rejects.toThrow('is unreadable:');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
