import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultSchemaSource } from './default-assets';
import {
  extractProposedSchemaRefs,
  type SchemaSelectionValidationContextArtifact,
  validateSchemaSelectionCandidate,
} from './schema-selection-validator-cli';
import { buildSchemaActivation } from './semantic';
import { loadSchemaRegistry } from './semantic/schema-loader';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

describe('schema selection validator cli helpers', () => {
  it('extracts proposed schema refs from JSON patches and YAML documents', () => {
    expect(
      extractProposedSchemaRefs(
        JSON.stringify({
          initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
          candidateSchemaRefs: [{ schemaRef: 'core/infra@0.1', suggestedLayer: 1 }],
          suggestedSchemaRefs: ['core/code@0.1'],
          rootEdits: [
            {
              refinement: {
                suggestedSchemaRefs: ['core/frontend@0.3'],
              },
            },
          ],
        }),
      ).schemaRefs,
    ).toEqual(['core/code@0.1', 'core/web-app@0.3', 'core/infra@0.1', 'core/frontend@0.3']);

    expect(
      extractProposedSchemaRefs(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`).schemaRefs,
    ).toEqual(['core/web-app@0.3']);
  });

  it('validates proposed refs with the same schema-set acceptance rules used by the pipeline', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const context: SchemaSelectionValidationContextArtifact = {
      version: 1,
      rootSchemaRefs: [act('core/web-app@0.3')],
      activeSchemaRefs: [act('core/web-app@0.3')],
      candidateSchemaRefs: [
        {
          schemaRef: 'core/code@0.1',
          suggestedLayer: 1,
          rationale: 'code modules may be needed for implementation layers',
          evidence: [{ path: 'src/index.ts', reason: 'implementation files exist' }],
        },
      ],
    };

    const accepted = validateSchemaSelectionCandidate({
      schemaRegistry,
      context,
      proposedSchemaRefs: ['core/code@0.1'],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.activeSchemaRefs.map((activation) => activation.schema)).toContain(
      'core/code@0.1',
    );

    const rejected = validateSchemaSelectionCandidate({
      schemaRegistry,
      context,
      proposedSchemaRefs: ['gallery/missing@0.1'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.rejectedSchemaRefs).toEqual(['gallery/missing@0.1']);
    expect(rejected.diagnostics[0]?.code).toBe('diagram.document.schema_ref_not_accepted');
  });
});
