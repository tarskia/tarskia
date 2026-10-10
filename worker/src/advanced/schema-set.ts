import {
  buildRawSchemaSet,
  buildSchemaActivation,
  buildSchemaRuntime,
  buildSchemaSelection,
  getDefaultSchemaActivationLayer,
  getSchemaModuleRef,
  parseSchemaId,
  type SchemaActivation,
  type SchemaModule,
  type SchemaRuntime,
} from '../semantic';
import type { SchemaRegistry } from '../semantic/schema-loader';
import type { AreaPlan, SchemaRefCandidate } from './types';

export interface SchemaSetProposalDecision {
  changed: boolean;
  acceptedSchemaRefs: string[];
  rejectedSchemaRefs: string[];
}

export interface SchemaSetSnapshot {
  rootSchemaRefs: SchemaActivation[];
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
  runtime: SchemaRuntime;
}

export function dedupeSchemaActivations(activations: SchemaActivation[]): SchemaActivation[] {
  const seen = new Set<string>();
  const deduped: SchemaActivation[] = [];
  for (const activation of activations) {
    const key = parseSchemaId(activation.schema);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(activation);
  }
  return deduped;
}

function canonicalSchemaRef(module: SchemaModule): string {
  return getSchemaModuleRef(module, true);
}

function normalizeSchemaId(schemaRegistry: SchemaRegistry, schemaRef: string): string | undefined {
  const schemaId = parseSchemaId(schemaRef);
  return schemaRegistry.modulesById.has(schemaId) ? schemaId : undefined;
}

function buildRuntimeFromRootSchemaIds(
  schemaRegistry: SchemaRegistry,
  rootSchemaRefs: SchemaActivation[],
): SchemaRuntime {
  const modules = Array.from(schemaRegistry.modulesById.values());
  const raw = buildRawSchemaSet(modules);
  return buildSchemaRuntime({
    raw,
    selection: buildSchemaSelection({
      raw,
      activations: rootSchemaRefs,
    }),
  });
}

function buildAliasToImportedSchemaIds(module: SchemaModule): Map<string, string> {
  return new Map(
    (module.use ?? [])
      .filter((entry) => typeof entry.alias === 'string' && entry.alias.trim().length > 0)
      .map((entry) => [entry.alias!.trim(), parseSchemaId(entry.schema)] as const),
  );
}

function schemaAugmentsActiveSchema(module: SchemaModule, activeSchemaIds: Set<string>): boolean {
  if (!module.update || Object.keys(module.update).length === 0) {
    return false;
  }
  const aliasToImportedSchemaIds = buildAliasToImportedSchemaIds(module);
  if (aliasToImportedSchemaIds.size === 0) {
    return false;
  }
  return Object.keys(module.update).some((selector) => {
    const [alias] = selector.split('.');
    if (!alias) {
      return false;
    }
    const importedSchemaId = aliasToImportedSchemaIds.get(alias);
    return Boolean(importedSchemaId && activeSchemaIds.has(importedSchemaId));
  });
}

