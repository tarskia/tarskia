import {
  type Diagnostic,
  diagnosticFingerprint,
  schemaDiagnostic,
  sortDiagnostics,
} from '../diagnostics';
import { buildSchemaId, getSchemaModuleRef, parseSchemaRef } from '../schema-ref';
import {
  buildDefaultSchemaActivation,
  buildRawSchemaSet,
  buildSchemaActivationMap,
  buildSchemaRuntime,
  type RawSchemaSet,
  type SchemaRuntime,
  type SchemaSelection,
} from '../schema-runtime';
import { parseSchemaId, resolveSchemaModules } from '../schema-selection';
import type { SchemaActivation, SchemaModule } from '../types';

export interface SchemaVersionCatalogEntry {
  schemaId: string;
  version: string;
  raw: string;
  module: SchemaModule;
}

export interface SchemaVersionCatalog {
  entries: SchemaVersionCatalogEntry[];
  entriesByRef: Map<string, SchemaVersionCatalogEntry>;
  signature: string;
}

export interface SchemaClosureRoot {
  schemaId: string;
  version: string;
  raw: string;
  module: SchemaModule;
}

export interface SchemaClosureResult {
  ok: boolean;
  root: SchemaClosureRoot;
  raw: RawSchemaSet;
  selection: SchemaSelection;
  dependencyRefs: string[];
  diagnostics: Diagnostic[];
}

export interface SchemaMaterializationResult {
  ok: boolean;
  runtime?: SchemaRuntime;
  diagnostics: Diagnostic[];
}

export interface SchemaCatalogRuntimeResult extends SchemaMaterializationResult {
  raw: RawSchemaSet;
  selection: SchemaSelection;
  runtime: SchemaRuntime;
}

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const dedupeDiagnostics = (diagnostics: Diagnostic[]) =>
  sortDiagnostics(
    diagnostics.filter(
      (diagnostic, index, list) =>
        list.findIndex(
          (candidate) => diagnosticFingerprint(candidate) === diagnosticFingerprint(diagnostic),
        ) === index,
    ),
  );

const withSchemaIdentity = (
  module: SchemaModule,
  schemaId: string,
  version: string,
): SchemaModule => ({
  ...module,
  owner: parseSchemaRef(schemaId).owner,
  name: parseSchemaRef(schemaId).name,
  version,
});

const buildVersionedSchemaRef = (schemaId: string, version: string) => `${schemaId}@${version}`;

const compareVersions = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const parseSchemaRefVersion = (ref: string) => {
  const at = ref.lastIndexOf('@');
  if (at <= 0 || at === ref.length - 1) return undefined;
  return ref.slice(at + 1).trim() || undefined;
};

const buildLatestEntriesBySchemaId = (catalog: SchemaVersionCatalog) => {
  const latestBySchemaId = new Map<string, SchemaVersionCatalogEntry>();
  for (const entry of catalog.entries) {
    const current = latestBySchemaId.get(entry.schemaId);
    if (!current || compareVersions(entry.version, current.version) > 0) {
      latestBySchemaId.set(entry.schemaId, entry);
    }
  }
  return latestBySchemaId;
};

const closureCache = new Map<string, SchemaClosureResult>();

export function buildSchemaVersionCatalog(
  entries: SchemaVersionCatalogEntry[],
): SchemaVersionCatalog {
  const normalized = [...entries]
    .map((entry) => ({
      schemaId: entry.schemaId,
      version: entry.version,
      raw: entry.raw,
      module: withSchemaIdentity(entry.module, entry.schemaId, entry.version),
    }))
    .sort((left, right) =>
      buildVersionedSchemaRef(left.schemaId, left.version).localeCompare(
        buildVersionedSchemaRef(right.schemaId, right.version),
      ),
    );
  const entriesByRef = new Map<string, SchemaVersionCatalogEntry>();
  for (const entry of normalized) {
    entriesByRef.set(buildVersionedSchemaRef(entry.schemaId, entry.version), entry);
  }
  const signature = hashString(
    normalized
      .map(
        (entry) =>
          `${buildVersionedSchemaRef(entry.schemaId, entry.version)}:${hashString(entry.raw)}`,
      )
      .join('|'),
  );
  return {
    entries: normalized,
    entriesByRef,
    signature,
  };
}

