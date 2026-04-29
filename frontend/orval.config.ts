import { defineConfig } from 'orval';

export default defineConfig({
  diagramApi: {
    input: {
      target: '../openapi/tarskia-api.yaml',
    },
    output: {
      target: './src/api/generated/index.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      mode: 'tags-split',
      clean: true,
      prettier: false,
      override: {
        mutator: {
          path: './src/api/client/custom-fetch.ts',
          name: 'customFetch',
        },
        query: {
          useQuery: true,
          useMutation: true,
          useInfinite: false,
        },
      },
    },
  },
});
