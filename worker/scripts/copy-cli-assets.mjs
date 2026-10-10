import { promises as fs } from 'node:fs';
import path from 'node:path';

const workerRoot = path.resolve(import.meta.dirname, '..');

await fs.copyFile(
  path.join(workerRoot, 'src', 'codex', 'diagram-meta-ontology.md'),
  path.join(workerRoot, 'dist', 'diagram-meta-ontology.md'),
);

for (const name of ['build-graphify-hints.py', 'build-graphify-hints.py.lock']) {
  await fs.copyFile(
    path.join(workerRoot, 'src', 'advanced', name),
    path.join(workerRoot, 'dist', name),
  );
}
