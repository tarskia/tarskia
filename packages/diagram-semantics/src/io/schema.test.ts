import { describe, expect, it } from 'vitest';
import {
  ingestSchemaModule,
  ingestTrustedSchemaModule,
  parseAndValidateSchemaModule,
  parseSchemaModule,
  parseSchemaModuleYaml,
  parseTrustedSchemaModule,
  serializeSchemaModule,
  validateSchemaModuleObject,
} from './schema';

const validRaw = `owner: user
name: billing
version: "1"
types:
  - id: service
    label: Service
relations:
  - id: calls
    label: Calls
`;

describe('schema io', () => {
  it('accepts relation display flowDirection metadata', () => {
    const parsed = parseAndValidateSchemaModule(`owner: user
name: billing
version: "1"
types:
  - id: service
relations:
  - id: reads
    label: Reads
    display:
      flowDirection: reverse
`);

    expect(parsed.ok).toBe(true);
    expect(parsed.value?.relations[0]?.display?.flowDirection).toBe('reverse');
  });

  it('rejects invalid relation display flowDirection values', () => {
    const parsed = parseAndValidateSchemaModule(`owner: user
name: billing
version: "1"
types:
  - id: service
relations:
  - id: reads
    label: Reads
    display:
      flowDirection: sideways
`);

    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'schema',
          phase: 'shape',
        }),
      ]),
    );
  });

  it('parses trusted and untrusted schema module forms explicitly', () => {
    const parsed = parseSchemaModule(validRaw);

    expect(parseTrustedSchemaModule(serializeSchemaModule(parsed))).toEqual(parsed);
  });

  it('returns the shared yaml parse diagnostic for malformed schema yaml', () => {
    const result = parseSchemaModuleYaml('owner: [broken');

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        domain: 'schema',
        phase: 'parse',
        code: 'semantic.parse.invalid_yaml',
      }),
    ]);
  });

  it('validates schema module semantics during ingest', () => {
    const result = ingestSchemaModule(`owner: user
name: billing
version: "1"
use:
  - schema: core/a@1
    alias: dep
  - schema: core/b@1
    alias: dep
types:
  - id: service
    label: Service
relations:
  - id: calls
    label: Calls
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'schema',
          phase: 'semantic',
          code: 'schema.semantic.duplicate_use_alias',
        }),
      ]),
    );
  });

  it('allows trusted schema ingest to skip semantic validation', () => {
    const trusted = ingestTrustedSchemaModule(`owner: user
name: billing
version: "1"
use:
  - schema: core/a@1
    alias: dep
  - schema: core/b@1
    alias: dep
types:
  - id: service
    label: Service
relations:
  - id: calls
    label: Calls
`);

    expect(trusted.ok).toBe(true);
    expect(trusted.value?.use).toHaveLength(2);
  });

  it('keeps the object validator available for schema-authoring flows', () => {
    const parsed = parseSchemaModuleYaml(validRaw);
    if (!parsed.ok) {
      throw new Error('Expected schema yaml to parse');
    }
    const validated = validateSchemaModuleObject(parsed.value);
    const parsedAndValidated = parseAndValidateSchemaModule(validRaw);

    expect(validated.ok).toBe(true);
    expect(parsedAndValidated.ok).toBe(true);
  });
});
