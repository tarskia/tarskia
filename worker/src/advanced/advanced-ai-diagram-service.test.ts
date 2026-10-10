import { describe, expect, it } from 'vitest';
import { dedupeSchemaActivations } from './schema-set';

describe('dedupeSchemaActivations', () => {
  it('keeps the first activation for each schema id regardless of layer or version', () => {
    expect(
      dedupeSchemaActivations([
        { schema: 'core/web-app@0.3', layer: 0 },
        { schema: 'core/code@0.1', layer: 1 },
        { schema: 'core/web-app@0.3', layer: 1 },
        { schema: 'core/code@0.2', layer: 2 },
      ]),
    ).toEqual([
      { schema: 'core/web-app@0.3', layer: 0 },
      { schema: 'core/code@0.1', layer: 1 },
    ]);
  });
});
