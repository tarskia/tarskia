import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalogFromRegistry,
} from '@tarskia/diagram-semantics';
import { YamlInputError, yamlInputDiagnostic } from '../untrusted-yaml';
import { type Diagnostic, diagramDiagnostic, sortDiagnostics } from './model/diagnostics';
import { getSchemaModuleRef } from './model/schema-ref';
import { parseSchemaId } from './model/schema-selection';
import type { DocumentInput, SchemaModule, SemanticDocument } from './model/types';
import { type DiagramValidationOptions, validateDocument } from './model/validate';
import { parseDocument, parseSchema } from './util/serialization';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']);

export interface SchemaRegistry {
  rootPath: string;
  schemaFiles: string[];
  modulesById: Map<string, SchemaModule>;
}

export interface DiagramValidationResult {
  ok: boolean;
  document?: SemanticDocument;
  diagnostics: Diagnostic[];
  effectiveSchema?: SchemaModule;
  resolvedSchemaIds: string[];
}

const isYamlFile = (filePath: string) => /\.(ya?ml)$/i.test(filePath);

const toParseDiagnostic = (message: string): Diagnostic =>
  diagramDiagnostic({
    phase: 'parse',
    severity: 'error',
    code: 'diagram.parse.invalid_document',
    message,
  });

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveSchemaDirectory(rootPath: string): Promise<string> {
  const preferredSchemaDir = path.join(rootPath, 'src', 'schemas');
  return (await pathExists(preferredSchemaDir)) ? preferredSchemaDir : rootPath;
}

export async function collectYamlFiles(rootPath: string): Promise<string[]> {
  const searchRoot = await resolveSchemaDirectory(rootPath);
  const results: string[] = [];

  const visit = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') {
        if (entry.isDirectory()) continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(entryPath);
        continue;
      }
      if (isYamlFile(entryPath)) {
        results.push(entryPath);
      }
    }
  };

  await visit(searchRoot);
  results.sort((left, right) => left.localeCompare(right));
  return results;
}

export async function loadSchemaRegistry(rootPath: string): Promise<SchemaRegistry> {
  const absoluteRootPath = path.resolve(rootPath);
  const schemaFiles = await collectYamlFiles(absoluteRootPath);
  if (schemaFiles.length === 0) {
    throw new Error(`No schema YAML files found under ${absoluteRootPath}`);
  }

  const modulesById = new Map<string, SchemaModule>();
  for (const schemaFile of schemaFiles) {
    const raw = await fs.readFile(schemaFile, 'utf8');
    const module = parseSchema(raw);
    const schemaId = getSchemaModuleRef(module);
    if (modulesById.has(schemaId)) {
      throw new Error(`Duplicate schema id detected in schema source: ${schemaId}`);
    }
    modulesById.set(schemaId, module);
  }

  return {
    rootPath: absoluteRootPath,
    schemaFiles,
    modulesById,
  };
}

export function validateDiagramYaml(params: {
  yaml: string;
  schemaRegistry: SchemaRegistry;
  validationOptions?: DiagramValidationOptions;
  documentInputs?: DocumentInput[];
}): DiagramValidationResult {
  const { yaml, schemaRegistry, validationOptions, documentInputs } = params;

  let document: SemanticDocument;
  try {
    document = parseDocument(yaml);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        error instanceof YamlInputError
          ? yamlInputDiagnostic(error)
          : toParseDiagnostic(error instanceof Error ? error.message : String(error)),
      ],
      resolvedSchemaIds: [],
    };
  }

  if (documentInputs) {
    document = {
      ...document,
      inputs: [...documentInputs],
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (document.schemaRefs.length === 0) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.schema_refs_required',
        message: 'Document must declare at least one schemaRef',
      }),
    );
    return {
      ok: false,
      document,
      diagnostics,
      resolvedSchemaIds: [],
    };
  }

  const seenSchemaIds = new Set<string>();
  for (const activation of document.schemaRefs) {
    const id = parseSchemaId(activation.schema);
    if (seenSchemaIds.has(id)) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.duplicate_schema_ref',
          targetId: id,
          message: `Schema ${id} must be activated only once`,
        }),
      );
    }
    seenSchemaIds.add(id);
  }

  const resolved = buildSchemaRuntimeFromCatalog({
    catalog: buildSchemaVersionCatalogFromRegistry(schemaRegistry.modulesById),
    activations: document.schemaRefs,
  });
  const runtime = resolved.runtime;
  diagnostics.push(...explainMissingSchemas(resolved.diagnostics));

  const resolutionHasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (resolutionHasErrors || runtime.resolved.resolvedModules.length === 0) {
    return {
      ok: false,
      document,
      diagnostics: sortDiagnostics(diagnostics),
      resolvedSchemaIds: runtime.resolved.resolvedModuleIds,
    };
  }

  const effectiveSchema = runtime.resolved.effectiveSchema;
  diagnostics.push(...validateDocument(document, effectiveSchema, validationOptions));

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    ok: !sortedDiagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    document,
    diagnostics: sortedDiagnostics,
    effectiveSchema,
    resolvedSchemaIds: runtime.resolved.resolvedModuleIds,
  };
}

/** Missing schema errors are actionable; materialization/type errors are their consequences. */
export function explainMissingSchemas(diagnostics: Diagnostic[]): Diagnostic[] {
  const missing = diagnostics.filter(
    (item) => item.code === 'schema.resolution.missing_dependency',
  );
  if (!missing.length) return diagnostics;
  const seen = new Set<string>();
  return [...missing]
    .sort((a, b) => Number(b.message.includes('@')) - Number(a.message.includes('@')))
    .flatMap((item) => {
      const ref = item.message.replace(/^Missing schema dependency: /, '');
      const id = item.moduleId ?? parseSchemaId(ref);
      if (seen.has(id)) return [];
      seen.add(id);
      return [
        {
          ...item,
          message: `Schema ${ref} isn't available. Pass it with --schema <file> or --schema-source <dir>.`,
        },
      ];
    });
}
