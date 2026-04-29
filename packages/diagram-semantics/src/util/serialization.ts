import { dump, JSON_SCHEMA, load } from 'js-yaml';
import { diagnosticsToMessages } from '../model/diagnostics';
import type {
  DocumentInput,
  Provenance,
  ProvenanceLocation,
  SchemaActivation,
  SchemaModule,
  SemanticDocument,
  SemanticSourceDocument,
  SemanticSourceImport,
} from '../model/types';
import schemaModuleSchema from '../schemas/schema-module.schema.json';
import { validateWithSchema } from './schema-validator';

type RawEntity = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  description?: unknown;
  tags?: unknown;
  removeDefaultTags?: unknown;
  replaceDefaultTags?: unknown;
  props?: unknown;
  provenance?: unknown;
  children?: unknown;
};

type RawRelation = {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  description?: unknown;
  state?: unknown;
  from?: unknown;
  to?: unknown;
  tags?: unknown;
  removeDefaultTags?: unknown;
  replaceDefaultTags?: unknown;
  props?: unknown;
  provenance?: unknown;
};

type RawProvenance = {
  confidence?: unknown;
  locations?: unknown;
  input?: unknown;
  repo?: unknown;
  commit?: unknown;
  path?: unknown;
  paths?: unknown;
  symbol?: unknown;
  note?: unknown;
};

type RawProvenanceLocation = {
  input?: unknown;
  repo?: unknown;
  commit?: unknown;
  path?: unknown;
  symbol?: unknown;
  note?: unknown;
};

type RawSourceImport = {
  slug?: unknown;
  namespace?: unknown;
};

type RawDocumentInput = {
  id?: unknown;
  kind?: unknown;
  repo?: unknown;
  ref?: unknown;
  revision?: unknown;
  role?: unknown;
};

type RawSchemaActivation = {
  schema?: unknown;
  layer?: unknown;
};

let generatedIdCounter = 0;

const nextGeneratedId = (prefix: string) => {
  generatedIdCounter += 1;
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const token =
    typeof cryptoObject?.randomUUID === 'function'
      ? cryptoObject.randomUUID()
      : `${Date.now()}-${generatedIdCounter}`;
  return `${prefix}_${token}`;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const normalizeTagList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (tags.length === 0) return undefined;
  return Array.from(new Set(tags));
};

const normalizeDescription = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizeOptionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizeDocumentInputs = (value: unknown): DocumentInput[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const inputs = value.flatMap((entry) => {
    const input = asRecord(entry) as RawDocumentInput | undefined;
    if (!input) return [];
    return [
      {
        id: typeof input.id === 'string' ? input.id.trim() : '',
        kind: (typeof input.kind === 'string' ? input.kind.trim() : '') as DocumentInput['kind'],
        repo: typeof input.repo === 'string' ? input.repo.trim() : '',
        ref:
          typeof input.ref === 'string' && input.ref.trim().length > 0
            ? input.ref.trim()
            : undefined,
        revision:
          typeof input.revision === 'string' && input.revision.trim().length > 0
            ? input.revision.trim()
            : undefined,
        role: (typeof input.role === 'string' && input.role.trim().length > 0
          ? input.role.trim()
          : undefined) as DocumentInput['role'] | undefined,
      },
    ];
  });
  return inputs.length > 0 ? inputs : undefined;
};

const normalizeSchemaActivations = (value: unknown): SchemaActivation[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      throw new Error(
        `Invalid document schemaRefs entry at index ${index}: legacy string schema refs are not supported; use an object like { schema, layer }`,
      );
    }
    const activation = asRecord(entry) as RawSchemaActivation | undefined;
    if (!activation) {
      throw new Error(
        `Invalid document schemaRefs entry at index ${index}: expected an activation object like { schema, layer }`,
      );
    }
    const schema = typeof activation.schema === 'string' ? activation.schema.trim() : '';
    const layer = activation.layer;
    if (!schema) {
      throw new Error(
        `Invalid document schemaRefs entry at index ${index}: schema is required in { schema, layer }`,
      );
    }
    if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 0) {
      throw new Error(
        `Invalid document schemaRefs entry at index ${index}: layer is required and must be a non-negative integer`,
      );
    }
    return { schema, layer };
  });
};

type ProvenanceLocationDefaults = Pick<
  ProvenanceLocation,
  'input' | 'repo' | 'commit' | 'symbol' | 'note'
>;

const normalizeProvenanceLocations = (
  value: unknown,
  defaults: Partial<ProvenanceLocationDefaults> = {},
): ProvenanceLocation[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const locations = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const path = entry.trim();
      return path.length > 0
        ? [
            {
              ...defaults,
              path,
            },
          ]
        : [];
    }
    const location = asRecord(entry) as RawProvenanceLocation | undefined;
    if (!location) return [];
    return [
      {
        input: normalizeOptionalText(location.input) ?? defaults.input,
        repo: normalizeOptionalText(location.repo) ?? defaults.repo,
        commit: normalizeOptionalText(location.commit) ?? defaults.commit,
        path: typeof location.path === 'string' ? location.path.trim() : '',
        symbol: normalizeOptionalText(location.symbol) ?? defaults.symbol,
        note: normalizeOptionalText(location.note) ?? defaults.note,
      },
    ];
  });
  return locations.length > 0 ? locations : undefined;
};

