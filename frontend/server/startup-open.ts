import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import { pickRepoDiagramFiles } from '../../packages/diagram-semantics/src/index';

export const OPEN_ENDPOINT = '/__tarskia/open';
export const OPEN_META = '<meta name="tarskia-open" content="true">';

async function directoryEntries(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function diagramPaths(root: string) {
  const entries = await directoryEntries(root);
  const paths: string[] = [];
  const add = async (parent: string) => {
    const entries = await directoryEntries(path.join(root, parent));
    if (!entries.some((entry) => entry.name === '.tarskia' && entry.isDirectory())) return;
    const directory = path.posix.join(parent, '.tarskia');
    paths.push(`${directory}/`);
    for (const entry of await directoryEntries(path.join(root, directory))) {
      if (entry.isFile() && entry.name.endsWith('.yaml')) {
        paths.push(path.posix.join(directory, entry.name));
      }
    }
  };
  if (entries.some((entry) => entry.name === '.tarskia' && entry.isDirectory())) {
    await add('');
  } else {
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await add(entry.name);
      }
    }
  }
  return paths;
}

export async function readStartupOpen(openPath: string) {
  const stat = await fs.stat(openPath);
  const kind = stat.isDirectory() ? 'folder' : 'file';
  const root = kind === 'folder' ? openPath : path.dirname(openPath);
  let selected: string[];
  if (kind === 'folder') {
    selected = pickRepoDiagramFiles(await diagramPaths(root)).flatMap((repo) => [
      repo.diagramPath,
      ...repo.schemaPaths,
    ]);
  } else {
    selected = [
      path.basename(openPath),
      ...(await directoryEntries(root))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.schema.yaml'))
        .map((entry) => entry.name),
    ];
  }
  // Read only named compare artifacts. Never follow .job or compare symlinks.
  const diagramFiles = selected.filter(
    (file) => file.endsWith('.yaml') && !file.endsWith('.schema.yaml'),
  );
  for (const diagramPath of diagramFiles) {
    const directory = path.posix.dirname(diagramPath);
    const job = (await directoryEntries(path.join(root, directory))).find(
      (entry) => entry.name === '.job' && entry.isDirectory(),
    );
    if (!job) continue;
    const jobPath = path.posix.join(directory, '.job');
    const compare = (await directoryEntries(path.join(root, jobPath))).find(
      (entry) => entry.name === 'compare' && entry.isDirectory(),
    );
    if (!compare) continue;
    const name = path.basename(diagramPath, '.yaml');
    const compareDirectory = path.posix.join(jobPath, 'compare');
    for (const entry of await directoryEntries(path.join(root, compareDirectory))) {
      if (entry.isFile() && [`${name}.base.yaml`, `${name}.json`].includes(entry.name))
        selected.push(path.posix.join(compareDirectory, entry.name));
    }
  }
  const files = await Promise.all(
    [...new Set(selected)].map(async (relative) => ({
      path: relative,
      raw: await fs.readFile(path.join(root, relative), 'utf8'),
    })),
  );
  return { name: path.basename(openPath), kind, files };
}

export function startupOpenHandler(openPath: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== OPEN_ENDPOINT) return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    void readStartupOpen(openPath).then(
      (result) => res.end(JSON.stringify(result)),
      (error: unknown) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      },
    );
  };
}

export function startupOpenPlugin(openPath: string): Plugin {
  const start = async () => {
    try {
      await fs.stat(openPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`TARSKIA_OPEN points at \`${openPath}\`, which doesn't exist.`);
      }
      throw error;
    }
    console.info(`Tarskia: opening \`${openPath}\` from TARSKIA_OPEN`);
  };
  return {
    name: 'tarskia-startup-open',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('</head>', `${OPEN_META}</head>`),
    async configureServer(server) {
      await start();
      server.middlewares.use(startupOpenHandler(openPath));
    },
    async configurePreviewServer(server) {
      await start();
      server.middlewares.use(startupOpenHandler(openPath));
      // Preview serves a previously built index. Inject the runtime flag here so
      // a container can choose its mounted folder after the image is built.
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0];
        if (
          req.method !== 'GET' ||
          !['/', '/index.html', '/gallery/open', '/gallery/open/'].includes(pathname ?? '')
        )
          return next();
        void fs
          .readFile(
            path.resolve(server.config.root, server.config.build.outDir, 'index.html'),
            'utf8',
          )
          .then((html) => {
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 'no-store');
            res.end(html.replace('</head>', `${OPEN_META}</head>`));
          }, next);
      });
    },
  };
}
