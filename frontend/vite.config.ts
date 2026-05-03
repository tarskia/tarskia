import { promises as fs } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const DEV_WORKER_DIAGRAM_ENDPOINT = '/__dev/worker-diagram';
const FRONTEND_ROOT = import.meta.dirname;
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..');
const IGNORED_LOCAL_WORKSPACE_GLOBS = ['**/.claude/**', '**/.tmp/**', '**/.playwright-mcp/**'];

function workerDiagramDevPlugin(workerDiagramPath: string): Plugin {
  return {
    name: 'worker-diagram-dev-plugin',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(DEV_WORKER_DIAGRAM_ENDPOINT, async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        try {
          const [yaml, stats] = await Promise.all([
            fs.readFile(workerDiagramPath, 'utf8'),
            fs.stat(workerDiagramPath),
          ]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              path: workerDiagramPath,
              yaml,
              updatedAt: stats.mtime.toISOString(),
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: `Worker diagram artifact not available: ${message}`,
              path: workerDiagramPath,
            }),
          );
        }
      });
    },
  };
}

function resolveManualChunk(id: string) {
  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/scheduler/') ||
    id.includes('/node_modules/@tanstack/react-query/')
  ) {
    return 'framework';
  }

  if (
    id.includes('/node_modules/reactflow/') ||
    id.includes('/node_modules/@reactflow/') ||
    id.includes('/node_modules/dagre/')
  ) {
    return 'diagram-vendor';
  }

  if (
    id.includes('/node_modules/js-yaml/') ||
    id.includes('/node_modules/ajv/') ||
    id.includes('/packages/diagram-semantics/')
  ) {
    return 'schema-runtime';
  }

  return undefined;
}

const API_PROXY_PREFIXES = [
  '/auth',
  '/diagram-streams',
  '/api/gallery',
  '/healthz',
  '/me',
  '/ping',
  '/schema-streams',
] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WORKSPACE_ROOT, '');
  const workerDiagramPath = env.DEV_WORKER_DIAGRAM_PATH?.trim();
  const apiOrigin =
    env.VITE_API_BASE_URL?.trim() ||
    env.API_ORIGIN?.trim() ||
    `http://localhost:${env.PORT?.trim() || '8082'}`;

  return {
    root: FRONTEND_ROOT,
    envDir: WORKSPACE_ROOT,
    plugins: [
      react(),
      ...(workerDiagramPath ? [workerDiagramDevPlugin(path.resolve(workerDiagramPath))] : []),
    ],
    server: {
      fs: {
        allow: [WORKSPACE_ROOT],
      },
      watch: {
        ignored: IGNORED_LOCAL_WORKSPACE_GLOBS,
      },
      proxy: Object.fromEntries(
        API_PROXY_PREFIXES.map((prefix) => [
          prefix,
          {
            target: apiOrigin,
            changeOrigin: true,
          },
        ]),
      ),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: resolveManualChunk,
        },
      },
    },
  };
});
