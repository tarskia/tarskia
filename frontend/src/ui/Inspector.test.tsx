import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEntityIndex,
  buildQualifiedSchemaObjectId,
  CORE_GROUP_TYPE_ID,
  type Entity,
  type Relation,
  type SchemaModule,
} from '../semantic';
import { buildInspectorViewModel } from '../shell/buildInspectorViewModel';
import type { DiagramProvenanceSourceView } from '../shell/view-models';
import { buildTagOptions, Inspector, resolveTagInputToId } from './Inspector';

const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'interaction');
const DATA_TAG_ID = buildQualifiedSchemaObjectId('user/test', 'tags', 'data');
const CONTAINABLE_TRAIT_ID = buildQualifiedSchemaObjectId('user/test', 'traits', 'containable');
const API_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'api');
const TABLE_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'table');
const ENDPOINT_TYPE_ID = buildQualifiedSchemaObjectId('user/test', 'types', 'endpoint');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  tags: [
    { id: INTERACTION_TAG_ID, label: 'Interaction' },
    { id: DATA_TAG_ID, label: 'Data Layer' },
  ],
  traits: [{ id: CONTAINABLE_TRAIT_ID, label: 'Containable' }],
  types: [
    { id: API_TYPE_ID, label: 'API', defaultTags: [INTERACTION_TAG_ID] },
    {
      id: TABLE_TYPE_ID,
      label: 'Table',
      traits: [CONTAINABLE_TRAIT_ID],
      defaultTags: [DATA_TAG_ID],
    },
    {
      id: CORE_GROUP_TYPE_ID,
      label: 'Group',
      containment: {
        allowedChildTraits: [CONTAINABLE_TRAIT_ID],
      },
    },
    { id: ENDPOINT_TYPE_ID, label: 'Endpoint', traits: [CONTAINABLE_TRAIT_ID] },
  ],
  relations: [],
};

const renderInspector = (params: {
  entities: Entity[];
  selectedEntityId?: string;
  schemaOverride?: SchemaModule;
  initialTagEditMode?: boolean;
  diagramProvenanceSource?: DiagramProvenanceSourceView;
  relations?: Relation[];
  selectedRelationId?: string;
}) => {
  const {
    entities,
    selectedEntityId,
    schemaOverride = schema,
    initialTagEditMode,
    diagramProvenanceSource,
    relations = [],
    selectedRelationId,
  } = params;
  const entityIndex = buildEntityIndex(entities);
  const selectedEntity = selectedEntityId ? entityIndex.byId.get(selectedEntityId) : undefined;
  const selectedRelation = selectedRelationId
    ? relations.find((relation) => relation.id === selectedRelationId)
    : undefined;
  if (!selectedEntity && !selectedRelation) {
    throw new Error(`Missing selection ${selectedEntityId ?? selectedRelationId ?? 'unknown'}`);
  }
  const html = renderToStaticMarkup(
    <Inspector
      viewModel={buildInspectorViewModel({
        selectedEntity,
        selectedEdge: selectedRelation,
        entityIndex,
        schema: schemaOverride,
        diagramProvenanceSource,
      })}
      onUpdateName={vi.fn()}
      onUpdateTags={vi.fn()}
      onCreateChild={vi.fn()}
      onCreateSibling={vi.fn()}
      onDuplicate={vi.fn()}
      onMove={vi.fn()}
      onSetProp={vi.fn()}
      onDeleteProp={vi.fn()}
      onDelete={vi.fn()}
      initialTagEditMode={initialTagEditMode}
    />,
  );
  return html;
};

