import path from 'node:path';

export const semanticsSourceAlias = {
  find: /^@tarskia\/diagram-semantics$/,
  replacement: path.resolve(import.meta.dirname, '../packages/diagram-semantics/src/index.ts'),
};