const normalizeProvenance = (value: unknown): Provenance | undefined => {
  if (Array.isArray(value)) {
    return {
      locations: normalizeProvenanceLocations(value) ?? [],
    };
  }
  const provenance = asRecord(value) as RawProvenance | undefined;
  if (!provenance) return undefined;
  const shorthandDefaults: Partial<ProvenanceLocationDefaults> = {
    input: normalizeOptionalText(provenance.input),
    repo: normalizeOptionalText(provenance.repo),
    commit: normalizeOptionalText(provenance.commit),
    symbol: normalizeOptionalText(provenance.symbol),
    note: normalizeOptionalText(provenance.note),
  };
  const shorthandLocations =
    normalizeProvenanceLocations(provenance.paths, shorthandDefaults) ??
    normalizeProvenanceLocations([provenance.path], shorthandDefaults);
  return {
    confidence:
      typeof provenance.confidence === 'number' && Number.isFinite(provenance.confidence)
        ? provenance.confidence
        : undefined,
    locations: normalizeProvenanceLocations(provenance.locations) ?? shorthandLocations ?? [],
  };
};

const normalizeImports = (value: unknown): SemanticSourceImport[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const imports = value.flatMap((entry) => {
    const importRecord = asRecord(entry) as RawSourceImport | undefined;
    if (!importRecord) return [];
    return [
      {
        slug: typeof importRecord.slug === 'string' ? importRecord.slug.trim() : '',
        namespace: typeof importRecord.namespace === 'string' ? importRecord.namespace.trim() : '',
      },
    ];
  });
  return imports.length > 0 ? imports : undefined;
};

const normalizeEntities = (rawEntities: unknown[]): SemanticDocument['entities'] => {
  const ids = new Set<string>();

  const reserveEntityId = (candidate: unknown, type: string) => {
    let id =
      typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : nextGeneratedId(type || 'entity');
    while (ids.has(id)) {
      id = nextGeneratedId(type || 'entity');
    }
    ids.add(id);
    return id;
  };

  const visit = (raw: unknown): SemanticDocument['entities'][number] | undefined => {
    const entry = asRecord(raw) as RawEntity | undefined;
    if (!entry) return undefined;

    const type = typeof entry.type === 'string' ? entry.type : '';
    const id = reserveEntityId(entry.id, type || 'entity');
    const props = asRecord(entry.props);
    const normalizedChildren: SemanticDocument['entities'] = [];
    const children = Array.isArray(entry.children) ? entry.children : [];
    for (const child of children) {
      const normalizedChild = visit(child);
      if (normalizedChild) {
        normalizedChildren.push(normalizedChild);
      }
    }
    return {
      id,
      type,
      name:
        typeof entry.name === 'string' && entry.name.trim().length > 0
          ? entry.name.trim()
          : undefined,
      description: normalizeDescription(entry.description),
      tags: normalizeTagList(entry.tags),
      removeDefaultTags: normalizeTagList(entry.removeDefaultTags),
      replaceDefaultTags: entry.replaceDefaultTags === true ? true : undefined,
      props,
      provenance: normalizeProvenance(entry.provenance),
      children: normalizedChildren.length > 0 ? normalizedChildren : undefined,
    };
  };

  const entities: SemanticDocument['entities'] = [];
  for (const rawEntity of rawEntities) {
    const normalized = visit(rawEntity);
    if (normalized) {
      entities.push(normalized);
    }
  }

  return entities;
};

const normalizeRelations = (rawRelations: unknown[]): SemanticDocument['relations'] => {
  const relations: SemanticDocument['relations'] = [];
  const ids = new Set<string>();

  const reserveRelationId = (candidate: unknown) => {
    let id =
      typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : nextGeneratedId('rel');
    while (ids.has(id)) {
      id = nextGeneratedId('rel');
    }
    ids.add(id);
    return id;
  };

  for (const raw of rawRelations) {
    const entry = asRecord(raw) as RawRelation | undefined;
    if (!entry) continue;
    relations.push({
      id: reserveRelationId(entry.id),
      type: typeof entry.type === 'string' ? entry.type : undefined,
      label: typeof entry.label === 'string' ? entry.label : undefined,
      description: normalizeDescription(entry.description),
      state: entry.state === 'none' || entry.state === 'undecided' ? entry.state : undefined,
      from: typeof entry.from === 'string' ? entry.from : '',
      to: typeof entry.to === 'string' ? entry.to : '',
      tags: normalizeTagList(entry.tags),
      removeDefaultTags: normalizeTagList(entry.removeDefaultTags),
      replaceDefaultTags: entry.replaceDefaultTags === true ? true : undefined,
      props: asRecord(entry.props),
      provenance: normalizeProvenance(entry.provenance),
    });
  }

  return relations;
};