describe('Inspector', () => {
  it('keeps provenance locations without repo metadata from crashing the inspector view model', () => {
    const entityIndex = buildEntityIndex([
      {
        id: 'api-1',
        type: API_TYPE_ID,
        provenance: {
          confidence: 0.8,
          locations: [
            {
              path: 'src/api.ts',
              note: 'Detected from worker output without repo metadata',
            },
          ],
        },
      },
    ]);
    const selectedEntity = entityIndex.byId.get('api-1');

    expect(selectedEntity).toBeDefined();
    expect(
      buildInspectorViewModel({
        selectedEntity,
        entityIndex,
        schema,
        diagramProvenanceSource: {
          repo: 'https://github.com/example/diagram.git',
          commit: '0123456789abcdef0123456789abcdef01234567',
        },
      }),
    ).toMatchObject({
      kind: 'entity',
      provenance: {
        locations: [
          {
            path: 'src/api.ts',
            permalink:
              'https://github.com/example/diagram/blob/0123456789abcdef0123456789abcdef01234567/src/api.ts',
          },
        ],
      },
    });
  });

  it('renders provenance paths without repo and commit chrome', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'api-1',
          type: API_TYPE_ID,
          provenance: {
            confidence: 0.8,
            locations: [
              {
                path: 'src/api.ts',
                note: 'Detected from worker output without repo metadata',
              },
            ],
          },
        },
      ],
      selectedEntityId: 'api-1',
      diagramProvenanceSource: {
        repo: 'https://github.com/example/diagram.git',
        commit: '0123456789abcdef0123456789abcdef01234567',
      },
    });

    expect(html).toContain('src/api.ts');
    expect(html).toContain(
      'href="https://github.com/example/diagram/blob/0123456789abcdef0123456789abcdef01234567/src/api.ts"',
    );
    expect(html).toContain('Detected from worker output without repo metadata');
    expect(html).not.toContain('Repo:');
    expect(html).not.toContain('Commit:');
  });

  it('omits the provenance panel entirely when the selected entity has no provenance', () => {
    const html = renderInspector({
      entities: [{ id: 'api-1', type: API_TYPE_ID }],
      selectedEntityId: 'api-1',
    });

    expect(html).not.toContain('Provenance');
  });

  it('resolves tag input from user-facing labels to canonical ids', () => {
    const options = buildTagOptions([
      { id: INTERACTION_TAG_ID, label: 'Interaction' },
      { id: DATA_TAG_ID, label: 'Data Layer' },
    ]);
    expect(resolveTagInputToId('Interaction', options)).toBe(INTERACTION_TAG_ID);
    expect(resolveTagInputToId('interaction', options)).toBe(INTERACTION_TAG_ID);
    expect(resolveTagInputToId(' data layer ', options)).toBe(DATA_TAG_ID);
    expect(resolveTagInputToId('custom-tag', options)).toBe('custom-tag');
    expect(resolveTagInputToId('   ', options)).toBeUndefined();
  });

  it('renders fallback title for nameless entities', () => {
    const html = renderInspector({
      entities: [{ id: 'api-1', type: API_TYPE_ID }],
      selectedEntityId: 'api-1',
    });
    expect(html).toContain('Unnamed API');
    expect(html).toContain('>API</span>');
  });

  it('does not render the schema type description in the inspector header', () => {
    const html = renderInspector({
      entities: [{ id: 'api-1', type: API_TYPE_ID }],
      selectedEntityId: 'api-1',
      schemaOverride: {
        ...schema,
        types: schema.types.map((type) =>
          type.id === API_TYPE_ID
            ? {
                ...type,
                description:
                  'Externally meaningful interface boundary rather than an internal code module.',
              }
            : type,
        ),
      },
    });

    expect(html).not.toContain(
      'Externally meaningful interface boundary rather than an internal code module.',
    );
  });

  it('still renders description as a normal property when present on the object', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'api-1',
          type: API_TYPE_ID,
          props: {
            description: 'Accepts external requests and fans into internal services.',
            owner: 'platform',
          },
        },
      ],
      selectedEntityId: 'api-1',
    });

    expect(html).toContain('>Description<');
    expect(html).toContain('value="Accepts external requests and fans into internal services."');
    expect(html).toContain('>Owner<');
    expect(html).toContain('value="platform"');
  });

  it('renders first-class entity descriptions in a dedicated section', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'api-1',
          type: API_TYPE_ID,
          description: 'Primary ingress surface for external clients.',
        },
      ],
      selectedEntityId: 'api-1',
    });

    expect(html).toContain('>Description<');
    expect(html).toContain('Primary ingress surface for external clients.');
  });

  it('renders first-class relation descriptions in the relation inspector', () => {
    const html = renderInspector({
      entities: [
        { id: 'api-1', type: API_TYPE_ID, name: 'API' },
        { id: 'endpoint-1', type: ENDPOINT_TYPE_ID, name: 'Endpoint' },
      ],
      relations: [
        {
          id: 'rel-1',
          from: 'api-1',
          to: 'endpoint-1',
          description: 'Routes inbound requests into the endpoint handler.',
        },
      ],
      selectedRelationId: 'rel-1',
    });

    expect(html).toContain('>Description<');
    expect(html).toContain('Routes inbound requests into the endpoint handler.');
  });

  it('renders typed group label in inspector type', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'tables-group',
          type: CORE_GROUP_TYPE_ID,
          props: { groupType: TABLE_TYPE_ID },
        },
      ],
      selectedEntityId: 'tables-group',
    });
    expect(html).toContain('>Table Group</span>');
  });

  it('uses the schema hue for the inspector type label', () => {
    const html = renderInspector({
      entities: [{ id: 'api-1', type: API_TYPE_ID }],
      selectedEntityId: 'api-1',
      schemaOverride: {
        ...schema,
        types: schema.types.map((type) =>
          type.id === API_TYPE_ID
            ? {
                ...type,
                display: {
                  style: { hue: 32 },
                },
              }
            : type,
        ),
      },
    });

    expect(html).toContain('hsla(32, 48%, 58%, 0.96)');
  });

  it('keeps structure controls for typed groups', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'tables-group',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'typed', groupType: TABLE_TYPE_ID },
        },
      ],
      selectedEntityId: 'tables-group',
    });
    expect(html).toContain('Add child');
    expect(html).toContain('Add sibling');
    expect(html).toContain('Parent');
    expect(html).toContain('Current: Top level');
    expect(html).toContain('Change parent');
  });

  it('shows the current parent in the reparent control and labels the action clearly', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'api-1',
          type: API_TYPE_ID,
          name: 'Payments API',
          children: [{ id: 'endpoint-1', type: ENDPOINT_TYPE_ID, name: 'List Payments' }],
        },
      ],
      selectedEntityId: 'endpoint-1',
    });

    expect(html).toContain('Parent');
    expect(html).toContain('Current: Payments API');
    expect(html).toContain('Change parent');
    expect(html).not.toContain('>Move<');
  });

  it('shows derived tags for typed groups', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'tables-group',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'typed', groupType: TABLE_TYPE_ID },
        },
      ],
      selectedEntityId: 'tables-group',
    });
    expect(html).toContain('Data Layer');
  });

  it('shows derived-tags note above tag editor and uses label-only autocomplete values', () => {
    const html = renderInspector({
      entities: [
        {
          id: 'tables-group',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'typed', groupType: TABLE_TYPE_ID },
        },
      ],
      selectedEntityId: 'tables-group',
      initialTagEditMode: true,
    });

    const derivedIndex = html.indexOf('Derived from schema:');
    const inputIndex = html.indexOf('placeholder="add tag"');
    expect(derivedIndex).toBeGreaterThanOrEqual(0);
    expect(inputIndex).toBeGreaterThanOrEqual(0);
    expect(derivedIndex).toBeLessThan(inputIndex);
    expect(html).toContain('value="Interaction"');
    expect(html).toContain('value="Data Layer"');
    expect(html).not.toContain(`value="${INTERACTION_TAG_ID}"`);
  });
});
