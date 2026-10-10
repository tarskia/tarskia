import { describe, expect, it } from 'vitest';
import { extractSchemaModuleYamlResponse, extractYamlResponse } from './diagram-agent';

describe('shared model YAML extraction', () => {
  it('extracts semantic YAML from mixed prose responses', () => {
    const response = [
      'I read `out/analysis/level0-backbone.response.yaml`:',
      '',
      'version: 0.1.0',
      'schemaRefs: []',
      'entities: []',
      'relations: []',
    ].join('\n');

    expect(extractYamlResponse(response)).toBe(
      ['version: 0.1.0', 'schemaRefs: []', 'entities: []', 'relations: []'].join('\n'),
    );
  });

  it('extracts schema module YAML from mixed prose responses', () => {
    const response = [
      'I inspected the repo and drafted this schema:',
      '',
      'owner: gallery',
      'name: outline',
      'version: "0.1"',
      'types: []',
      'relations: []',
    ].join('\n');

    expect(extractSchemaModuleYamlResponse(response)).toBe(
      ['owner: gallery', 'name: outline', 'version: "0.1"', 'types: []', 'relations: []'].join(
        '\n',
      ),
    );
  });
});
