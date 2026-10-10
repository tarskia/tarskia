import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, ValidationError } from './cli-errors';
import { resolveDefaultSchemaSource } from './default-assets';
import {
  assessSchemaValidation,
  buildRawSchemaSet,
  compileSourceGraph,
  type Diagnostic,
  diagramDiagnostic,
  getSchemaModuleRef,
  parseSchemaModuleYaml,
  parseSourceDocument,
  type SchemaModule,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  serializeDocument,
  serializeSourceDocument,
  validateDiagramYaml,
  validateSchemaModuleObject,
} from './semantic';
import {
  collectYamlFiles,
  explainMissingSchemas,
  type SchemaRegistry,
} from './semantic/schema-loader';
import { parseYamlText as parseYaml, YamlInputError, yamlInputDiagnostic } from './untrusted-yaml';

export type ValidateKind = 'auto' | 'diagram' | 'schema' | 'schema-registry';

export interface ValidateCliOptions {
  path: string;
  kind?: ValidateKind;
  schemaSource?: string;
  schemas?: string[];
  json?: boolean;
  strict?: boolean;
}

export interface ValidateDiagnostic {
  severity: Diagnostic['severity'];
  phase: Diagnostic['phase'];
  code: string;
  message: string;
  entityId?: string;
  relationId?: string;
  moduleId?: string;
  path?: string;
  hint?: string;
}

function serializeDiagnostics(diagnostics: Diagnostic[]): ValidateDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    phase: diagnostic.phase,
    code: diagnostic.code,
    message: diagnostic.message,
    entityId: diagnostic.entityId,
    relationId: diagnostic.relationId,
    moduleId: diagnostic.moduleId,
    path: diagnostic.path,
    hint: diagnostic.hint,
  }));
}

export interface ValidateCliResult {
  version: 1;
  ok: boolean;
  kind: Exclude<ValidateKind, 'auto'>;
  path: string;
  diagnostics: ValidateDiagnostic[];
  resolvedSchemaIds?: string[];
  dependencyRefs?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  return (await fs.stat(targetPath)).isDirectory();
}

async function detectValidateKind(
  targetPath: string,
  raw?: string,
): Promise<Exclude<ValidateKind, 'auto'>> {
  if (await pathIsDirectory(targetPath)) {
    const conventional = path.join(targetPath, 'src', 'schemas');
    if (
      await fs
        .stat(conventional)
        .then((entry) => entry.isDirectory())
        .catch(() => false)
    )
      return 'schema-registry';
    for (const file of await collectYamlFiles(targetPath)) {
      try {
        const value = parseYaml(await fs.readFile(file, 'utf8'));
        if (isRecord(value) && typeof value.owner === 'string' && typeof value.name === 'string')
          return 'schema-registry';
      } catch (error) {
        if (error instanceof YamlInputError) throw error;
        /* A malformed unrelated YAML file does not identify a registry. */
      }
    }
    throw new ConfigError(`can't tell what ${targetPath} is; pass --kind`);
  }
  const content = raw ?? (await fs.readFile(targetPath, 'utf8'));
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    if (error instanceof YamlInputError) throw error;
    // Let the document validator report YAML syntax errors with the same exit status
    // as explicit --kind diagram.
    return 'diagram';
  }
  if (!isRecord(parsed)) return 'diagram';
  if (Array.isArray(parsed.schemaRefs)) return 'diagram';
  if (typeof parsed.owner === 'string' && typeof parsed.name === 'string') return 'schema';
  throw new ValidationError([
    parseDiagnostic(
      `Could not auto-detect ${targetPath}; expected diagram schemaRefs or schema owner/name fields.`,
      targetPath,
    ),
  ]);
}

function parseDiagnostic(message: string, filePath: string): Diagnostic {
  return diagramDiagnostic({
    phase: 'parse',
    severity: 'error',
    code: 'schema.parse.invalid_schema',
    path: filePath,
    message,
  });
}

async function readSchemaModule(filePath: string): Promise<SchemaModule> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseSchemaModuleYaml(raw);
  if (!parsed.ok)
    throw new ValidationError(parsed.diagnostics.map((item) => ({ ...item, path: filePath })));
  const validated = validateSchemaModuleObject(parsed.value);
  if (!validated.ok || !validated.value)
    throw new ValidationError(validated.diagnostics.map((item) => ({ ...item, path: filePath })));
  return validated.value;
}

