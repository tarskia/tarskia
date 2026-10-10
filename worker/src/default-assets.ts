import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from '../package.json';

const bundledSchemaSource = fileURLToPath(new URL('../assets/schemas', import.meta.url));

export function resolveDefaultSchemaSource(): string {
  if (existsSync(bundledSchemaSource)) return bundledSchemaSource;
  throw new Error(`Unable to locate bundled schema assets at ${bundledSchemaSource}.`);
}

export async function resolveBundledSchemaRevision(source: string): Promise<string | undefined> {
  const roots = await Promise.all([fs.realpath(source), fs.realpath(bundledSchemaSource)]).catch(
    () => undefined,
  );
  if (!roots || roots[0] !== roots[1]) return undefined;
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else if (entry.isFile() || (entry.isSymbolicLink() && (await fs.stat(location)).isFile()))
        files.push(location);
    }
  };
  await visit(roots[1]);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const relative = path.relative(roots[1], file).split(path.sep).join('/');
    const bytes = await fs.readFile(file);
    // Length framing makes boundaries between names and contents unambiguous.
    hash.update(`${Buffer.byteLength(relative)}:${relative}:${bytes.length}:`);
    hash.update(bytes);
  }
  return `bundled@${version}+${hash.digest('hex').slice(0, 12)}`;
}
