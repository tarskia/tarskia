import path from 'node:path';
import { compileSchemaSemantics, validateDiagramYaml } from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';

// Shared real schema context for refinement fixtures that do not supply their own registry.
const registry = await loadSchemaRegistry(path.resolve('assets/schemas'));
const validation = validateDiagramYaml({
  yaml: 'version: 0.1.0\nschemaRefs:\n  - schema: core/web-app@0.3\n    layer: 0\n  - schema: core/kubernetes@0.3\n    layer: 1\nentities: []\nrelations: []\n',
  schemaRegistry: registry,
});
if (!validation.effectiveSchema) throw new Error('Refinement test schema did not resolve');
export const testGroupSchema = validation.effectiveSchema;
export const testGroupSemantics = compileSchemaSemantics(validation.effectiveSchema);
