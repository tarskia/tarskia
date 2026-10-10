export * from '@tarskia/diagram-semantics';

import {
  parseDocument as parseSharedDocument,
  parseSchema as parseSharedSchema,
  parseSourceDocument as parseSharedSourceDocument,
} from '@tarskia/diagram-semantics';
import { parseYamlText } from '../../untrusted-yaml';

// Keep canonical normalization in the shared kernel after the worker input gate.
export function parseDocument(raw: string) {
  parseYamlText(raw);
  return parseSharedDocument(raw);
}

export function parseSourceDocument(raw: string) {
  parseYamlText(raw);
  return parseSharedSourceDocument(raw);
}

export function parseSchema(raw: string) {
  parseYamlText(raw);
  return parseSharedSchema(raw);
}
