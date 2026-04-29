import { describe, it } from 'vitest';
import addClientRaw from '../../data/extensions/add-client.yaml?raw';
import crossSchemaRelationRaw from '../../data/extensions/cross-schema-relation.yaml?raw';
import patchEndpointMethodRaw from '../../data/extensions/patch-endpoint-method.yaml?raw';
import removeDeprecatedRaw from '../../data/extensions/remove-deprecated.yaml?raw';
import { diagnosticsToMessages } from '../diagnostics';
import { parseAndValidateSchemaModule } from './schema';

describe('schema module examples', () => {
  it('parses extension-style schema modules with use/update/remove sections', () => {
    const fixtures = [
      { name: 'add-client', raw: addClientRaw },
      { name: 'patch-endpoint-method', raw: patchEndpointMethodRaw },
      { name: 'cross-schema-relation', raw: crossSchemaRelationRaw },
      { name: 'remove-deprecated', raw: removeDeprecatedRaw },
    ];
    for (const fixture of fixtures) {
      const { raw, name } = fixture;
      const result = parseAndValidateSchemaModule(raw);
      if (!result.ok) {
        throw new Error(
          `Fixture ${name} failed validation:\n${diagnosticsToMessages(result.diagnostics).join('\n')}`,
        );
      }
    }
  });
});