export function resolveSchemaClosureFromCatalog(params: {
  root: SchemaClosureRoot;
  catalog: SchemaVersionCatalog;
}): SchemaClosureResult {
  const { root, catalog } = params;
  const cacheKey = hashString(
    `${catalog.signature}|${buildVersionedSchemaRef(root.schemaId, root.version)}|${hashString(root.raw)}`,
  );
  const cached = closureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const diagnostics: Diagnostic[] = [];
  const dependencyRefs = new Set<string>();
  const requestedVersionsBySchema = new Map<string, string>([[root.schemaId, root.version]]);
  const modulesById = new Map<string, SchemaModule>([
    [root.schemaId, withSchemaIdentity(root.module, root.schemaId, root.version)],
  ]);
  const visitingRefs = new Set<string>();
  const visitedRefs = new Set<string>();

  const visitModule = (module: SchemaModule, ref: string, stack: string[]) => {
    if (visitingRefs.has(ref)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.dependency_cycle',
          moduleId: getSchemaModuleRef(module),
          message: `Schema dependency cycle detected: ${[...stack, ref].join(' -> ')}`,
        }),
      );
      return;
    }
    if (visitedRefs.has(ref)) return;

    visitingRefs.add(ref);
    for (const dependency of module.use ?? []) {
      const dependencySchemaId = parseSchemaId(dependency.schema);
      const dependencyVersion = parseSchemaRefVersion(dependency.schema);
      if (!dependencyVersion) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.unpinned_dependency',
            moduleId: getSchemaModuleRef(module),
            message: `Dependency schema ref must be version-pinned: ${dependency.schema}`,
          }),
        );
        continue;
      }

      const dependencyRef = buildVersionedSchemaRef(dependencySchemaId, dependencyVersion);
      dependencyRefs.add(dependencyRef);
      const existingVersion = requestedVersionsBySchema.get(dependencySchemaId);
      if (existingVersion && existingVersion !== dependencyVersion) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.dependency_version_conflict',
            moduleId: getSchemaModuleRef(module),
            message: `Conflicting pinned dependency versions for ${dependencySchemaId}: ${existingVersion} and ${dependencyVersion}`,
          }),
        );
        continue;
      }
      requestedVersionsBySchema.set(dependencySchemaId, dependencyVersion);

      const entry = catalog.entriesByRef.get(dependencyRef);
      if (!entry) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.missing_dependency',
            moduleId: dependencySchemaId,
            message: `Missing schema dependency: ${dependencyRef}`,
          }),
        );
        continue;
      }

      const normalizedModule = withSchemaIdentity(entry.module, entry.schemaId, entry.version);
      modulesById.set(entry.schemaId, normalizedModule);
      visitModule(normalizedModule, dependencyRef, [...stack, ref]);
    }
    visitingRefs.delete(ref);
    visitedRefs.add(ref);
  };

  const rootRef = buildVersionedSchemaRef(root.schemaId, root.version);
  visitModule(withSchemaIdentity(root.module, root.schemaId, root.version), rootRef, []);

  const result: SchemaClosureResult = {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    root,
    raw: buildRawSchemaSet([...modulesById.values()]),
    selection: {
      rootModuleIds: [root.schemaId],
      rootActivations: [
        buildDefaultSchemaActivation(buildVersionedSchemaRef(root.schemaId, root.version)),
      ],
      activationsByModuleId: buildSchemaActivationMap([
        buildDefaultSchemaActivation(buildVersionedSchemaRef(root.schemaId, root.version)),
      ]),
    },
    dependencyRefs: [...dependencyRefs].sort((left, right) => left.localeCompare(right)),
    diagnostics: dedupeDiagnostics(diagnostics),
  };
  closureCache.set(cacheKey, result);
  return result;
}

