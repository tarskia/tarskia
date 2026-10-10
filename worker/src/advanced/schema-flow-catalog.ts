import {
  getResolvedTypeSemantics,
  type ResolvedFlowRole,
  resolveTypeDef,
  type SchemaActivation,
  type SchemaModule,
  type SchemaSemantics,
} from '../semantic';

export interface SchemaFlowCatalogEntry {
  typeId: string;
  label?: string;
  description?: string;
  topLevelBias?: 'prefer' | 'neutral' | 'avoid';
  flowRole: ResolvedFlowRole;
  expectsIngress: boolean;
  expectsEgress: boolean;
  mayTerminate: boolean;
  expectedRelationIds: string[];
  relationParticipation: Array<{
    relationId: string;
    from: boolean;
    to: boolean;
  }>;
  traitIds: string[];
}

export interface SchemaFlowCatalog {
  activeSchemaRefs: SchemaActivation[];
  entries: SchemaFlowCatalogEntry[];
  groups: {
    sources: string[];
    through: string[];
    sinks: string[];
    none: string[];
    preferredWithoutFlow: string[];
  };
}

const sortStrings = (values: Iterable<string>): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

function buildGroups(entries: SchemaFlowCatalogEntry[]): SchemaFlowCatalog['groups'] {
  const byRole = (flowRole: ResolvedFlowRole) =>
    entries.filter((entry) => entry.flowRole === flowRole).map((entry) => entry.typeId);
  return {
    sources: byRole('source'),
    through: byRole('through'),
    sinks: byRole('sink'),
    none: byRole('none'),
    preferredWithoutFlow: entries
      .filter((entry) => entry.topLevelBias === 'prefer' && entry.flowRole === 'none')
      .map((entry) => entry.typeId),
  };
}

export function buildSchemaFlowCatalog(params: {
  schema: SchemaModule;
  semantics: SchemaSemantics;
  activeSchemaRefs: SchemaActivation[];
}): SchemaFlowCatalog {
  const entries = params.schema.types
    .map((type): SchemaFlowCatalogEntry | undefined => {
      const resolvedType = resolveTypeDef(params.schema, type.id);
      const typeSemantics = getResolvedTypeSemantics(params.semantics, type.id);
      if (!typeSemantics) {
        return undefined;
      }
      return {
        typeId: type.id,
        label: resolvedType?.label,
        description: resolvedType?.description,
        topLevelBias: resolvedType?.analysis?.topLevelBias,
        flowRole: typeSemantics.expectations.flowRole,
        expectsIngress: typeSemantics.expectations.expectsIngress,
        expectsEgress: typeSemantics.expectations.expectsEgress,
        mayTerminate: typeSemantics.expectations.mayTerminate,
        expectedRelationIds: sortStrings(typeSemantics.expectations.expectedRelationIds),
        relationParticipation: typeSemantics.relationParticipation
          .map((participation) => ({
            relationId: participation.relationId,
            from: participation.from,
            to: participation.to,
          }))
          .sort(
            (left, right) =>
              left.relationId.localeCompare(right.relationId) ||
              Number(right.from) - Number(left.from) ||
              Number(right.to) - Number(left.to),
          ),
        traitIds: sortStrings(typeSemantics.traitClosure),
      };
    })
    .filter((entry): entry is SchemaFlowCatalogEntry => Boolean(entry))
    .sort((left, right) => left.typeId.localeCompare(right.typeId));

  return {
    activeSchemaRefs: [...params.activeSchemaRefs].sort(
      (left, right) => left.layer - right.layer || left.schema.localeCompare(right.schema),
    ),
    entries,
    groups: buildGroups(entries),
  };
}

function formatRelationParticipation(entry: SchemaFlowCatalogEntry): string {
  if (entry.relationParticipation.length === 0) {
    return 'relations=(none)';
  }
  return `relations=${entry.relationParticipation
    .map((participation) => {
      const endpoints = [participation.from ? 'from' : null, participation.to ? 'to' : null].filter(
        (endpoint): endpoint is string => Boolean(endpoint),
      );
      return `${participation.relationId}[${endpoints.join('+')}]`;
    })
    .join(', ')}`;
}

