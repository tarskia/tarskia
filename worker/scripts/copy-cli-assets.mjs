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

const schemaSource = path.resolve(workerRoot, '../packages/diagram-semantics/core-schemas');
const schemaDestination = path.join(workerRoot, 'dist/schemas');
await fs.rm(schemaDestination, { recursive: true, force: true });
await fs.mkdir(schemaDestination, { recursive: true });
for (const entry of await fs.readdir(schemaSource, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.yaml')) {
    await fs.copyFile(
      path.join(schemaSource, entry.name),
      path.join(schemaDestination, entry.name),
    );
  }
}