export function buildSchemaRuntimeFromCatalog(params: {
  activations?: SchemaActivation[];
  catalog: SchemaVersionCatalog;
}): SchemaCatalogRuntimeResult {
  const { activations, catalog } = params;
  const diagnostics: Diagnostic[] = [];
  const latestEntriesBySchemaId = buildLatestEntriesBySchemaId(catalog);
  const requestedVersionsBySchema = new Map<string, string>();
  const modulesById = new Map<string, SchemaModule>();
  const visitingRefs = new Set<string>();
  const visitedRefs = new Set<string>();

  const rootActivations =
    activations && activations.length > 0
      ? activations
      : [...latestEntriesBySchemaId.values()].map((entry) =>
          buildDefaultSchemaActivation(buildVersionedSchemaRef(entry.schemaId, entry.version)),
        );
  const rootModuleIds = Array.from(
    new Set(rootActivations.map((activation) => buildSchemaId(parseSchemaRef(activation.schema)))),
  );

  const visitEntry = (entry: SchemaVersionCatalogEntry, ref: string, stack: string[]) => {
    if (visitingRefs.has(ref)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.dependency_cycle',
          moduleId: entry.schemaId,
          message: `Schema dependency cycle detected: ${[...stack, ref].join(' -> ')}`,
        }),
      );
      return;
    }
    if (visitedRefs.has(ref)) return;

    visitingRefs.add(ref);
    modulesById.set(
      entry.schemaId,
      withSchemaIdentity(entry.module, entry.schemaId, entry.version),
    );

    for (const dependency of entry.module.use ?? []) {
      const dependencySchemaId = buildSchemaId(parseSchemaRef(dependency.schema));
      const dependencyVersion = parseSchemaRefVersion(dependency.schema);
      if (!dependencyVersion) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.unpinned_dependency',
            moduleId: entry.schemaId,
            message: `Dependency schema ref must be version-pinned: ${dependency.schema}`,
          }),
        );
        continue;
      }

      const existingVersion = requestedVersionsBySchema.get(dependencySchemaId);
      if (existingVersion && existingVersion !== dependencyVersion) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.dependency_version_conflict',
            moduleId: entry.schemaId,
            message: `Conflicting pinned dependency versions for ${dependencySchemaId}: ${existingVersion} and ${dependencyVersion}`,
          }),
        );
        continue;
      }
      requestedVersionsBySchema.set(dependencySchemaId, dependencyVersion);

      const dependencyRef = buildVersionedSchemaRef(dependencySchemaId, dependencyVersion);
      const dependencyEntry = catalog.entriesByRef.get(dependencyRef);
      if (!dependencyEntry) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'resolution',
            severity: 'error',
            code: 'schema.resolution.missing_dependency',
            moduleId: dependencySchemaId,
            message: `Missing schema dependency: ${dependencyRef}`,
          }),
        );
        continue;
      }

      visitEntry(dependencyEntry, dependencyRef, [...stack, ref]);
    }

    visitingRefs.delete(ref);
    visitedRefs.add(ref);
  };

  for (const rootActivation of rootActivations) {
    const parsedRoot = parseSchemaRef(rootActivation.schema);
    const rootSchemaId = buildSchemaId(parsedRoot);
    const rootEntry = parsedRoot.version
      ? catalog.entriesByRef.get(buildVersionedSchemaRef(rootSchemaId, parsedRoot.version))
      : latestEntriesBySchemaId.get(rootSchemaId);

    if (!rootEntry) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.missing_dependency',
          moduleId: rootSchemaId,
          message: `Missing schema dependency: ${rootActivation.schema}`,
        }),
      );
      continue;
    }

    const existingVersion = requestedVersionsBySchema.get(rootSchemaId);
    if (existingVersion && existingVersion !== rootEntry.version) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.dependency_version_conflict',
          moduleId: rootSchemaId,
          message: `Conflicting pinned dependency versions for ${rootSchemaId}: ${existingVersion} and ${rootEntry.version}`,
        }),
      );
      continue;
    }

    requestedVersionsBySchema.set(rootSchemaId, rootEntry.version);
    visitEntry(rootEntry, buildVersionedSchemaRef(rootEntry.schemaId, rootEntry.version), []);
  }

  const raw = buildRawSchemaSet([...modulesById.values()]);
  const selection = {
    rootModuleIds,
    rootActivations,
    activationsByModuleId: buildSchemaActivationMap(rootActivations),
  };
  const runtime = buildSchemaRuntime({ raw, selection });
  const combinedDiagnostics = dedupeDiagnostics([...diagnostics, ...runtime.resolved.diagnostics]);

  return {
    ok: combinedDiagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    raw,
    selection,
    runtime,
    diagnostics: combinedDiagnostics,
  };
}

export function resolveSchemaClosureFromRawSet(params: {
  rootModule: SchemaModule;
  rawSchemaSet: RawSchemaSet;
}): SchemaClosureResult {
  const { rootModule, rawSchemaSet } = params;
  const rootSchemaId = getSchemaModuleRef(rootModule);
  const schemaRegistry = new Map(rawSchemaSet.modulesById);
  schemaRegistry.set(rootSchemaId, rootModule);
  const resolution = resolveSchemaModules({
    schemaRegistry,
    selectedSchemaIds: [rootSchemaId],
  });
  return {
    ok: resolution.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    root: {
      schemaId: rootSchemaId,
      version: rootModule.version,
      raw: '',
      module: rootModule,
    },
    raw: buildRawSchemaSet(resolution.orderedModules),
    selection: {
      rootModuleIds: [rootSchemaId],
      rootActivations: [buildDefaultSchemaActivation(rootSchemaId)],
      activationsByModuleId: buildSchemaActivationMap([buildDefaultSchemaActivation(rootSchemaId)]),
    },
    dependencyRefs: resolution.orderedModules
      .flatMap((module) => module.use ?? [])
      .map((entry) => entry.schema)
      .filter((ref) => ref.length > 0)
      .sort((left, right) => left.localeCompare(right)),
    diagnostics: dedupeDiagnostics(resolution.diagnostics),
  };
}

export function materializeSchemaClosure(params: {
  closure: SchemaClosureResult;
}): SchemaMaterializationResult {
  const runtime = buildSchemaRuntime({
    raw: params.closure.raw,
    selection: params.closure.selection,
  });
  const diagnostics = dedupeDiagnostics(runtime.resolved.diagnostics);
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    runtime,
    diagnostics,
  };
}

export const getSchemaDependencyRefs = (module: SchemaModule) =>
  (module.use ?? []).map((entry) => entry.schema).filter((ref) => ref.length > 0);
