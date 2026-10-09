export {
  collectSchemaSwitchValidation,
  parseAndValidateDiagramDoc,
  sanitizeDiagramDoc,
  validateDiagramDoc,
} from './diagram';
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
export type { DiagramValidationOptions, ValidationResult } from './types';
