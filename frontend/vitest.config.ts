import { configDefaults, defineConfig } from 'vitest/config';

import { semanticsSourceAlias } from './semantics-source-alias';

export default defineConfig({
  resolve: { alias: [semanticsSourceAlias] },
  test: {
    exclude: [...configDefaults.exclude, 'src/integration/**/*.integration.test.ts'],
  },
});
