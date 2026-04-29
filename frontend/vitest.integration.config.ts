import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/integration/global-setup.ts'],
    include: ['src/integration/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
