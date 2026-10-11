import {
  combineRepoDiagrams,
  type Entity,
  pickRepoDiagramFiles,
  serializeDocument,
} from '@tarskia/diagram-semantics';
import { LOCAL_FILE_LIMIT, type LocalDiagram, openLocalDiagram } from './local-diagram';

export type LocalFile = Pick<File, 'name' | 'size' | 'text'>;
export interface LocalDirectory {
  name: string;
  entries(): Promise<
    { name: string; directory?: LocalDirectory; file?: () => Promise<LocalFile> }[]
  >;
}
export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<
    DirectoryHandle | { kind: 'file'; name: string; getFile(): Promise<File> }
  >;
}
export function directoryFromHandle(handle: DirectoryHandle): LocalDirectory {
  return {
    name: handle.name,
    async entries() {
      const entries = [];
      for await (const child of handle.values()) {
        entries.push(
          child.kind === 'directory'
            ? { name: child.name, directory: directoryFromHandle(child) }
            : { name: child.name, file: () => child.getFile() },
        );
      }
      return entries;
    },
  };
}
export function directoryFromEntry(entry: FileSystemDirectoryEntry): LocalDirectory {
  return {
    name: entry.name,
    async entries() {
      const reader = entry.createReader();
      const entries: FileSystemEntry[] = [];
      // Directory readers return batches; keep the same reader until exhausted.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        entries.push(...batch);
      }
      return entries.map((child) =>
        child.isDirectory
          ? { name: child.name, directory: directoryFromEntry(child as FileSystemDirectoryEntry) }
          : {
              name: child.name,
              file: () =>
                new Promise<File>((resolve, reject) =>
                  (child as FileSystemFileEntry).file(resolve, reject),
                ),
            },
      );
    },
  };
}
export async function openRepoFolder(directory: LocalDirectory): Promise<LocalDiagram> {
  const files = new Map<string, () => Promise<LocalFile>>();
  const listTarskia = async (
    children: Awaited<ReturnType<LocalDirectory['entries']>>,
    prefix: string,
  ) => {
    const tarskia = children.find((child) => child.name === '.tarskia')?.directory;
    if (!tarskia) return;
    for (const child of await tarskia.entries()) {
      if (child.file) files.set(`${prefix}.tarskia/${child.name}`, child.file);
    }
  };
  const children = await directory.entries();
  await listTarskia(children, '');
  if (!children.some((entry) => entry.name === '.tarskia' && entry.directory)) {
    for (const child of children) {
      if (!child.directory || child.name.startsWith('.') || child.name === 'node_modules') continue;
      await listTarskia(await child.directory.entries(), `${child.name}/`);
    }
  }
  const picked = pickRepoDiagramFiles([...files.keys()]);
  const paths = new Set(picked.flatMap((repo) => [repo.diagramPath, ...repo.schemaPaths]));
  const selected = [];
  for (const path of paths) selected.push({ path, file: await files.get(path)!() });
  return openRepoDiagramFiles(directory.name, selected);
}
export async function openRepoDiagramFiles(
  folderName: string,
  files: { path: string; file: LocalFile }[],
): Promise<LocalDiagram> {
  const repos = pickRepoDiagramFiles(files.map(({ path }) => path));
  if (!repos.length)
    throw new Error(
      `There are no Tarskia diagrams in ${folderName}. Open a repo that has a .tarskia folder, or a folder of such repos.`,
    );
  const selected = new Map(files.map(({ path, file }) => [path, file]));
  const read = async (path: string): Promise<LocalFile> => {
    const file = selected.get(path)!;
    if (file.size > LOCAL_FILE_LIMIT) throw new Error(`${file.name} is larger than 50 MB.`);
    const raw = await file.text();
    return { name: file.name, size: file.size, text: async () => raw };
  };
  const diagrams = [];
  const schemas: LocalFile[] = [];
  const opened = [];
  for (const repo of repos) {
    const diagram = await read(repo.diagramPath);
    const repoSchemas = await Promise.all(repo.schemaPaths.map(read));
    try {
      opened.push(await openLocalDiagram([diagram, ...repoSchemas]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /^This diagram needs the schema (.+?)\. Open the diagram/.exec(message);
      if (missing)
        throw new Error(
          `${repo.name}'s diagram needs the schema ${missing[1]}, which belongs next to it in .tarskia.`,
        );
      throw new Error(`The diagrams in ${folderName} couldn't be combined: ${message}`);
    }
    diagrams.push({ name: repo.name, raw: await diagram.text() });
    schemas.push(...repoSchemas);
  }
  if (opened.length === 1) return opened[0];
  const combined = combineRepoDiagrams({ name: folderName, diagrams });
  if (!combined.doc)
    throw new Error(
      `The diagrams in ${folderName} couldn't be combined: ${combined.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ?? 'Unknown error'}`,
    );
  const entities = new Map<string, Entity>();
  const collect = (items: Entity[]) => {
    for (const entity of items) {
      entities.set(entity.id, entity);
      collect(entity.children ?? []);
    }
  };
  collect(combined.doc.entities);
  const raw = serializeDocument(combined.doc);
  const result = await openLocalDiagram([
    { name: `${folderName}.yaml`, size: raw.length, text: async () => raw },
    ...schemas,
  ]);
  return {
    ...result,
    folder: {
      name: folderName,
      repos: repos.map((repo) => repo.name),
      missingTargets: combined.diagnostics
        .filter((diagnostic) => diagnostic.code === 'diagram.combine.represents_target_missing')
        .map((diagnostic) => {
          const entity = entities.get(diagnostic.entityId!)!;
          return {
            repo: diagnostic.entityId!.split('/')[0],
            name: entity.name ?? entity.id,
            target: entity.represents!,
          };
        }),
    },
  };
}