function dedupeCandidateSchemaRefs(
  schemaRegistry: SchemaRegistry,
  candidates: SchemaRefCandidate[],
): SchemaRefCandidate[] {
  const seen = new Set<string>();
  const deduped: SchemaRefCandidate[] = [];
  for (const candidate of candidates) {
    const schemaId = normalizeSchemaId(schemaRegistry, candidate.schemaRef);
    if (!schemaId) {
      continue;
    }
    const module = schemaRegistry.modulesById.get(schemaId);
    if (!module) {
      continue;
    }
    const canonicalRef = canonicalSchemaRef(module);
    const key = `${canonicalRef}@${candidate.suggestedLayer}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...candidate,
      schemaRef: canonicalRef,
    });
  }
  return deduped;
}

export class AdvancedSchemaSetManager {
  private readonly schemaRegistry: SchemaRegistry;
  private readonly plannedSchemaIds: Set<string>;
  private readonly candidateSchemaRefs: SchemaRefCandidate[];
  private rootSchemaRefs: SchemaActivation[];
  private runtime: SchemaRuntime;

  constructor(params: {
    schemaRegistry: SchemaRegistry;
    initialSchemaActivations: SchemaActivation[];
    candidateSchemaRefs: SchemaRefCandidate[];
  }) {
    this.schemaRegistry = params.schemaRegistry;
    this.candidateSchemaRefs = dedupeCandidateSchemaRefs(
      params.schemaRegistry,
      params.candidateSchemaRefs,
    );
    const plannedSchemaIds = new Set<string>();
    const initialSchemaActivations = params.initialSchemaActivations
      .map((activation) => {
        const schemaId = normalizeSchemaId(params.schemaRegistry, activation.schema);
        if (!schemaId) {
          return undefined;
        }
        const module = params.schemaRegistry.modulesById.get(schemaId);
        if (!module) {
          return undefined;
        }
        return buildSchemaActivation(canonicalSchemaRef(module), activation.layer);
      })
      .filter((activation): activation is SchemaActivation => Boolean(activation));
    for (const activation of initialSchemaActivations) {
      plannedSchemaIds.add(parseSchemaId(activation.schema));
    }
    for (const candidate of this.candidateSchemaRefs) {
      const schemaId = normalizeSchemaId(params.schemaRegistry, candidate.schemaRef);
      if (schemaId) {
        plannedSchemaIds.add(schemaId);
      }
    }
    this.plannedSchemaIds = plannedSchemaIds;
    this.rootSchemaRefs = dedupeSchemaActivations(initialSchemaActivations);
    this.runtime = buildRuntimeFromRootSchemaIds(this.schemaRegistry, this.rootSchemaRefs);
  }

  snapshot(): SchemaSetSnapshot {
    return {
      rootSchemaRefs: [...this.rootSchemaRefs],
      activeSchemaRefs: [...this.rootSchemaRefs],
      candidateSchemaRefs: this.candidateSchemaRefs,
      runtime: this.runtime,
    };
  }

  acceptSchemaRefs(proposedSchemaRefs: string[]): SchemaSetProposalDecision {
    const activeSchemaIds = new Set(this.runtime.resolved.resolvedModuleIds);
    const normalized = proposedSchemaRefs
      .map((schemaRef) => ({
        original: schemaRef,
        schemaId: normalizeSchemaId(this.schemaRegistry, schemaRef),
      }))
      .filter((proposal): proposal is { original: string; schemaId: string } =>
        Boolean(proposal.schemaId),
      );

    const directlyAcceptableSchemaIds = normalized
      .map((proposal) => proposal.schemaId)
      .filter((schemaId) => {
        if (activeSchemaIds.has(schemaId) || this.plannedSchemaIds.has(schemaId)) {
          return true;
        }
        const module = this.schemaRegistry.modulesById.get(schemaId);
        return Boolean(module && schemaAugmentsActiveSchema(module, activeSchemaIds));
      });

    const nextRootSchemaRefs = dedupeSchemaActivations([
      ...this.rootSchemaRefs,
      ...directlyAcceptableSchemaIds
        .map((schemaId) => {
          const candidate = this.candidateSchemaRefs.find(
            (entry) => parseSchemaId(entry.schemaRef) === schemaId,
          );
          if (candidate) {
            return buildSchemaActivation(candidate.schemaRef, candidate.suggestedLayer);
          }
          const module = this.schemaRegistry.modulesById.get(schemaId);
          if (!module) {
            return undefined;
          }
          const canonicalRef = canonicalSchemaRef(module);
          return buildSchemaActivation(canonicalRef, getDefaultSchemaActivationLayer(canonicalRef));
        })
        .filter((activation): activation is SchemaActivation => Boolean(activation)),
    ]);
    const nextRuntime = buildRuntimeFromRootSchemaIds(this.schemaRegistry, nextRootSchemaRefs);
    const nextResolvedSchemaIds = new Set(nextRuntime.resolved.resolvedModuleIds);

    const acceptedSchemaRefs = normalized
      .filter((proposal) => nextResolvedSchemaIds.has(proposal.schemaId))
      .map((proposal) => this.schemaRegistry.modulesById.get(proposal.schemaId))
      .filter((module): module is SchemaModule => Boolean(module))
      .map((module) => canonicalSchemaRef(module));

    const acceptedSchemaIds = new Set(
      acceptedSchemaRefs.map((schemaRef) => parseSchemaId(schemaRef)),
    );
    const rejectedSchemaRefs = proposedSchemaRefs.filter((schemaRef) => {
      const schemaId = normalizeSchemaId(this.schemaRegistry, schemaRef);
      return !schemaId || !acceptedSchemaIds.has(schemaId);
    });

    if (nextRuntime.resolved.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return {
        changed: false,
        acceptedSchemaRefs: [],
        rejectedSchemaRefs: [...new Set(proposedSchemaRefs)],
      };
    }

    const changed =
      nextRootSchemaRefs.length !== this.rootSchemaRefs.length ||
      nextRootSchemaRefs.some((activation, index) => {
        const current = this.rootSchemaRefs[index];
        return (
          !current || current.schema !== activation.schema || current.layer !== activation.layer
        );
      });

    if (changed) {
      this.rootSchemaRefs = nextRootSchemaRefs;
      this.runtime = nextRuntime;
    }

    return {
      changed,
      acceptedSchemaRefs: [...new Set(acceptedSchemaRefs)],
      rejectedSchemaRefs: [...new Set(rejectedSchemaRefs)],
    };
  }

  restoreRootSchemaRefs(rootSchemaRefs: SchemaActivation[]): void {
    const restoredRootSchemaRefs = dedupeSchemaActivations(
      rootSchemaRefs
        .map((activation) => {
          const schemaId = normalizeSchemaId(this.schemaRegistry, activation.schema);
          if (!schemaId) {
            return undefined;
          }
          const module = this.schemaRegistry.modulesById.get(schemaId);
          if (!module) {
            return undefined;
          }
          return buildSchemaActivation(canonicalSchemaRef(module), activation.layer);
        })
        .filter((activation): activation is SchemaActivation => Boolean(activation)),
    );
    const restoredRuntime = buildRuntimeFromRootSchemaIds(
      this.schemaRegistry,
      restoredRootSchemaRefs,
    );
    if (
      restoredRuntime.resolved.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ) {
      throw new Error('Cannot restore schema-set checkpoint with invalid schema selection');
    }
    this.rootSchemaRefs = restoredRootSchemaRefs;
    this.runtime = restoredRuntime;
  }
}

export function buildSchemaSetManagerFromAreaPlan(params: {
  schemaRegistry: SchemaRegistry;
  areaPlan: AreaPlan;
}): AdvancedSchemaSetManager {
  return new AdvancedSchemaSetManager({
    schemaRegistry: params.schemaRegistry,
    initialSchemaActivations: params.areaPlan.initialSchemaActivations,
    candidateSchemaRefs: params.areaPlan.candidateSchemaRefs,
  });
}

export function serializeSchemaSetArtifact(snapshot: SchemaSetSnapshot): {
  rootSchemaRefs: SchemaActivation[];
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
} {
  return {
    rootSchemaRefs: snapshot.rootSchemaRefs,
    activeSchemaRefs: snapshot.activeSchemaRefs,
    candidateSchemaRefs: snapshot.candidateSchemaRefs,
  };
}
