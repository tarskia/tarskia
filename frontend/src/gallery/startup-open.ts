import { openLocalDiagram } from './local-diagram';
import { openRepoDiagramFiles } from './local-folder';
import { readRepoComparison } from './repo-comparison';

export function hasStartupOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector('meta[name="tarskia-open"]')?.getAttribute('content') === 'true'
  );
}

export async function fetchStartupDiagram(signal?: AbortSignal) {
  const response = await fetch('/__tarskia/open', { signal, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Unable to open files.');
  }
  const body: { name: string; kind: 'folder' | 'file'; files: { path: string; raw: string }[] } =
    await response.json();
  const files = body.files.map(({ path, raw }) => ({
    path,
    file: {
      name: path.split('/').at(-1) ?? path,
      size: new TextEncoder().encode(raw).length,
      text: async () => raw,
    },
  }));
  if (body.kind === 'folder') return openRepoDiagramFiles(body.name, files);
  const opened = await openLocalDiagram(
    files.filter(({ path }) => !path.includes('.job/')).map(({ file }) => file),
  );
  const comparison = await readRepoComparison(
    body.name,
    body.files.map((file) => ({ ...file, path: `.tarskia/${file.path}` })),
  );
  return { ...opened, comparison };
}