async function readRegistry(rootPath: string): Promise<{
  registry: SchemaRegistry;
  diagnostics: Diagnostic[];
  filesById: Map<string, string>;
}> {
  const schemaFiles = await collectYamlFiles(rootPath);
  if (schemaFiles.length === 0)
    throw new ConfigError(`no schema YAML files found under ${rootPath}`);
  const modulesById = new Map<string, SchemaModule>();
  const filesById = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const file of schemaFiles) {
    try {
      const module = await readSchemaModule(file);
      const ref = getSchemaModuleRef(module);
      if (modulesById.has(ref))
        diagnostics.push(parseDiagnostic(`Duplicate schema id: ${ref}`, file));
      else {
        modulesById.set(ref, module);
        filesById.set(ref, file);
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      diagnostics.push(...error.diagnostics);
    }
  }
  return {
    registry: { rootPath: path.resolve(rootPath), schemaFiles, modulesById },
    diagnostics,
    filesById,
  };
}

async function loadRegistryWithExtraSchemas(params: {
  schemaSource?: string;
  schemaFiles?: string[];
}): Promise<SchemaRegistry> {
  const schemaSource = params.schemaSource ?? resolveDefaultSchemaSource();
  const { registry, diagnostics, filesById } = await readRegistry(schemaSource);
  if (diagnostics.length) throw new ValidationError(diagnostics);
  for (const schemaFile of params.schemaFiles ?? []) {
    const module = await readSchemaModule(schemaFile);
    const id = getSchemaModuleRef(module);
    if (registry.modulesById.has(id))
      throw new ConfigError(
        `duplicate schema id ${id}: ${filesById.get(id)} and ${path.resolve(schemaFile)}`,
      );
    registry.modulesById.set(id, module);
    filesById.set(id, path.resolve(schemaFile));
    registry.schemaFiles.push(path.resolve(schemaFile));
  }
  return registry;
}

function formatDiagnostics(diagnostics: ValidateDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const target = diagnostic.path
        ? ` (${diagnostic.path})`
        : diagnostic.entityId
          ? ` (${diagnostic.entityId})`
          : diagnostic.relationId
            ? ` (${diagnostic.relationId})`
            : diagnostic.moduleId
              ? ` (${diagnostic.moduleId})`
              : '';
      return `- [${diagnostic.severity}] ${diagnostic.phase} ${diagnostic.code}: ${diagnostic.message}${target}`;
    })
    .join('\n');
}

async function validateDiagramFile(params: {
  targetPath: string;
  raw: string;
  schemaSource?: string;
  schemas?: string[];
  strict?: boolean;
}): Promise<ValidateCliResult> {
  const [raw, schemaRegistry] = await Promise.all([
    Promise.resolve(params.raw),
    loadRegistryWithExtraSchemas({
      schemaSource: params.schemaSource,
      schemaFiles: params.schemas,
    }),
  ]);
  const canonicalImportPath = (directory: string, slug: string) => {
    const candidate = path.resolve(directory, slug);
    if (path.extname(candidate)) return candidate;
    return (
      [candidate, `${candidate}.yaml`, `${candidate}.yml`].find((file) => existsSync(file)) ??
      `${candidate}.yaml`
    );
  };
  const prepareSource = (file: string, text: string) => {
    try {
      const source = parseSourceDocument(text);
      return serializeSourceDocument({
        ...source,
        imports: source.imports?.map((entry) => ({
          ...entry,
          slug: entry.slug.trim()
            ? canonicalImportPath(path.dirname(file), entry.slug)
            : entry.slug,
        })),
      });
    } catch (error) {
      if (error instanceof YamlInputError) throw error;
      return text;
    } // The shared compiler reports malformed source diagnostics.
  };
  let hasImports = false;
  try {
    hasImports = (parseSourceDocument(raw).imports?.length ?? 0) > 0;
  } catch (error) {
    if (error instanceof YamlInputError) throw error;
    /* Report via the document validator below. */
  }
  const compiled = hasImports
    ? compileSourceGraph({
        raw: prepareSource(params.targetPath, raw),
        sourceLabel: params.targetPath,
        resolver: {
          resolveImport: (file) => {
            try {
              return { slug: file, raw: prepareSource(file, readFileSync(file, 'utf8')) };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
              throw error;
            }
          },
        },
      })
    : undefined;
  if (compiled && !compiled.result)
    return {
      version: 1,
      ok: false,
      kind: 'diagram',
      path: path.resolve(params.targetPath),
      diagnostics: serializeDiagnostics(compiled.diagnostics),
    };
  const validation = validateDiagramYaml({
    yaml: compiled?.result ? serializeDocument(compiled.result.doc) : raw,
    schemaRegistry,
    validationOptions: params.strict
      ? STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS
      : undefined,
  });
  return {
    version: 1,
    ok: validation.ok && !(compiled?.diagnostics ?? []).some((item) => item.severity === 'error'),
    kind: 'diagram',
    path: path.resolve(params.targetPath),
    diagnostics: serializeDiagnostics([
      ...(compiled?.diagnostics ?? []),
      ...validation.diagnostics,
    ]),
    resolvedSchemaIds: validation.resolvedSchemaIds,
  };
}