const toNestedEntities = (entities: SemanticDocument['entities']) => {
  const serializeEntity = (
    entity: SemanticDocument['entities'][number],
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {
      id: entity.id,
      type: entity.type,
    };
    const normalizedName = entity.name?.trim();
    if (normalizedName && normalizedName.length > 0) {
      out.name = normalizedName;
    }
    if (entity.description && entity.description.trim().length > 0) {
      out.description = entity.description.trim();
    }
    if (entity.tags && entity.tags.length > 0) {
      out.tags = entity.tags;
    }
    if (entity.removeDefaultTags && entity.removeDefaultTags.length > 0) {
      out.removeDefaultTags = entity.removeDefaultTags;
    }
    if (entity.replaceDefaultTags === true) {
      out.replaceDefaultTags = true;
    }
    if (entity.props && Object.keys(entity.props).length > 0) {
      out.props = entity.props;
    }
    if (entity.provenance) {
      out.provenance = entity.provenance;
    }
    if (entity.children && entity.children.length > 0) {
      out.children = entity.children.map((child) => serializeEntity(child));
    }
    return out;
  };
  return entities.map((entity) => serializeEntity(entity));
};

export function serializeDocument(doc: SemanticDocument): string {
  return serializeSourceDocument(doc);
}

export function serializeSourceDocument(doc: SemanticSourceDocument): string {
  const out: Record<string, unknown> = {
    version: doc.version,
    schemaRefs: doc.schemaRefs,
    entities: toNestedEntities(doc.entities),
    relations: doc.relations.map((relation) => {
      const out: Record<string, unknown> = {
        id: relation.id,
        from: relation.from,
        to: relation.to,
      };
      if (relation.type) out.type = relation.type;
      if (relation.label) out.label = relation.label;
      if (relation.description && relation.description.trim().length > 0) {
        out.description = relation.description.trim();
      }
      if (relation.state) out.state = relation.state;
      if (relation.tags && relation.tags.length > 0) out.tags = relation.tags;
      if (relation.removeDefaultTags && relation.removeDefaultTags.length > 0) {
        out.removeDefaultTags = relation.removeDefaultTags;
      }
      if (relation.replaceDefaultTags === true) out.replaceDefaultTags = true;
      if (relation.props && Object.keys(relation.props).length > 0) out.props = relation.props;
      if (relation.provenance) out.provenance = relation.provenance;
      return out;
    }),
  };
  if (doc.inputs && doc.inputs.length > 0) {
    out.inputs = doc.inputs;
  }
  if (doc.imports && doc.imports.length > 0) {
    out.imports = doc.imports;
  }
  if (doc.view) {
    out.view = doc.view;
  }
  if (doc.metadata) {
    out.metadata = doc.metadata;
  }
  return dump(out, {
    noRefs: true,
    lineWidth: 100,
    quotingType: '"',
  });
}

export function parseDocument(raw: string): SemanticDocument {
  const parsed = parseSourceDocument(raw);
  if (parsed.imports && parsed.imports.length > 0) {
    throw new Error('Document imports require source compilation');
  }
  return parsed;
}

export function parseSourceDocument(raw: string): SemanticSourceDocument {
  const parsed = load(raw, { schema: JSON_SCHEMA });
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid document');
  }
  const record = parsed as Record<string, unknown>;
  const entities = Array.isArray(record.entities) ? normalizeEntities(record.entities) : [];
  const relations = Array.isArray(record.relations) ? normalizeRelations(record.relations) : [];
  const schemaRefs = normalizeSchemaActivations(record.schemaRefs);
  const inputs = normalizeDocumentInputs(record.inputs);
  const imports = normalizeImports(record.imports);
  const metadata = asRecord(record.metadata) as SemanticDocument['metadata'] | undefined;
  const legacyLayout = asRecord(record.layout) as
    | NonNullable<SemanticDocument['view']>['layout']
    | undefined;
  const rawView = asRecord(record.view) as unknown as SemanticDocument['view'] | undefined;
  const view =
    rawView || legacyLayout
      ? {
          kind: 'semantic-diagram-view' as const,
          version: 2 as const,
          scopeRootId: rawView?.scopeRootId,
          nodesById: rawView?.nodesById,
          layout: rawView?.layout ?? legacyLayout,
        }
      : undefined;
  return {
    version: typeof record.version === 'string' ? record.version : '0.1.0',
    schemaRefs,
    entities,
    relations,
    inputs,
    imports,
    metadata,
    view,
  };
}

export function parseSchema(raw: string): SchemaModule {
  const parsed = load(raw, { schema: JSON_SCHEMA });
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid schema');
  }
  const diagnostics = validateWithSchema(parsed, schemaModuleSchema);
  if (diagnostics.length > 0) {
    throw new Error(
      `Invalid schema:\n${diagnosticsToMessages(diagnostics)
        .map((err) => `- ${err}`)
        .join('\n')}`,
    );
  }
  return parsed as SchemaModule;
}
