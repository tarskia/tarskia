import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version as cliVersion } from '../package.json';
import {
  buildSchemaFlowCatalog,
  renderSchemaFlowCatalogForPrompt,
  type SchemaFlowCatalog,
} from './advanced/schema-flow-catalog';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from './artifacts';
import { ConfigError } from './cli-errors';
import {
  CodexGeneratedSchemaAgent,
  type GeneratedSchemaAgent,
} from './codex/generated-schema-agent';
import { buildDiagramPromptPackage } from './codex/prompt-package';
import { findTurnBudgetError } from './codex/turn-policy';
import { deriveRepoName, slugifyKebab } from './gallery-identity';
import type { Logger } from './logger';
import type { ReasoningEffort } from './reasoning-effort';
import {
  buildQualifiedSchemaObjectId,
  buildSchemaActivation,
  buildSchemaRef,
  compileSchemaSemantics,
  type Diagnostic,
  getResolvedTypeSemantics,
  getSchemaModuleRef,
  isSchemaNameSlug,
  parseSchema,
  parseSchemaModuleYaml,
  type parseSchemaRef,
  resolveTypeDef,
  type SchemaModule,
  schemaDiagnostic,
  serializeSchemaModule,
  validateSchemaModuleObject,
} from './semantic';
import { buildDiagramSynthesisContract } from './semantic/diagram-synthesis-contract';
import { loadSchemaRegistry, resolveSchemaDirectory } from './semantic/schema-loader';
import {
  assessSchemaValidation,
  buildSchemaVersionCatalogFromRegistry,
  omitSchemaVersionCatalogEntry,
} from './semantic/schema-validation';
import type { PreparedWorkspace } from './workspace';
import { writeFileAtomic } from './write-file-atomic';

const GENERATED_SCHEMA_VERSION = '0.1';
const MAX_SCHEMA_REPAIR_ATTEMPTS = 3;
const CONTAINER_TRAIT_ID = 'core/base.traits.container';
const GENERATED_SCHEMA_VALIDATION_HELPER_ARTIFACT =
  'generated-schema/validate-generated-schema.mjs';

export interface GeneratedSchemaResult {
  status: 'not-requested' | 'succeeded' | 'failed';
  schemaId: string;
  schemaRef: string;
  artifactPath: string | null;
  repaired: boolean;
  reused: boolean;
  usedByDiagram: boolean;
  threadId: string | null;
  diagnostics: Diagnostic[];
  failureMessage: string | null;
}

export interface PrepareGeneratedSchemaOptions {
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  schemaId: string;
  logger: Logger;
  resumeDraft?: boolean;
  resume?: {
    artifactPath?: string | null;
    status?: 'succeeded' | 'failed' | 'not-requested' | null;
  };
}

export function deriveGeneratedSchemaId(repo: string, explicitSchemaId?: string): string {
  const normalized = explicitSchemaId?.trim();
  const parts = normalized?.split('/');
  if (parts && (parts.length > 2 || (parts.length === 2 && parts[0] !== 'repo'))) {
    throw new ConfigError(
      `Invalid schema id "${explicitSchemaId}": expected repo/<name> or <name>.`,
    );
  }
  const name = slugifyKebab(parts ? parts.at(-1)! : deriveRepoName(repo));
  if (!name) throw new ConfigError('Cannot derive a schema name; pass --schema-id repo/<name>.');
  return `repo/${name}`;
}

function parseGeneratedSchemaId(schemaId: string): ReturnType<typeof parseSchemaRef> {
  const [owner, name, ...extra] = schemaId.trim().split('/');
  if (extra.length > 0 || owner !== 'repo' || !name || !isSchemaNameSlug(name)) {
    throw new ConfigError(
      `Invalid schema id "${schemaId}": expected repo/<name> with a kebab-case name.`,
    );
  }
  return { owner, name };
}

export async function assertGeneratedSchemaIdAvailable(
  schemaId: string,
  source: string,
): Promise<void> {
  const registry = await loadSchemaRegistry(source);
  if (registry.modulesById.has(schemaId)) {
    throw new ConfigError(
      `schema id ${schemaId} already exists in ${source}; pass a different --schema-id.`,
    );
  }
}

