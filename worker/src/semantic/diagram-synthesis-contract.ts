import { buildQualifiedSchemaObjectId } from './model/schema-ids';
import { getSchemaModuleRef } from './model/schema-ref';
import type { PropertySchema } from './model/types';
import type { SchemaRegistry } from './schema-loader';

export interface DiagramSynthesisContract {
  validationRules: ValidationRules;
  promptPolicies: PromptPolicies;
  schemaCatalog: SchemaCatalogEntry[];
  canonicalExampleYaml: string;
}

export interface ValidationRules {
  requiredTopLevelKeys: string[];
  optionalTopLevelKeys: string[];
  preferredContainmentEncoding: 'children';
  acceptedContainmentEncodings: 'children'[];
  relationDirectionRule: 'directed-by-default';
  schemaRefsRequired: boolean;
  explicitIdsPreferred: boolean;
  provenanceLocationFields: string[];
  provenanceLocationInputRule: 'optional-when-single-input';
  workerInjectsPrimaryGitInput: boolean;
  workerRequiresEntityProvenance: boolean;
  workerRequiresRelationProvenance: boolean;
  lineNumbersRequiredInProvenance: boolean;
}

export interface PromptPolicies {
  omitViewByDefault: boolean;
  preferFewerStrongerBoundaries: boolean;
  avoidHelpersFunctionsClasses: boolean;
  avoidDuplicatingExternalIoAtCodeLayer: boolean;
  serviceVsModuleRule: string;
  runtimeOverToolingRule: string;
  modelingGuardrails: string[];
}

export interface SchemaCatalogEntry {
  schemaRef: string;
  description?: string;
  imports: string[];
  types: Array<{
    id: string;
    label?: string;
    description?: string;
    analysis?: { topLevelBias?: 'prefer' | 'neutral' | 'avoid' };
    properties?: SchemaCatalogPropertyEntry[];
  }>;
  relations: Array<{
    id: string;
    label?: string;
    directed: boolean;
    properties?: SchemaCatalogPropertyEntry[];
  }>;
  tags: Array<{ id: string; label?: string }>;
  updates: Array<{
    selector: string;
    setEntries: string[];
    addPaths: string[];
    removePaths: string[];
  }>;
}

export interface SchemaCatalogPropertyEntry {
  id: string;
  label?: string;
  type: PropertySchema['type'];
  description?: string;
  values?: string[];
  allowOther?: boolean;
  properties?: SchemaCatalogPropertyEntry[];
}

export const REQUIRED_DOCUMENT_KEYS = ['version', 'schemaRefs', 'entities', 'relations'] as const;

export const OPTIONAL_DOCUMENT_KEYS = ['inputs', 'metadata', 'view'] as const;
export const PREFERRED_CONTAINMENT_ENCODING = 'children' as const;
export const ACCEPTED_CONTAINMENT_ENCODINGS = ['children'] as const;
export const RELATION_DIRECTION_RULE = 'directed-by-default' as const;
export const SCHEMA_REFS_REQUIRED = true;
export const EXPLICIT_IDS_PREFERRED = true;
export const PROVENANCE_LOCATION_FIELDS = ['path', 'symbol?', 'note?', 'input?'] as const;
export const PROVENANCE_LOCATION_INPUT_RULE = 'optional-when-single-input' as const;
export const WORKER_INJECTS_PRIMARY_GIT_INPUT = true;
export const WORKER_REQUIRES_ENTITY_PROVENANCE = true;
export const WORKER_REQUIRES_RELATION_PROVENANCE = true;
export const LINE_NUMBERS_REQUIRED_IN_PROVENANCE = false;

