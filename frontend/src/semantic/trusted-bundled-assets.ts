import type { SchemaModule, SemanticDocument } from '../model/types';
import { parseTrustedSchemaModule, parseTrustedSemanticDocument } from './index';

/**
 * Bundled starter/schema assets are validated in Vitest before deploy.
 * Runtime boot uses this trusted parse-only boundary so shipped assets do not pay validation cost.
 */
export const parseTrustedBundledDocument = (raw: string): SemanticDocument =>
  parseTrustedSemanticDocument(raw);

/**
 * Do not use this for user-authored or imported schemas.
 * Those must continue to go through the validated schema parser.
 */
export const parseTrustedBundledSchemaModule = (raw: string): SchemaModule =>
  parseTrustedSchemaModule(raw);
