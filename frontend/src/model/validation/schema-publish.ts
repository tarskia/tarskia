import type { Diagnostic } from '../diagnostics';
import { assessSchemaValidation } from './schema-assessment';
import type { SchemaClosureRoot, SchemaVersionCatalog } from './schema-closure';
import {
  assessResolvedSchemaCompatibility,
  type SchemaCompatibilityBump,
  type SchemaCompatibilityChange,
} from './schema-compatibility';
import { dedupeDiagnostics } from './schema-resolved';
import { summarizeSchemaModule } from './schema-summary';

export interface SchemaPublishAssessmentSnapshot {
  summaryLines: string[];
}

export interface SchemaPublishAssessment {
  ok: boolean;
  mode: 'initial' | 'update';
  assessedAt: string;
  previousVersion?: string;
  previousDependencyRefs: string[];
  nextDependencyRefs: string[];
  backwardCompatible: boolean;
  recommendedBump: SchemaCompatibilityBump;
  hasEffectiveChanges: boolean;
  breakingChangeCount: number;
  nonBreakingChangeCount: number;
  changes: SchemaCompatibilityChange[];
  briefSummary: string[];
  diagnostics: Diagnostic[];
  breakingChanges: string[];
  nonBreakingChanges: string[];
}

export function assessSchemaPublishability(params: {
  catalog: SchemaVersionCatalog;
  next: SchemaClosureRoot;
  previous?: SchemaClosureRoot;
  now?: string;
}): SchemaPublishAssessment {
  const { catalog, next, previous, now = new Date().toISOString() } = params;
  const nextAssessment = assessSchemaValidation({
    raw: next.raw,
    versionCatalog: catalog,
    draftSchemaId: next.schemaId,
    draftVersion: next.version,
  });
  const nextClosure = nextAssessment.closure.value;
  const nextRuntime = nextAssessment.runtime;
  const mode = previous ? 'update' : 'initial';
  const nextDiagnostics = nextAssessment.diagnostics;

  if (!nextAssessment.ok || !nextClosure || !nextRuntime) {
    return {
      ok: false,
      mode,
      assessedAt: now,
      previousVersion: previous?.version,
      previousDependencyRefs: [],
      nextDependencyRefs: nextClosure?.dependencyRefs ?? [],
      backwardCompatible: false,
      recommendedBump: 'none',
      hasEffectiveChanges: false,
      breakingChangeCount: 0,
      nonBreakingChangeCount: 0,
      changes: [],
      briefSummary: ['Publish blocked'],
      diagnostics: nextDiagnostics,
      breakingChanges: [],
      nonBreakingChanges: [],
    };
  }

  if (!previous) {
    const briefSummary = summarizeSchemaModule(
      nextAssessment.draftModule ?? next.module,
    ).summaryLines;
    return {
      ok: true,
      mode: 'initial',
      assessedAt: now,
      previousDependencyRefs: [],
      nextDependencyRefs: nextClosure.dependencyRefs,
      backwardCompatible: true,
      recommendedBump: 'none',
      hasEffectiveChanges: true,
      breakingChangeCount: 0,
      nonBreakingChangeCount: 0,
      changes: [],
      briefSummary,
      diagnostics: nextDiagnostics,
      breakingChanges: [],
      nonBreakingChanges: [],
    };
  }

  const previousAssessment = assessSchemaValidation({
    raw: previous.raw,
    versionCatalog: catalog,
    draftSchemaId: previous.schemaId,
    draftVersion: previous.version,
  });
  const previousClosure = previousAssessment.closure.value;
  const previousRuntime = previousAssessment.runtime;
  const diagnostics = dedupeDiagnostics([...previousAssessment.diagnostics, ...nextDiagnostics]);

  if (!previousAssessment.ok || !previousClosure || !previousRuntime) {
    return {
      ok: false,
      mode: 'update',
      assessedAt: now,
      previousVersion: previous.version,
      previousDependencyRefs: previousClosure?.dependencyRefs ?? [],
      nextDependencyRefs: nextClosure.dependencyRefs,
      backwardCompatible: false,
      recommendedBump: 'none',
      hasEffectiveChanges: false,
      breakingChangeCount: 0,
      nonBreakingChangeCount: 0,
      changes: [],
      briefSummary: ['Publish blocked'],
      diagnostics,
      breakingChanges: [],
      nonBreakingChanges: [],
    };
  }

  const compatibility = assessResolvedSchemaCompatibility({
    previous: previousRuntime.resolved.effectiveSchema,
    next: nextRuntime.resolved.effectiveSchema,
  });
  return {
    ok: true,
    mode: 'update',
    assessedAt: now,
    previousVersion: previous.version,
    previousDependencyRefs: previousClosure.dependencyRefs,
    nextDependencyRefs: nextClosure.dependencyRefs,
    backwardCompatible: compatibility.backwardCompatible,
    recommendedBump: compatibility.recommendedBump,
    hasEffectiveChanges: compatibility.hasChanges,
    breakingChangeCount: compatibility.breakingChanges.length,
    nonBreakingChangeCount: compatibility.nonBreakingChanges.length,
    changes: compatibility.changes,
    briefSummary: compatibility.briefSummary,
    diagnostics,
    breakingChanges: compatibility.breakingChanges,
    nonBreakingChanges: compatibility.nonBreakingChanges,
  };
}
