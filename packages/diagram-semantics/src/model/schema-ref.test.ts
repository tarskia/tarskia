import { describe, expect, it } from 'vitest';
import {
  buildDefaultSchemaActivation,
  buildSchemaRef,
  getSchemaDisplayId,
  getSchemaDisplayName,
  isSchemaOwner,
  parseSchemaRef,
} from './schema-ref';

describe('schema owners', () => {
  it.each([
    'core',
    'gallery',
    'repo',
    'user',
  ] as const)('preserves the %s owner and version', (owner) => {
    const ref = `${owner}/foo@0.1`;
    const parsed = parseSchemaRef(ref);
    expect(isSchemaOwner(owner)).toBe(true);
    expect(parsed).toEqual({ owner, name: 'foo', version: '0.1' });
    expect(buildSchemaRef(parsed, parsed.version)).toBe(ref);
    expect(getSchemaDisplayId(ref)).toBe(`${owner}/foo`);
    expect(getSchemaDisplayName(ref)).toBe('foo');
  });

  it('gives repo schemas the same default activation layer as user schemas', () => {
    for (const name of ['foo', 'code', 'data-model']) {
      expect(buildDefaultSchemaActivation(`repo/${name}@0.1`)).toEqual({
        schema: `repo/${name}@0.1`,
        layer: 0,
      });
      expect(buildDefaultSchemaActivation(`repo/${name}@0.1`).layer).toBe(
        buildDefaultSchemaActivation(`user/${name}@0.1`).layer,
      );
    }
    expect(buildDefaultSchemaActivation('core/code@0.1').layer).toBe(1);
  });

  it('retains the user fallback for unknown owners', () => {
    expect(isSchemaOwner('unknown')).toBe(false);
    expect(parseSchemaRef('unknown/foo@0.1')).toEqual({
      owner: 'user',
      name: 'foo',
      version: '0.1',
    });
  });
});
