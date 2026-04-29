import { describe, expect, it } from 'vitest';

import { sanitizeOptionalUuid } from './uuid';

describe('sanitizeOptionalUuid', () => {
  it('returns undefined for blank or non-UUID values', () => {
    expect(sanitizeOptionalUuid(undefined)).toBeUndefined();
    expect(sanitizeOptionalUuid('   ')).toBeUndefined();
    expect(sanitizeOptionalUuid('revision-2')).toBeUndefined();
  });

  it('preserves trimmed UUID values', () => {
    expect(sanitizeOptionalUuid('  123e4567-e89b-12d3-a456-426614174000  ')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });
});