async function validateSchemaFile(params: {
  targetPath: string;
  raw: string;
  schemaSource?: string;
  schemas?: string[];
}): Promise<ValidateCliResult> {
  const [raw, registry] = await Promise.all([
    Promise.resolve(params.raw),
    loadRegistryWithExtraSchemas({
      schemaSource: params.schemaSource,
      schemaFiles: (params.schemas ?? []).filter(
        (schemaFile) => path.resolve(schemaFile) !== path.resolve(params.targetPath),
      ),
    }),
  ]);
  const assessment = assessSchemaValidation({
    raw,
    rawSchemaSet: buildRawSchemaSet(Array.from(registry.modulesById.values())),
  });
  return {
    version: 1,
    ok: assessment.ok,
    kind: 'schema',
    path: path.resolve(params.targetPath),
    diagnostics: serializeDiagnostics(explainMissingSchemas(assessment.diagnostics)),
    dependencyRefs: assessment.dependencyRefs,
  };
}

async function validateSchemaRegistryDirectory(targetPath: string): Promise<ValidateCliResult> {
  const { registry, diagnostics } = await readRegistry(targetPath);
  const rawSchemaSet = buildRawSchemaSet(Array.from(registry.modulesById.values()));
  for (const schemaFile of registry.schemaFiles) {
    if (diagnostics.some((item) => item.path === schemaFile)) continue;
    const raw = await fs.readFile(schemaFile, 'utf8');
    diagnostics.push(
      ...explainMissingSchemas(assessSchemaValidation({ raw, rawSchemaSet }).diagnostics),
    );
  }
  return {
    version: 1,
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    kind: 'schema-registry',
    path: path.resolve(targetPath),
    diagnostics: serializeDiagnostics(diagnostics),
  };
}

export async function validateCli(options: ValidateCliOptions): Promise<ValidateCliResult> {
  const targetPath = path.resolve(options.path);
  let kind: Exclude<ValidateKind, 'auto'> =
    options.kind && options.kind !== 'auto' ? options.kind : 'diagram';
  try {
    const raw = (await pathIsDirectory(targetPath))
      ? undefined
      : await fs.readFile(targetPath, 'utf8');
    if (!options.kind || options.kind === 'auto') kind = await detectValidateKind(targetPath, raw);
    let result: ValidateCliResult;
    if (kind === 'diagram')
      result = await validateDiagramFile({
        targetPath,
        raw: raw ?? '',
        schemaSource: options.schemaSource,
        schemas: options.schemas,
        strict: options.strict,
      });
    else if (kind === 'schema')
      result = await validateSchemaFile({
        targetPath,
        raw: raw ?? '',
        schemaSource: options.schemaSource,
        schemas: options.schemas,
      });
    else result = await validateSchemaRegistryDirectory(targetPath);
    if (!result.ok && result.diagnostics.length === 0)
      result.diagnostics = serializeDiagnostics([
        parseDiagnostic('Validation failed without a usable document or schema.', targetPath),
      ]);
    return result;
  } catch (error) {
    if (error instanceof YamlInputError)
      error = new ValidationError([yamlInputDiagnostic(error, targetPath)]);
    if (error instanceof ValidationError)
      return {
        version: 1,
        ok: false,
        kind,
        path: targetPath,
        diagnostics: serializeDiagnostics(error.diagnostics),
      };
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
      throw new ConfigError(
        `file not found: ${(error as NodeJS.ErrnoException).path === targetPath ? options.path : (error as NodeJS.ErrnoException).path}`,
        { cause: error },
      );
    throw error;
  }
}

export async function runValidateCli(options: ValidateCliOptions): Promise<void> {
  const result = await validateCli(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`OK ${result.kind}: ${result.path}\n`);
  } else {
    process.stdout.write(
      `Invalid ${result.kind}: ${result.path}\n${formatDiagnostics(result.diagnostics)}\n`,
    );
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}
