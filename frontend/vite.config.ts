import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { semanticsSourceAlias } from './semantics-source-alias';
import { startupOpenPlugin } from './server/startup-open';

const FRONTEND_ROOT = import.meta.dirname;
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..');
const IGNORED_LOCAL_WORKSPACE_GLOBS = ['**/.claude/**', '**/.tmp/**', '**/.playwright-mcp/**'];

function resolveManualChunk(id: string) {
  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/scheduler/') ||
    id.includes('/node_modules/@tanstack/react-query/')
  ) {
    return 'framework';
  }

  if (/\/node_modules\/d3-[^/]+\//.test(id) || id.includes('/node_modules/dagre/')) {
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

const API_PROXY_PREFIXES = ['/api/gallery', '/healthz', '/ping'] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WORKSPACE_ROOT, '');
  const openPath = env.TARSKIA_OPEN?.trim();
  const apiOrigin =
    env.VITE_API_BASE_URL?.trim() ||
    env.API_ORIGIN?.trim() ||
    `http://localhost:${env.PORT?.trim() || '8082'}`;

  return {
    root: FRONTEND_ROOT,
    resolve: { alias: [semanticsSourceAlias] },
    envDir: WORKSPACE_ROOT,
    plugins: [
      react(),
      ...(openPath ? [startupOpenPlugin(path.resolve(WORKSPACE_ROOT, openPath))] : []),
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