export const DIAGRAM_PROMPT_POLICIES: PromptPolicies = {
  omitViewByDefault: true,
  preferFewerStrongerBoundaries: true,
  avoidHelpersFunctionsClasses: true,
  avoidDuplicatingExternalIoAtCodeLayer: true,
  serviceVsModuleRule:
    'Use service for promoted architectural boundaries and code.module for lower-level implementation boundaries.',
  runtimeOverToolingRule:
    'At every level, prefer shipped runtime architecture over build tooling, tests, local dev helpers, packaging/install scaffolding, and dev-only endpoints. Treat bootstrap, package, service-unit, installer, and postinstall code as supporting evidence for runtime boundaries unless delivery/install behavior is itself central to the architecture.',
  modelingGuardrails: [
    'Do not invent schema type ids to match repo concepts. Put the concept label in the entity name, but choose an existing ontology type.',
    'Internal implementation areas such as shells, stores, registries, adapters, helpers, shared models, plugin settings, queue factories, pipelines, and composition layers should usually be core/code.types.module.',
    'Use runtime boundary types only for deployable or externally meaningful surfaces. Use core/web-app.types.group for mixed organizational containers that are not deployable runtimes.',
    'All levels should explain runtime architecture. Use package manifests, service units, postinstall hooks, shell completions, docker/init wiring, installers, and bootstrap entrypoints as evidence for runtime boundaries, not as primary architecture nodes, unless the current diagram is explicitly modeling delivery or runtime operations.',
    'Group props are not labels: for mixed groups, set props.mode to mixed and omit props.groupType. For typed groups, set props.mode to typed and set props.groupType to an exact existing ontology type id such as core/code.types.module, then ensure every child uses that same type.',
    'Containment must match the active schemas and their activated layers exactly. Same-layer containment still follows explicit schema rules. A layer n container may generically contain a layer n+1 containable, but not a deeper or lower-layer child.',
    'Honor schema analysis.topLevelBias hints. Types marked analysis.topLevelBias=avoid should usually stay nested under a stronger containing runtime boundary instead of becoming top-level nodes unless no better outer boundary exists.',
    'If the schema catalog includes a gallery-owned repo-specific schema that clearly matches this repository, prefer activating it instead of forcing a weaker core-only approximation.',
    'Use core/frontend.types.frontend for browser application boundaries. Do not invent route-like frontend subtypes unless an active schema explicitly defines them, and do not invent core/web-app.types.frontend.',
    'Relation endpoints must obey the schema: calls is the default for compute, interface, and code interactions; publishes-to and consumes-from must target queueing or topic-like entities; reads, writes, and read-writes are for storage or table-like targets, not queues/topics and not module-to-module dependencies.',
    'When modeling queue internals, represent concrete queues or channels as topic or subscription children under a queue, or represent queue-management code as core/code.types.module under a service. Do not place code modules directly under a queue.',
  ],
};

export const CANONICAL_EXAMPLE_YAML = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
inputs:
  - id: primary
    kind: git
    repo: https://github.com/example/checkout
    revision: abc123
    role: primary
entities:
  - id: app-checkout
    type: core/web-app.types.application
    name: Checkout App
    provenance:
      locations:
        - input: primary
          path: src/app.ts
    children:
      - id: api-checkout
        type: core/web-app.types.api
        name: Checkout API
        provenance:
          locations:
            - input: primary
              path: src/api/index.ts
        children:
          - id: endpoint-create-order
            type: core/web-app.types.api-endpoint
            name: Create Order
            provenance:
              locations:
                - input: primary
                  path: src/api/orders.ts
                  symbol: createOrderEndpoint
            props:
              http:
                method: POST
                path: /orders
                auth: auth
            children:
              - id: module-create-order
                type: core/code.types.module
                name: Create Order Flow
                provenance:
                  locations:
                    - input: primary
                      path: src/workflows/create-order.ts
                      symbol: createOrder
                props:
                  language: typescript
      - id: service-validation
        type: core/web-app.types.service
        name: Validation Service
        provenance:
          locations:
            - input: primary
              path: src/validation/index.ts
        props:
          deployability: embedded
        children:
          - id: module-schema-validation
            type: core/code.types.module
            name: Schema Validation
            provenance:
              locations:
                - input: primary
                  path: src/validation/schema.ts
                  symbol: validateSchema
            props:
              language: typescript
relations:
  - id: rel-create-order-calls-validation
    type: core/software.relations.calls
    from: module-create-order
    to: module-schema-validation
    provenance:
      locations:
        - input: primary
          path: src/workflows/create-order.ts
          symbol: createOrder