function formatEntry(entry: SchemaFlowCatalogEntry): string {
  const details = [
    `flow=${entry.flowRole}`,
    entry.topLevelBias ? `topLevelBias=${entry.topLevelBias}` : null,
    entry.mayTerminate ? 'mayTerminate=true' : null,
    entry.expectedRelationIds.length > 0
      ? `expected=${entry.expectedRelationIds.join(', ')}`
      : null,
    formatRelationParticipation(entry),
  ].filter((detail): detail is string => Boolean(detail));
  return `- ${entry.typeId}${entry.label ? ` (${entry.label})` : ''}; ${details.join('; ')}`;
}

function renderGroup(title: string, entries: SchemaFlowCatalogEntry[]): string[] {
  return [
    `${title}:${entries.length === 0 ? ' (none)' : ''}`,
    ...entries.map((entry) => formatEntry(entry)),
  ];
}

export function renderSchemaFlowCatalogForPrompt(catalog: SchemaFlowCatalog): string {
  const entriesByRole = (flowRole: ResolvedFlowRole) =>
    catalog.entries.filter((entry) => entry.flowRole === flowRole);
  const preferredWithoutFlow = catalog.entries.filter(
    (entry) => entry.topLevelBias === 'prefer' && entry.flowRole === 'none',
  );
  return [
    'Active schema flow catalogue:',
    `Active schema refs: ${
      catalog.activeSchemaRefs.length > 0
        ? catalog.activeSchemaRefs
            .map((activation) => `${activation.schema} (layer ${activation.layer})`)
            .join(', ')
        : '(none)'
    }`,
    '',
    ...renderGroup('Sources - should have outgoing flow', entriesByRole('source')),
    '',
    ...renderGroup(
      'Flow-through - should have incoming and outgoing flow unless explicitly terminal',
      entriesByRole('through'),
    ),
    '',
    ...renderGroup('Sinks - should have incoming flow', entriesByRole('sink')),
    '',
    ...renderGroup('Preferred top-level types without flow semantics', preferredWithoutFlow),
  ].join('\n');
}

export function renderSchemaFlowCatalogSliceForPrompt(params: {
  catalog: SchemaFlowCatalog;
  parentTypeId: string;
  allowedChildTypeIds: string[];
}): string {
  const entryByTypeId = new Map(params.catalog.entries.map((entry) => [entry.typeId, entry]));
  const parent = entryByTypeId.get(params.parentTypeId);
  const allowedChildren = params.allowedChildTypeIds
    .map((typeId) => entryByTypeId.get(typeId))
    .filter((entry): entry is SchemaFlowCatalogEntry => Boolean(entry));
  const renderChildBucket = (flowRole: ResolvedFlowRole) =>
    sortStrings(
      allowedChildren.filter((entry) => entry.flowRole === flowRole).map((entry) => entry.typeId),
    );
  const childBuckets = {
    source: renderChildBucket('source'),
    through: renderChildBucket('through'),
    sink: renderChildBucket('sink'),
    none: renderChildBucket('none'),
  };
  return [
    'Schema flow context for this node:',
    parent
      ? `Parent type: ${formatEntry(parent).replace(/^- /, '')}`
      : `Parent type: ${params.parentTypeId} (not found in active flow catalogue)`,
    `Allowed source children: ${childBuckets.source.join(', ') || '(none)'}`,
    `Allowed flow-through children: ${childBuckets.through.join(', ') || '(none)'}`,
    `Allowed sink children: ${childBuckets.sink.join(', ') || '(none)'}`,
    `Allowed non-flow children: ${childBuckets.none.join(', ') || '(none)'}`,
    'Generic groups may carry provisional edgeProposals, but preserved source/sink flow should resolve to concrete direct children when the schema provides one.',
  ].join('\n');
}
