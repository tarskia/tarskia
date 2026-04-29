import { type Diagnostic, sortDiagnostics } from '../diagnostics';
import { getSchemaModuleRef, parseSchemaRef } from '../schema-ref';
import { buildRawSchemaSet, type RawSchemaSet, type SchemaRuntime } from '../schema-runtime';
import type { SchemaModule, SemanticDocument } from '../types';
import { validateDiagramDoc } from './diagram';
import { parseSchemaModuleYaml, validateSchemaModuleObject } from './schema';
import {
  materializeSchemaClosure,
  resolveSchemaClosureFromCatalog,
  resolveSchemaClosureFromRawSet,
  type SchemaClosureResult,
  type SchemaVersionCatalog,
} from './schema-closure';
import { validateResolvedSchema } from './schema-resolved';

export type ValidationStageStatus = 'ok' | 'error' | 'skipped';

export interface ValidationStageResult<T> {
  status: ValidationStageStatus;
  diagnostics: Diagnostic[];
  value?: T;
}

export interface SchemaValidationAssessment {
  parse: ValidationStageResult<unknown>;
  authored: ValidationStageResult<SchemaModule>;
  closure: ValidationStageResult<SchemaClosureResult>;
  materialization: ValidationStageResult<SchemaRuntime>;
  resolved: ValidationStageResult<SchemaModule>;
  diagram?: ValidationStageResult<SemanticDocument>;
  diagnostics: Diagnostic[];
  ok: boolean;
  draftModule?: SchemaModule;
  runtime?: SchemaRuntime;
}

const SKIPPED_STAGE = Object.freeze({
  status: 'skipped' as const,
  diagnostics: [] as Diagnostic[],
});

const hasErrors = (diagnostics: Diagnostic[]) =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'error');

const collectDiagnostics = (...stages: Array<ValidationStageResult<unknown> | undefined>) =>
  sortDiagnostics(stages.flatMap((stage) => stage?.diagnostics ?? []));

export function assessSchemaValidation(params: {
  raw: string;
  baseRawSchemaSet?: RawSchemaSet;
  versionCatalog?: SchemaVersionCatalog;
  draftSchemaId?: string;
  draftVersion?: string;
  diagram?: SemanticDocument;
}): SchemaValidationAssessment {
  const { raw, baseRawSchemaSet, versionCatalog, draftSchemaId, draftVersion, diagram } = params;

  const parseResult = parseSchemaModuleYaml(raw);
  const parse: ValidationStageResult<unknown> = parseResult.ok
    ? { status: 'ok', diagnostics: [], value: parseResult.value }
    : { status: 'error', diagnostics: parseResult.diagnostics };
  if (!parseResult.ok) {
    return {
      parse,
      authored: SKIPPED_STAGE,
      closure: SKIPPED_STAGE,
      materialization: SKIPPED_STAGE,
      resolved: SKIPPED_STAGE,
      diagram: diagram ? SKIPPED_STAGE : undefined,
      diagnostics: collectDiagnostics(parse),
      ok: false,
    };
  }

  const authoredResult = validateSchemaModuleObject(parseResult.value);
  const authored: ValidationStageResult<SchemaModule> =
    authoredResult.ok && authoredResult.value
      ? { status: 'ok', diagnostics: [], value: authoredResult.value }
      : { status: 'error', diagnostics: authoredResult.diagnostics };
  if (!authoredResult.ok || !authoredResult.value) {
    return {
      parse,
      authored,
      closure: SKIPPED_STAGE,
      materialization: SKIPPED_STAGE,
      resolved: SKIPPED_STAGE,
      diagram: diagram ? SKIPPED_STAGE : undefined,
      diagnostics: collectDiagnostics(parse, authored),
      ok: false,
    };
  }

  const draftModule = authoredResult.value;
  const normalizedBaseRawSchemaSet = baseRawSchemaSet ?? buildRawSchemaSet([]);
  const closureResult = versionCatalog
    ? resolveSchemaClosureFromCatalog({
        root: {
          schemaId: draftSchemaId ?? getSchemaModuleRef(draftModule),
          version: draftVersion ?? draftModule.version,
          raw,
          module: draftModule,
        },
        catalog: versionCatalog,
      })
    : resolveSchemaClosureFromRawSet({
        rootModule: {
          ...draftModule,
          owner: parseSchemaRef(draftSchemaId ?? getSchemaModuleRef(draftModule)).owner,
          name: parseSchemaRef(draftSchemaId ?? getSchemaModuleRef(draftModule)).name,
          version: draftVersion ?? draftModule.version,
        },
        rawSchemaSet: normalizedBaseRawSchemaSet,
      });
  const closure: ValidationStageResult<SchemaClosureResult> = closureResult.ok
    ? { status: 'ok', diagnostics: closureResult.diagnostics, value: closureResult }
    : { status: 'error', diagnostics: closureResult.diagnostics };
  if (!closureResult.ok) {
    return {
      parse,
      authored,
      closure,
      materialization: SKIPPED_STAGE,
      resolved: SKIPPED_STAGE,
      diagram: diagram ? SKIPPED_STAGE : undefined,
      diagnostics: collectDiagnostics(parse, authored, closure),
      ok: false,
      draftModule,
    };
  }

  const materializedResult = materializeSchemaClosure({ closure: closureResult });
  const materialization: ValidationStageResult<SchemaRuntime> =
    materializedResult.ok && materializedResult.runtime
      ? {
          status: 'ok',
          diagnostics: materializedResult.diagnostics,
          value: materializedResult.runtime,
        }
      : {
          status: 'error',
          diagnostics: materializedResult.diagnostics,
        };
  if (!materializedResult.ok || !materializedResult.runtime) {
    return {
      parse,
      authored,
      closure,
      materialization,
      resolved: SKIPPED_STAGE,
      diagram: diagram ? SKIPPED_STAGE : undefined,
      diagnostics: collectDiagnostics(parse, authored, closure, materialization),
      ok: false,
      draftModule,
    };
  }

  const resolvedDiagnostics = validateResolvedSchema(
    materializedResult.runtime.resolved.effectiveSchema,
  );
  const resolved: ValidationStageResult<SchemaModule> = hasErrors(resolvedDiagnostics)
    ? { status: 'error', diagnostics: resolvedDiagnostics }
    : {
        status: 'ok',
        diagnostics: resolvedDiagnostics,
        value: materializedResult.runtime.resolved.effectiveSchema,
      };

  const diagramResult =
    diagram && resolved.status === 'ok' && resolved.value
      ? validateDiagramDoc(diagram, resolved.value)
      : undefined;
  const diagramStage: ValidationStageResult<SemanticDocument> | undefined = diagram
    ? !diagramResult
      ? SKIPPED_STAGE
      : diagramResult.ok && diagramResult.value
        ? { status: 'ok', diagnostics: [], value: diagramResult.value }
        : { status: 'error', diagnostics: diagramResult.diagnostics }
    : undefined;

  const diagnostics = collectDiagnostics(
    parse,
    authored,
    closure,
    materialization,
    resolved,
    diagramStage,
  );

  return {
    parse,
    authored,
    closure,
    materialization,
    resolved,
    diagram: diagramStage,
    diagnostics,
    ok: resolved.status === 'ok',
    draftModule,
    runtime: materializedResult.runtime,
  };
}
