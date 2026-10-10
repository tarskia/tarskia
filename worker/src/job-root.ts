import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './write-file-atomic';

export async function ensureJobRoot(jobRoot: string): Promise<void> {
  await fs.mkdir(jobRoot, { recursive: true });
  try {
    await writeFileAtomic(path.join(jobRoot, '.gitignore'), '*\n', { exclusive: true });
  } catch (error) {
    // Explicit job roots may already contain user-maintained ignore rules.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
