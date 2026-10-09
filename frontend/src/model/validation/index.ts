export type { DiagramValidationOptions, ValidationResult } from '@tarskia/diagram-semantics';
export {
  collectSchemaSwitchValidation,
  parseAndValidateDiagramDoc,
  sanitizeDiagramDoc,
  validateDiagramDoc,
} from '@tarskia/diagram-semantics';
export {
  parseAndValidateSchemaModule,
  parseSchemaModuleYaml,
  validateSchemaModuleObject,
} from './schema';
export {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalog,
  getSchemaDependencyRefs,
  materializeSchemaClosure,
  resolveSchemaClosureFromCatalog,
  resolveSchemaClosureFromRawSet,
} from './schema-closure';