export function buildGeneratedSchemaRef(schemaId: string): string {
  return buildSchemaRef(parseGeneratedSchemaId(schemaId), GENERATED_SCHEMA_VERSION);
}

async function schemaRepoOutputPath(
  workspace: PreparedWorkspace,
  schemaId: string,
): Promise<string> {
  const parsed = parseGeneratedSchemaId(schemaId);
  const registry = await loadSchemaRegistry(workspace.schemaRepoPath);
  if (registry.modulesById.has(schemaId)) {
    // Reuse the installed path so upgrading an old job cannot create duplicate IDs.
    for (const schemaFile of registry.schemaFiles) {
      const module = parseSchema(await fs.readFile(schemaFile, 'utf8'));
      if (getSchemaModuleRef(module) === schemaId) {
        return schemaFile;
      }
    }
  }
  const schemaDirectory = await resolveSchemaDirectory(workspace.schemaRepoPath);
  return path.join(schemaDirectory, parsed.owner, `${parsed.name}.yaml`);
}

async function writeSchemaIntoWorkspace(
  workspace: PreparedWorkspace,
  schemaId: string,
  rawSchema: string,
): Promise<void> {
  const schemaPath = await schemaRepoOutputPath(workspace, schemaId);
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  await writeFileAtomic(schemaPath, rawSchema.endsWith('\n') ? rawSchema : `${rawSchema}\n`);
  const installedValidation = await validateGeneratedSchemaCandidate({
    rawSchema,
    schemaRegistryRoot: workspace.schemaRepoPath,
    schemaId,
  });
  if (!installedValidation.ok) {
    throw new Error(
      `Installed generated schema ${schemaId} did not resolve: ${installedValidation.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message)
        .join('; ')}`,
    );
  }
}

function normalizeDraftModule(module: SchemaModule, schemaId: string): SchemaModule {
  const parsed = parseGeneratedSchemaId(schemaId);
  return {
    ...module,
    owner: parsed.owner,
    name: parsed.name,
    version: GENERATED_SCHEMA_VERSION,
  };
}

function rewriteSelfQualifiedRefs(
  rawSchema: string,
  fromSchemaId: string,
  toSchemaId: string,
): string {
  if (fromSchemaId === toSchemaId) {
    return rawSchema;
  }
  return rawSchema
    .replaceAll(`${fromSchemaId}.`, `${toSchemaId}.`)
    .replaceAll(`${fromSchemaId}@`, `${toSchemaId}@`);
}

