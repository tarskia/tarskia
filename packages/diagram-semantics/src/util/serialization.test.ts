import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './serialization';

describe('document serialization', () => {
  it('normalizes provenance input/paths shorthand into canonical locations', () => {
    const doc = parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    provenance:
      input: primary
      paths:
        - src/app.ts
        - src/routes.ts
relations:
  - id: app-calls-api
    type: core/software.relations.calls
    from: app
    to: api
    provenance:
      input: primary
      path: src/app.ts
`);

    expect(doc.entities[0]?.provenance?.locations).toEqual([
      { input: 'primary', path: 'src/app.ts' },
      { input: 'primary', path: 'src/routes.ts' },
    ]);
    expect(doc.relations[0]?.provenance?.locations).toEqual([
      { input: 'primary', path: 'src/app.ts' },
    ]);
    expect(serializeDocument(doc)).toContain('locations:');
    expect(serializeDocument(doc)).not.toContain('paths:');
  });
});
