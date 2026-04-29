import {
  type DisplayCapabilityDoc,
  PROPERTY_DISPLAY_CAPABILITIES,
  TYPE_DISPLAY_CAPABILITIES,
} from './display-contract';

export interface SchemaReferenceEntry {
  key: string;
  summary: string;
  details: string;
  example?: string;
  values?: string[];
}

export interface SchemaReferenceSection {
  id: string;
  title: string;
  description: string;
  entries: SchemaReferenceEntry[];
}

const toEntry = (
  capability: DisplayCapabilityDoc,
  key: string,
  example: string,
  values?: string[],
): SchemaReferenceEntry => ({
  key,
  summary: capability.summary,
  details: capability.details,
  example,
  values,
});

export const schemaReferenceSections: SchemaReferenceSection[] = [
  {
    id: 'module',
    title: 'Schema',
    description: 'Top-level keys that define a schema module and import other schemas.',
    entries: [
      {
        key: 'owner',
        summary: 'Namespace for the schema.',
        details:
          'Use core for bundled read-only schemas and user for editable local schemas in this version of the app.',
        example: 'owner: user',
      },
      {
        key: 'name',
        summary: 'Stable owner-local schema name.',
        details:
          'Schema names are URL-friendly slugs. The canonical schema ref is owner/name, for example core/web-app or user/payments.',
        example: 'name: commerce-platform',
      },
      {
        key: 'version',
        summary: 'Semantic version for the current published schema module.',
        details:
          'Versions are major.minor strings. Drafts can use 1.0 before publication, then the app manages bumping.',
        example: 'version: "1.0"',
      },
      {
        key: 'use[]',
        summary: 'Imports another schema version into this module.',
        details: 'Imports must be version-pinned. Aliases are used by update and remove selectors.',
        example: 'use:\n  - schema: core/web-app@0.3\n    alias: web',
      },
      {
        key: 'tags[]',
        summary: 'Defines reusable tags for visual identity and classification.',
        details: 'Tags can be used as defaultTags and as display.primaryTag values.',
        example: 'tags:\n  - id: private\n    label: Private\n    color: "#8f7dff"',
      },
      {
        key: 'traits[]',
        summary: 'Defines reusable trait groupings that types can inherit.',
        details:
          'Traits are useful for containment rules and relation constraints across many types.',
        example: 'traits:\n  - id: batch-capable\n    label: Batch Capable',
      },
    ],
  },
  {
    id: 'types',
    title: 'Types',
    description: 'Keys used to define entity types and their structural behavior.',
    entries: [
      {
        key: 'types[].id',
        summary: 'Stable local id for the type within this schema.',
        details: 'The app qualifies this by schema internally, so local ids can stay meaningful.',
        example: 'types:\n  - id: background-worker',
      },
      {
        key: 'types[].label',
        summary: 'Human-facing name for the type.',
        details: 'If omitted, the UI falls back to the type id.',
        example: 'label: Background Worker',
      },
      {
        key: 'types[].extends',
        summary: 'Inherits defaults and behavior from another type.',
        details: 'This merges traits, default tags, naming, containment, display, and properties.',
        example: 'extends: web.types.service',
      },
      {
        key: 'types[].traits',
        summary: 'Applies trait identities to the type.',
        details:
          'Traits feed containment rules, relation constraints, and other type matching logic.',
        example: 'traits: [compute, batch-capable]',
      },
      {
        key: 'types[].analysis.topLevelBias',
        summary: 'Hints whether this type should usually appear at the outer/top level.',
        details:
          'Use avoid for implementation-only types that should normally stay nested under stronger runtime boundaries, prefer for types that are strong candidates for top-level promotion, and neutral when no extra guidance is needed.',
        example: 'analysis:\n  topLevelBias: avoid',
      },
      {
        key: 'types[].defaultTags',
        summary: 'Default tags applied to entities of this type.',
        details:
          'Users can override default tags in the diagram, but this sets the starting point.',
        example: 'defaultTags: [service]',
      },
      {
        key: 'types[].containment',
        summary: 'Controls which child types or traits this type can contain.',
        details:
          'Use allowedChildTypes for precise control or allowedChildTraits for broader categories.',
        example:
          'containment:\n  allowedChildTypes: [web.types.api-endpoint]\n  allowedChildTraits: [group-like]',
      },
    ],
  },
  {
    id: 'traits',
    title: 'Traits',
    description: 'Reusable participation and expectation semantics shared across types.',
    entries: [
      {
        key: 'traits[].relationParticipation',
        summary: 'Declares which relations a trait can participate in.',
        details:
          'Relation participation is trait-owned and later unioned across a type’s full trait closure. Each entry names the relation and which endpoint side the trait supports.',
        example:
          'relationParticipation:\n  - relation: core/software.relations.calls\n    endpoint: from',
      },
      {
        key: 'traits[].analysis.flowType',
        summary: 'Adds soft ingress/egress expectations for types using the trait.',
        details:
          'Use source, sink, or through to express expected data-flow role. These are expectations for synthesis and validation guidance, not hard constraints.',
        example: 'analysis:\n  flowType: through',
        values: ['source', 'through', 'sink'],
      },
      {
        key: 'traits[].analysis.mayTerminate',
        summary: 'Allows a trait to act as a valid flow boundary when continuation is not visible.',
        details:
          'Use this for concepts such as UI surfaces, APIs, stores, and external integrations that may legitimately end a visible flow at the current diagram scope. This does not suppress normal flow expectations; it only marks acceptable stopping points for synthesis.',
        example: 'analysis:\n  mayTerminate: true',
      },
      {
        key: 'traits[].analysis.expectedRelationIds',
        summary: 'Lists relations that are commonly expected for the trait.',
        details:
          'Expected relations accumulate positively across traits and are intended for future worker and guidance layers.',
        example:
          'analysis:\n  expectedRelationIds: [core/software.relations.reads, core/software.relations.writes]',
      },
    ],
  },
  {
    id: 'relations',
    title: 'Relations',
    description: 'Keys that define relation types and how their endpoints fulfil flow semantics.',
    entries: [
      {
        key: 'relations[].id',
        summary: 'Stable local id for the relation type.',
        details: 'Relation ids are used by diagrams and by extension selectors.',
        example: 'relations:\n  - id: reads',
      },
      {
        key: 'relations[].label',
        summary: 'Human-facing relation label.',
        details: 'This is what the user sees when the full relation label is rendered.',
        example: 'label: reads',
      },
      {
        key: 'relations[].shortLabel',
        summary: 'Compact label for tighter rendering contexts.',
        details: 'Useful when the full label is too wide for edge rendering.',
        example: 'shortLabel: read',
      },
      {
        key: 'relations[].display.flowDirection',
        summary: 'Controls visual edge flow without changing relation semantics.',
        details:
          'Use reverse for pull-style relations such as reads or consumes-from when the visual flow should run opposite to the semantic from/to endpoints. Defaults to forward and does not affect endpoint validation.',
        example: 'display:\n  flowDirection: reverse',
      },
      {
        key: 'relations[].analysis.fulfills',
        summary: 'Declares which ingress or egress expectations each endpoint satisfies.',
        details:
          'Keep relation meaning and visuals on the relation definition while leaving endpoint permission ownership to traits. Fulfils metadata is later used to understand how edges satisfy node flow expectations.',
        example: 'analysis:\n  fulfills:\n    from: [egress]\n    to: [ingress]',
      },
      {
        key: 'relations[].properties',
        summary: 'Defines structured metadata carried by relation instances.',
        details:
          'Relation properties use the same property schema shape as type properties. Use them for things like methods, paths, schema refs, config payloads, and qualifiers.',
        example:
          'properties:\n  - id: method\n    type: enum\n    values: [GET, POST]\n  - id: requestSchema\n    type: string',
      },
    ],
  },
  {
    id: 'properties',
    title: 'Properties',
    description: 'Keys for type or relation properties and how type properties are shown on cards.',
    entries: [
      {
        key: 'properties[].id',
        summary: 'Stable key stored on entities in the diagram.',
        details: 'Property ids are the structural names; they should stay stable once in use.',
        example: '- id: retries\n  type: number',
      },
      {
        key: 'properties[].label',
        summary: 'Human-facing name shown for the property.',
        details:
          'If omitted, the UI falls back to a prettified version of the id. An empty label renders only the value.',
        example: '- id: region\n  label: Region\n  type: string',
      },
      {
        key: 'properties[].description',
        summary: 'Explains what the property means and when to populate it.',
        details:
          'Property descriptions are the main place to document intended semantics for both schema authors and worker generation. Use them to define scope and avoid vague catch-all fields.',
        example:
          '- id: language\n  type: enum\n  description: Primary implementation language for this module or subtree when known.',
      },
      {
        key: 'properties[].type',
        summary: 'Declares the property value kind.',
        details:
          'Supported values are string, number, boolean, enum, and object. Object properties can nest sub-properties.',
        example: '- id: auth\n  type: enum\n  values: [public, auth, admin]',
        values: ['string', 'number', 'boolean', 'enum', 'object'],
      },
      {
        key: 'properties[].values / allowOther',
        summary: 'Constrain enum values and whether additional values are allowed.',
        details: 'Useful for soft vocabularies where a core list exists but new values may appear.',
        example: '- id: database\n  type: enum\n  values: [postgres, mysql]\n  allowOther: true',
      },
      {
        key: 'properties[].properties',
        summary: 'Defines nested fields when a property is an object.',
        details:
          'Nested properties can still participate in card display through template or valuePath.',
        example:
          '- id: http\n  type: object\n  properties:\n    - id: method\n      type: enum\n    - id: path\n      type: string',
      },
    ],
  },
  {
    id: 'display',
    title: 'Display',
    description:
      'Supported visual defaults, projection hints, and layout hints for types and properties.',
    entries: [
      ...TYPE_DISPLAY_CAPABILITIES.map((capability) =>
        toEntry(
          capability,
          `types[].display.${capability.key}`,
          capability.key === 'primaryTag'
            ? 'display:\n  primaryTag: service'
            : capability.key === 'defaultSize'
              ? 'display:\n  defaultSize:\n    width: 180\n    height: 80'
              : capability.key === 'count'
                ? 'display:\n  count:\n    childTypes: [core/data-model.types.table]\n    label: tables'
                : 'display:\n  style:\n    hue: 210',
        ),
      ),
      ...PROPERTY_DISPLAY_CAPABILITIES.map((capability) =>
        toEntry(
          capability,
          capability.key === 'label'
            ? 'properties[].label'
            : `properties[].display.${capability.key}`,
          capability.key === 'label'
            ? '- id: region\n  label: Region\n  type: string'
            : capability.key === 'showIn'
              ? 'display:\n  showIn: hidden'
              : capability.key === 'valuePath'
                ? 'display:\n  valuePath: method'
                : capability.key === 'template'
                  ? 'display:\n  template: "{method} {path}"'
                  : 'display:\n  priority: 1',
          capability.key === 'showIn' ? ['card', 'hidden'] : undefined,
        ),
      ),
    ],
  },
  {
    id: 'extensions',
    title: 'Extensions',
    description: 'Keys for adapting imported schemas instead of redefining them.',
    entries: [
      {
        key: 'update.<selector>.set',
        summary: 'Replaces or sets fields on an imported object.',
        details:
          'Use the imported alias and an explicit section in the selector path. This is the most common extension operation.',
        example: 'update:\n  web.types.api-endpoint:\n    set:\n      label: API Endpoint',
      },
      {
        key: 'update.<selector>.add',
        summary: 'Adds array items or nested object values to an imported object.',
        details:
          'This is useful for adding traits, default tags, or nested properties without rewriting the whole object.',
        example: 'update:\n  web.types.service:\n    add:\n      traits: [batch-capable]',
      },
      {
        key: 'update.<selector>.remove',
        summary: 'Removes nested values from an imported object.',
        details:
          'Use this when you need to drop array items or nested properties from an imported definition.',
        example: 'update:\n  web.types.topic:\n    remove:\n      properties: [retentionHours]',
      },
      {
        key: 'remove.<selector>',
        summary: 'Removes imported objects or imported nested properties entirely.',
        details:
          'Remove selectors operate on imported schema sections and on type property collections.',
        example: 'remove:\n  web.relations:\n    - read-writes',
      },
    ],
  },
];