function buildGeneratedSchemaModelingDiagnostics(params: {
  module: SchemaModule;
  effectiveSchema: SchemaModule;
  targetSchemaId: string;
}): Diagnostic[] {
  const semantics = compileSchemaSemantics(params.effectiveSchema);
  const diagnostics: Diagnostic[] = [];
  const nameIncludes = (type: SchemaModule['types'][number], terms: string[]) =>
    terms.some((term) =>
      [type.id, type.label]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term)),
    );
  const hasParticipation = (
    typeSemantics: NonNullable<ReturnType<typeof getResolvedTypeSemantics>>,
    endpoint: 'from' | 'to',
  ) =>
    typeSemantics.relationParticipation.some((participation) =>
      endpoint === 'from' ? participation.from : participation.to,
    );

  for (const type of params.module.types) {
    const qualifiedTypeId = buildQualifiedSchemaObjectId(params.targetSchemaId, 'types', type.id);
    const resolvedType = resolveTypeDef(params.effectiveSchema, qualifiedTypeId);
    const typeSemantics = getResolvedTypeSemantics(semantics, qualifiedTypeId);
    if (!typeSemantics || !resolvedType) continue;

    const isContainer =
      typeSemantics.traitClosure.includes(CONTAINER_TRAIT_ID) ||
      Boolean(
        resolvedType.containment?.allowedChildTypes?.length ||
          resolvedType.containment?.allowedChildTraits?.length,
      );

    if (
      resolvedType?.analysis?.topLevelBias === 'prefer' &&
      typeSemantics.expectations.flowRole === 'none' &&
      !typeSemantics.expectations.mayTerminate &&
      isContainer
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.preferred_top_level_type_missing_flow',
          targetId: qualifiedTypeId,
          message: `Generated type ${qualifiedTypeId} has analysis.topLevelBias=prefer but no trait-derived flow semantics`,
          hint: 'Attach a repo-specific trait with analysis.flowType, relationParticipation, and expectedRelationIds when useful, or remove analysis.topLevelBias=prefer from a purely organizational wrapper.',
        }),
      );
    }

    if (
      typeSemantics.expectations.flowRole === 'source' &&
      !hasParticipation(typeSemantics, 'from')
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.source_type_missing_egress_participation',
          targetId: qualifiedTypeId,
          message: `Generated source type ${qualifiedTypeId} has no outgoing relationParticipation`,
        }),
      );
    }
    if (typeSemantics.expectations.flowRole === 'sink' && !hasParticipation(typeSemantics, 'to')) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.sink_type_missing_ingress_participation',
          targetId: qualifiedTypeId,
          message: `Generated sink type ${qualifiedTypeId} has no incoming relationParticipation`,
        }),
      );
    }
    if (
      typeSemantics.expectations.flowRole === 'through' &&
      (!hasParticipation(typeSemantics, 'from') || !hasParticipation(typeSemantics, 'to'))
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.through_type_missing_bidirectional_participation',
          targetId: qualifiedTypeId,
          message: `Generated flow-through type ${qualifiedTypeId} should participate in both ingress and egress relations`,
        }),
      );
    }

    if (
      nameIncludes(type, ['scheduler', 'schedule', 'cron']) &&
      typeSemantics.expectations.flowRole !== 'source'
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.scheduler_like_type_not_source',
          targetId: qualifiedTypeId,
          message: `Generated scheduler-like type ${qualifiedTypeId} is not a source`,
        }),
      );
    }
    if (
      nameIncludes(type, ['queue', 'topic', 'stream', 'channel']) &&
      typeSemantics.expectations.flowRole !== 'through'
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.queue_like_type_not_through',
          targetId: qualifiedTypeId,
          message: `Generated queue/topic-like type ${qualifiedTypeId} is not flow-through`,
        }),
      );
    }
    if (
      nameIncludes(type, ['storage', 'store', 'database', 'db', 'persistence', 'cache']) &&
      typeSemantics.expectations.flowRole !== 'sink'
    ) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'warning',
          code: 'schema.generated.storage_like_type_not_sink',
          targetId: qualifiedTypeId,
          message: `Generated storage-like type ${qualifiedTypeId} is not a sink`,
        }),
      );
    }
  }

  return diagnostics;
}

function buildGeneratedSchemaValidationHelperScript(schemaId: string): string {
  const cliPath = fileURLToPath(import.meta.url);
  return [
    "import { spawn } from 'node:child_process';",
    '',
    `const cliPath = ${JSON.stringify(cliPath)};`,
    '',
    'const child = spawn(process.execPath, [',
    '  cliPath,',
    "  'internal',",
    "  'validate-generated-schema',",
    "  '--job-root',",
    '  process.cwd(),',
    "  '--schema-id',",
    `  ${JSON.stringify(schemaId)},`,
    "], { stdio: ['pipe', 'pipe', 'pipe'] });",
    '',
    'process.stdin.pipe(child.stdin);',
    'child.stdout.pipe(process.stdout);',
    'child.stderr.pipe(process.stderr);',
    "child.on('exit', (code) => process.exit(code ?? 1));",
  ].join('\n');
}

