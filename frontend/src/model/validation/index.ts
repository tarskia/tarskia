export type { DiagramValidationOptions, ValidationResult } from '@tarskia/diagram-semantics';
export {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalog,
  collectSchemaSwitchValidation,
  getSchemaDependencyRefs,
  materializeSchemaClosure,
  parseAndValidateDiagramDoc,
  resolveSchemaClosureFromCatalog,
  resolveSchemaClosureFromRawSet,
  sanitizeDiagramDoc,
  validateDiagramDoc,
} from '@tarskia/diagram-semantics';
export {
  parseAndValidateSchemaModule,
  parseSchemaModuleYaml,
  validateSchemaModuleObject,
} from './schema';
