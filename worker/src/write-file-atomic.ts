import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

// Keep the temporary file on the destination filesystem so rename is atomic.
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: { exclusive?: boolean } = {},
): Promise<void> {
  const mode = await fs
    .stat(filePath)
    .then((stat) => stat.mode & 0o777)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return 0o666;
      throw error;
    });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const file = await fs.open(temporaryPath, 'wx', mode);
    created = true;
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    // Legacy checkpoint migration must publish only if the checkpoint is still absent.
    if (options.exclusive) await fs.link(temporaryPath, filePath);
    else await fs.rename(temporaryPath, filePath);
  } finally {
    if (created) await fs.rm(temporaryPath, { force: true });
  }
}