export async function validateGeneratedSchemaCandidate(params: {
  rawSchema: string;
  schemaRegistryRoot: string;
  schemaId: string;
}): Promise<{
  ok: boolean;
  rawSchema: string;
  diagnostics: Diagnostic[];
  flowDiagnostics: Diagnostic[];
  flowCatalog?: SchemaFlowCatalog;
}> {
  const parsedDraft = parseSchemaModuleYaml(params.rawSchema);
  if (!parsedDraft.ok) {
    return {
      ok: false,
      rawSchema: params.rawSchema,
      diagnostics: parsedDraft.diagnostics,
      flowDiagnostics: [],
    };
  }
  const authoredDraft = validateSchemaModuleObject(parsedDraft.value);
  if (!authoredDraft.ok || !authoredDraft.value) {
    return {
      ok: false,
      rawSchema: params.rawSchema,
      diagnostics: authoredDraft.diagnostics,
      flowDiagnostics: [],
    };
  }

  const schemaRegistry = await loadSchemaRegistry(params.schemaRegistryRoot);
  const catalog = omitSchemaVersionCatalogEntry(
    await buildSchemaVersionCatalogFromRegistry(schemaRegistry),
    params.schemaId,
  );
  const normalizedRaw = rewriteSelfQualifiedRefs(
    serializeSchemaModule(normalizeDraftModule(authoredDraft.value, params.schemaId)),
    getSchemaModuleRef(authoredDraft.value),
    params.schemaId,
  );
  const normalizedAssessment = assessSchemaValidation({
    raw: normalizedRaw,
    catalog,
    draftSchemaId: params.schemaId,
    draftVersion: GENERATED_SCHEMA_VERSION,
  });
  const schemaRef = buildGeneratedSchemaRef(params.schemaId);
  const flowCatalog = normalizedAssessment.runtime?.resolved.effectiveSchema
    ? buildSchemaFlowCatalog({
        schema: normalizedAssessment.runtime.resolved.effectiveSchema,
        semantics: normalizedAssessment.runtime.semantics,
        activeSchemaRefs: [buildSchemaActivation(schemaRef, 0)],
      })
    : undefined;
  const flowDiagnostics =
    normalizedAssessment.draftModule && normalizedAssessment.runtime?.resolved.effectiveSchema
      ? buildGeneratedSchemaModelingDiagnostics({
          module: normalizedAssessment.draftModule,
          effectiveSchema: normalizedAssessment.runtime.resolved.effectiveSchema,
          targetSchemaId: params.schemaId,
        })
      : [];
  return {
    ok: normalizedAssessment.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    rawSchema: normalizedRaw,
    diagnostics: [...normalizedAssessment.diagnostics, ...flowDiagnostics],
    flowDiagnostics,
    flowCatalog,
  };
}

export class GeneratedSchemaService {
  private readonly agent?: GeneratedSchemaAgent;

  constructor(dependencies: { agent?: GeneratedSchemaAgent } = {}) {
    this.agent = dependencies.agent;
  }

  private resolveAgent(model?: string, reasoningEffort?: ReasoningEffort): GeneratedSchemaAgent {
    return (
      this.agent ?? new CodexGeneratedSchemaAgent({ model, modelReasoningEffort: reasoningEffort })
    );
  }