`;

function sortById<T extends { id: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

function collectOperationEntries(value: Record<string, unknown> | undefined): string[] {
  if (!value) {
    return [];
  }
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, entry]) =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
        ? `${path}=${String(entry)}`
        : path,
    );
}

function collectOperationPaths(value: Record<string, unknown> | undefined): string[] {
  if (!value) {
    return [];
  }
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function collectPropertyCatalogEntries(
  properties: PropertySchema[] | undefined,
): SchemaCatalogPropertyEntry[] | undefined {
  if (!properties || properties.length === 0) {
    return undefined;
  }

  return sortById(properties).map((property) => ({
    id: property.id,
    label: property.label,
    type: property.type,
    description: property.description,
    values: property.values ? [...property.values] : undefined,
    allowOther: property.allowOther,
    properties: collectPropertyCatalogEntries(property.properties),
  }));
}

export function buildDiagramSynthesisContract(
  schemaRegistry: SchemaRegistry,
): DiagramSynthesisContract {
  const schemaCatalog = [...schemaRegistry.modulesById.values()]
    .sort((left, right) => getSchemaModuleRef(left).localeCompare(getSchemaModuleRef(right)))
    .map((module) => {
      const schemaId = getSchemaModuleRef(module);
      return {
        schemaRef: getSchemaModuleRef(module, true),
        description: module.description,
        imports: [...(module.use ?? [])]
          .map((entry) => entry.schema)
          .sort((left, right) => left.localeCompare(right)),
        types: sortById(module.types).map((type) => ({
          id: buildQualifiedSchemaObjectId(schemaId, 'types', type.id),
          label: type.label,
          description: type.description,
          analysis: type.analysis?.topLevelBias
            ? { topLevelBias: type.analysis.topLevelBias }
            : undefined,
          properties: collectPropertyCatalogEntries(type.properties),
        })),
        relations: sortById(module.relations).map((relation) => ({
          id: buildQualifiedSchemaObjectId(schemaId, 'relations', relation.id),
          label: relation.label,
          directed: relation.directed ?? true,
          properties: collectPropertyCatalogEntries(relation.properties),
        })),
        tags: sortById(module.tags ?? []).map((tag) => ({
          id: buildQualifiedSchemaObjectId(schemaId, 'tags', tag.id),
          label: tag.label,
        })),
        updates: Object.entries(module.update ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([selector, operation]) => ({
            selector,
            setEntries: collectOperationEntries(operation.set),
            addPaths: collectOperationPaths(operation.add),
            removePaths: collectOperationPaths(operation.remove),
          })),
      } satisfies SchemaCatalogEntry;
    });

  return {
    validationRules: {
      requiredTopLevelKeys: [...REQUIRED_DOCUMENT_KEYS],
      optionalTopLevelKeys: [...OPTIONAL_DOCUMENT_KEYS],
      preferredContainmentEncoding: PREFERRED_CONTAINMENT_ENCODING,
      acceptedContainmentEncodings: [...ACCEPTED_CONTAINMENT_ENCODINGS],
      relationDirectionRule: RELATION_DIRECTION_RULE,
      schemaRefsRequired: SCHEMA_REFS_REQUIRED,
      explicitIdsPreferred: EXPLICIT_IDS_PREFERRED,
      provenanceLocationFields: [...PROVENANCE_LOCATION_FIELDS],
      provenanceLocationInputRule: PROVENANCE_LOCATION_INPUT_RULE,
      workerInjectsPrimaryGitInput: WORKER_INJECTS_PRIMARY_GIT_INPUT,
      workerRequiresEntityProvenance: WORKER_REQUIRES_ENTITY_PROVENANCE,
      workerRequiresRelationProvenance: WORKER_REQUIRES_RELATION_PROVENANCE,
      lineNumbersRequiredInProvenance: LINE_NUMBERS_REQUIRED_IN_PROVENANCE,
    },
    promptPolicies: { ...DIAGRAM_PROMPT_POLICIES },
    schemaCatalog,
    canonicalExampleYaml: CANONICAL_EXAMPLE_YAML,
  };
}
