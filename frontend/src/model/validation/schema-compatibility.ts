import { buildSchemaActivationMap } from '@tarskia/diagram-semantics';
import { getSchemaModuleRef } from '../schema-ref';
import {
  buildDefaultSchemaActivation,
  buildRawSchemaSet,
  buildSchemaRuntime,
  type RawSchemaSet,
} from '../schema-runtime';
import type { SchemaModule } from '../types';
import { prioritizeSchemaChanges } from './schema-change-priority';
import { renderSchemaChangelog } from './schema-changelog';
import { classifySchemaDiff } from './schema-compatibility-rules';
import type { SchemaCompatibilityAssessment } from './schema-compatibility-types';
import { extractSchemaDiff } from './schema-diff';

export type {
  SchemaCompatibilityAssessment,
  SchemaCompatibilityBump,
  SchemaCompatibilityChange,
  SchemaCompatibilityChangeOperation,
  SchemaCompatibilityChangeSeverity,
  SchemaCompatibilityChangeSubject,
} from './schema-compatibility-types';

const compareSchemas = (
  previous: SchemaModule,
  next: SchemaModule,
): SchemaCompatibilityAssessment => {
  const rawDiff = extractSchemaDiff(previous, next);
  const classifiedChanges = classifySchemaDiff(rawDiff);
  const prioritizedChanges = prioritizeSchemaChanges(classifiedChanges);
  const changelog = renderSchemaChangelog(prioritizedChanges);

  return {
    backwardCompatible: changelog.breakingChanges.length === 0,
    recommendedBump:
      changelog.breakingChanges.length > 0
        ? 'major'
        : changelog.nonBreakingChanges.length > 0
          ? 'minor'
          : 'none',
    hasChanges: changelog.breakingChanges.length > 0 || changelog.nonBreakingChanges.length > 0,
    ...changelog,
  };
};

export function assessResolvedSchemaCompatibility(params: {
  previous: SchemaModule;
  next: SchemaModule;
}): SchemaCompatibilityAssessment {
  return compareSchemas(params.previous, params.next);
}

export function assessSchemaModuleCompatibility(params: {
  previousModule: SchemaModule;
  nextModule: SchemaModule;
  baseRawSchemaSet?: RawSchemaSet;
  previousBaseRawSchemaSet?: RawSchemaSet;
  nextBaseRawSchemaSet?: RawSchemaSet;
}): SchemaCompatibilityAssessment {
  const {
    previousModule,
    nextModule,
    baseRawSchemaSet,
    previousBaseRawSchemaSet,
    nextBaseRawSchemaSet,
  } = params;
  const previousBase = previousBaseRawSchemaSet ?? baseRawSchemaSet;
  const nextBase = nextBaseRawSchemaSet ?? baseRawSchemaSet;
  const previousRaw = buildRawSchemaSet([
    ...(previousBase
      ? previousBase.moduleIds
          .filter((moduleId) => moduleId !== getSchemaModuleRef(previousModule))
          .map((moduleId) => previousBase.modulesById.get(moduleId))
          .filter((module): module is SchemaModule => Boolean(module))
      : []),
    previousModule,
  ]);
  const nextRaw = buildRawSchemaSet([
    ...(nextBase
      ? nextBase.moduleIds
          .filter((moduleId) => moduleId !== getSchemaModuleRef(nextModule))
          .map((moduleId) => nextBase.modulesById.get(moduleId))
          .filter((module): module is SchemaModule => Boolean(module))
      : []),
    nextModule,
  ]);

  const previousRuntime = buildSchemaRuntime({
    raw: previousRaw,
    selection: {
      rootModuleIds: [getSchemaModuleRef(previousModule)],
      rootActivations: [buildDefaultSchemaActivation(getSchemaModuleRef(previousModule))],
      activationsByModuleId: buildSchemaActivationMap([
        buildDefaultSchemaActivation(getSchemaModuleRef(previousModule)),
      ]),
    },
  });
  const nextRuntime = buildSchemaRuntime({
    raw: nextRaw,
    selection: {
      rootModuleIds: [getSchemaModuleRef(nextModule)],
      rootActivations: [buildDefaultSchemaActivation(getSchemaModuleRef(nextModule))],
      activationsByModuleId: buildSchemaActivationMap([
        buildDefaultSchemaActivation(getSchemaModuleRef(nextModule)),
      ]),
    },
  });

  return compareSchemas(
    previousRuntime.resolved.effectiveSchema,
    nextRuntime.resolved.effectiveSchema,
  );
}