  async prepareGeneratedSchema(
    options: PrepareGeneratedSchemaOptions,
  ): Promise<GeneratedSchemaResult> {
    const schemaRef = buildGeneratedSchemaRef(options.schemaId);
    const parsed = parseGeneratedSchemaId(options.schemaId);
    const artifactRelativePath = path.join('generated-schema', `${parsed.name}.yaml`);
    const artifactAbsolutePath = path.join(
      options.workspace.workspaceOutputDir,
      artifactRelativePath,
    );

    if (options.resume?.status === 'succeeded' && options.resume.artifactPath) {
      try {
        const resumedRaw = await fs.readFile(options.resume.artifactPath, 'utf8');
        const resumedValidation = await validateGeneratedSchemaCandidate({
          rawSchema: resumedRaw,
          schemaRegistryRoot: options.workspace.schemaRepoPath,
          schemaId: options.schemaId,
        });
        if (resumedValidation.ok) {
          await writeSchemaIntoWorkspace(
            options.workspace,
            options.schemaId,
            resumedValidation.rawSchema,
          );
          return {
            status: 'succeeded',
            schemaId: options.schemaId,
            schemaRef,
            artifactPath: options.resume.artifactPath,
            repaired: false,
            reused: true,
            usedByDiagram: false,
            threadId: null,
            diagnostics: [],
            failureMessage: null,
          };
        }
      } catch {
        // Fall through to regeneration when the target repo is available.
      }
    }

    await assertGeneratedSchemaIdAvailable(options.schemaId, options.workspace.schemaRepoPath);
    const schemaRegistry = await loadSchemaRegistry(options.workspace.schemaRepoPath);
    const promptPackage = buildDiagramPromptPackage(buildDiagramSynthesisContract(schemaRegistry));
    const agent = this.resolveAgent(options.model, options.reasoningEffort);
    const validationCommand = `node out/${GENERATED_SCHEMA_VALIDATION_HELPER_ARTIFACT}`;
    await writeWorkspaceArtifact(
      options.workspace,
      GENERATED_SCHEMA_VALIDATION_HELPER_ARTIFACT,
      buildGeneratedSchemaValidationHelperScript(options.schemaId),
    );
    let currentYaml = '';
    let hasDraft = false;
    let repaired = false;
    let threadId: string | null = null;
    let diagnostics: Diagnostic[] = [];
    let flowReviewAttempted = false;
    let hardRepairAttemptCount = 0;
    const checkpointName = path.join('generated-schema', `${parsed.name}.checkpoint.json`);
    const fingerprint = JSON.stringify({
      format: 1,
      cliVersion,
      schemaId: options.schemaId,
      repoRevision: options.workspace.repoRevision,
      schemaSourceRevision: options.workspace.schemaSourceRevision ?? null,
    });
    if (options.resumeDraft) {
      try {
        const saved = JSON.parse(
          await fs.readFile(
            path.join(options.workspace.workspaceOutputDir, checkpointName),
            'utf8',
          ),
        );
        if (
          saved?.fingerprint === fingerprint &&
          typeof saved.yaml === 'string' &&
          Number.isSafeInteger(saved.hardRepairAttemptCount) &&
          saved.hardRepairAttemptCount >= 0 &&
          saved.hardRepairAttemptCount <= MAX_SCHEMA_REPAIR_ATTEMPTS &&
          typeof saved.flowReviewAttempted === 'boolean'
        ) {
          currentYaml = saved.yaml;
          hasDraft = true;
          hardRepairAttemptCount = saved.hardRepairAttemptCount;
          flowReviewAttempted = saved.flowReviewAttempted;
          repaired = hardRepairAttemptCount > 0 || flowReviewAttempted;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          options.logger.warn(
            'Recomputing generated schema: saved draft checkpoint could not be read.',
          );
        }
      }
    }
    const checkpoint = () =>
      writeWorkspaceJsonArtifact(options.workspace, checkpointName, {
        fingerprint,
        yaml: currentYaml,
        hardRepairAttemptCount,
        flowReviewAttempted,
      });

    const writeFailureArtifacts = async (attempt: number, rawSchema: string) => {
      await writeWorkspaceArtifact(
        options.workspace,
        path.join('generated-schema', `${parsed.name}.attempt-${attempt}.yaml`),
        rawSchema,
      );
      await writeWorkspaceJsonArtifact(
        options.workspace,
        path.join('generated-schema', `${parsed.name}.attempt-${attempt}.diagnostics.json`),
        diagnostics,
      );
    };
    const writeFlowArtifacts = async (validation: {
      flowCatalog?: SchemaFlowCatalog;
      flowDiagnostics: Diagnostic[];
    }) => {
      if (validation.flowCatalog) {
        await writeWorkspaceJsonArtifact(
          options.workspace,
          path.join('generated-schema', `${parsed.name}.flow-catalog.json`),
          validation.flowCatalog,
        );
        await writeWorkspaceArtifact(
          options.workspace,
          path.join('generated-schema', `${parsed.name}.flow-catalog.md`),
          `${renderSchemaFlowCatalogForPrompt(validation.flowCatalog)}\n`,
        );
      }
      if (validation.flowDiagnostics.length > 0) {
        await writeWorkspaceJsonArtifact(
          options.workspace,
          path.join('generated-schema', `${parsed.name}.flow-diagnostics.json`),
          validation.flowDiagnostics,
        );
      }
    };

    try {
      if (!hasDraft) {
        const draft = await agent.draftGeneratedSchema({
          workspaceRoot: options.workspace.jobRoot,
          targetRepoPath: options.workspace.targetRepoPath,
          schemaRepoPath: options.workspace.schemaRepoPath,
          repoUrl: options.repo,
          ref: options.ref,
          repoRevision: options.workspace.repoRevision,
          schemaId: options.schemaId,
          schemaRef,
          promptPackage,
          validationCommand,
        });
        currentYaml = draft.yaml;
        threadId = draft.threadId;
        await checkpoint();
      }

      let validationAttempt = 0;
      while (true) {
        const validation = await validateGeneratedSchemaCandidate({
          rawSchema: currentYaml,
          schemaRegistryRoot: options.workspace.schemaRepoPath,
          schemaId: options.schemaId,
        });
        const attempt = validationAttempt;
        validationAttempt += 1;
        diagnostics = validation.diagnostics;
        await writeFlowArtifacts(validation);
        if (validation.ok) {
          if (validation.flowDiagnostics.length > 0 && !flowReviewAttempted) {
            const repairedTurn = await agent.repairGeneratedSchema({
              workspaceRoot: options.workspace.jobRoot,
              targetRepoPath: options.workspace.targetRepoPath,
              schemaRepoPath: options.workspace.schemaRepoPath,
              repoUrl: options.repo,
              ref: options.ref,
              repoRevision: options.workspace.repoRevision,
              schemaId: options.schemaId,
              schemaRef,
              promptPackage,
              validationCommand,
              previousYaml: validation.rawSchema,
              diagnostics: validation.flowDiagnostics,
              schemaFlowCatalog: validation.flowCatalog,
            });
            currentYaml = repairedTurn.yaml;
            threadId = repairedTurn.threadId;
            flowReviewAttempted = true;
            repaired = true;
            await checkpoint();
            continue;
          }
          await writeSchemaIntoWorkspace(options.workspace, options.schemaId, validation.rawSchema);
          const artifactPath = await writeWorkspaceArtifact(
            options.workspace,
            artifactRelativePath,
            validation.rawSchema,
          );
          return {
            status: 'succeeded',
            schemaId: options.schemaId,
            schemaRef,
            artifactPath,
            repaired,
            reused: false,
            usedByDiagram: false,
            threadId,
            diagnostics: [],
            failureMessage: null,
          };
        }

        await writeFailureArtifacts(attempt, currentYaml);
        if (hardRepairAttemptCount >= MAX_SCHEMA_REPAIR_ATTEMPTS) break;

        const repairedTurn = await agent.repairGeneratedSchema({
          workspaceRoot: options.workspace.jobRoot,
          targetRepoPath: options.workspace.targetRepoPath,
          schemaRepoPath: options.workspace.schemaRepoPath,
          repoUrl: options.repo,
          ref: options.ref,
          repoRevision: options.workspace.repoRevision,
          schemaId: options.schemaId,
          schemaRef,
          promptPackage,
          validationCommand,
          previousYaml: currentYaml,
          diagnostics,
          schemaFlowCatalog: validation.flowCatalog,
        });
        currentYaml = repairedTurn.yaml;
        threadId = repairedTurn.threadId;
        hardRepairAttemptCount += 1;
        repaired = true;
        await checkpoint();
      }
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      options.logger.warn(`Generated schema failed for ${schemaRef}: ${message}`);
      return {
        status: 'failed',
        schemaId: options.schemaId,
        schemaRef,
        artifactPath: (await fs
          .stat(artifactAbsolutePath)
          .then(() => artifactAbsolutePath)
          .catch(() => null)) as string | null,
        repaired,
        reused: false,
        usedByDiagram: false,
        threadId,
        diagnostics,
        failureMessage: message,
      };
    }

    const failureMessage =
      diagnostics[0]?.message ?? `Failed to validate generated schema ${schemaRef}`;
    options.logger.warn(`Generated schema ${schemaRef} failed validation`);
    return {
      status: 'failed',
      schemaId: options.schemaId,
      schemaRef,
      artifactPath: (await fs
        .stat(artifactAbsolutePath)
        .then(() => artifactAbsolutePath)
        .catch(() => null)) as string | null,
      repaired,
      reused: false,
      usedByDiagram: false,
      threadId,
      diagnostics,
      failureMessage,
    };
  }
}
