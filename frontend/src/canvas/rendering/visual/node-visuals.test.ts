import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId, CORE_GROUP_TYPE_ID } from '../../../model/schema-ids';
import type { SchemaModule, SemanticDocument } from '../../../model/types';
import { buildEntityTree, indexTree } from '../../../semantic';
import { buildSceneTree } from '../tree/scene-tree';
import { buildNodeVisualMap } from './node-visuals';

const INTERACTION_TAG_ID = buildQualifiedSchemaObjectId('user/test-display', 'tags', 'interaction');
const DATA_TAG_ID = buildQualifiedSchemaObjectId('user/test-display', 'tags', 'data');
const INFRA_TAG_ID = buildQualifiedSchemaObjectId('user/test-display', 'tags', 'infra');
const COMPONENT_TYPE_ID = buildQualifiedSchemaObjectId('user/test-display', 'types', 'component');
const SERVICE_TYPE_ID = buildQualifiedSchemaObjectId('user/test-display', 'types', 'service');
const CONTAINER_TYPE_ID = buildQualifiedSchemaObjectId('user/test-display', 'types', 'container');
const NOTE_TYPE_ID = buildQualifiedSchemaObjectId('user/test-display', 'types', 'note');
const IMAGE_TYPE_ID = buildQualifiedSchemaObjectId('user/test-display', 'types', 'image');

const schema: SchemaModule = {
  owner: 'user',
  name: 'test-display',
  version: '1',
  tags: [
    { id: INTERACTION_TAG_ID, label: 'Interaction', color: '#ff0000' },
    { id: DATA_TAG_ID, label: 'Data', color: '#00ff00' },
    { id: INFRA_TAG_ID, label: 'Infra', color: '#0000ff' },
  ],
  types: [
    {
      id: CONTAINER_TYPE_ID,
      label: 'Container',
      display: {
        primaryTag: INFRA_TAG_ID,
        count: { childTypes: [COMPONENT_TYPE_ID], label: 'components' },
      },
    },
    {
      id: COMPONENT_TYPE_ID,
      label: 'Component',
      display: {
        primaryTag: DATA_TAG_ID,
      },
    },
    {
      id: SERVICE_TYPE_ID,
      label: 'Service',
      display: {
        primaryTag: INTERACTION_TAG_ID,
        style: { hue: 280 },
        defaultSize: { width: 220, height: 140 },
      },
      properties: [
        {
          id: 'replicas',
          type: 'number',
          display: {
            priority: 1,
          },
        },
        {
          id: 'region',
          label: 'Region',
          type: 'string',
          display: {
            priority: 2,
          },
        },
        {
          id: 'status',
          label: '',
          type: 'string',
          display: {
            priority: 3,
          },
        },
        {
          id: 'runtime',
          type: 'object',
          properties: [
            {
              id: 'max_retries',
              type: 'number',
              display: {
                priority: 4,
              },
            },
          ],
        },
      ],
    },
    {
      id: NOTE_TYPE_ID,
      label: 'Note',
      display: {
        content: {
          kind: 'markdown',
          bodyPath: 'body',
        },
      },
      properties: [
        {
          id: 'body',
          type: 'string',
        },
      ],
    },
    {
      id: IMAGE_TYPE_ID,
      label: 'Image',
      display: {
        content: {
          kind: 'image',
          srcPath: 'media.src',
          altPath: 'media.alt',
          captionPath: 'caption',
        },
      },
      properties: [
        {
          id: 'media',
          type: 'object',
          properties: [
            { id: 'src', type: 'string' },
            { id: 'alt', type: 'string' },
          ],
        },
        {
          id: 'caption',
          type: 'string',
        },
      ],
    },
    {
      id: CORE_GROUP_TYPE_ID,
      label: 'Group',
      display: { primaryTag: INFRA_TAG_ID },
    },
  ],
  relations: [],
};

const buildVisualMap = (doc: SemanticDocument) => {
  const tree = buildSceneTree({ tree: buildEntityTree(doc) });
  return buildNodeVisualMap({ schema, tree });
};

describe('buildNodeVisualMap', () => {
  it('projects property badges, identity, and base size from the schema display config', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'svc',
          type: SERVICE_TYPE_ID,
          props: {
            replicas: 2,
            region: 'eu-west-2',
            status: 'healthy',
            runtime: {
              max_retries: 5,
            },
          },
        },
      ],
      relations: [],
    };

    const visual = buildVisualMap(doc).get('svc');
    expect(visual?.projection.badges).toContain('Replicas: 2');
    expect(visual?.projection.badges).toContain('Region eu-west-2');
    expect(visual?.projection.badges).toContain('healthy');
    expect(visual?.projection.badges).toContain('Max Retries: 5');
    expect(visual?.identity.primaryTagId).toBe(INTERACTION_TAG_ID);
    expect(visual?.identity.fallbackHue).toBe(280);
    expect(visual?.layout.baseSize).toEqual({ width: 220, height: 140 });
  });

  it('preserves authored summary labels only when the child count is non-zero', () => {
    const zeroCountDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [{ id: 'empty', type: CONTAINER_TYPE_ID, name: 'Empty Container' }],
      relations: [],
    };
    const populatedDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'parent',
          type: CONTAINER_TYPE_ID,
          name: 'Parent Container',
          children: [
            { id: 'child-a', type: COMPONENT_TYPE_ID, name: 'A' },
            { id: 'child-b', type: COMPONENT_TYPE_ID, name: 'B' },
          ],
        },
      ],
      relations: [],
    };

    expect(buildVisualMap(zeroCountDoc).get('empty')?.projection.summaryLabel).toBeUndefined();
    expect(buildVisualMap(populatedDoc).get('parent')?.projection.summaryLabel).toBe(
      '2 components',
    );
  });

  it('does not present a filtered authored count as a generic component total', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'parent',
          type: CONTAINER_TYPE_ID,
          name: 'Parent Container',
          children: [
            { id: 'child-counted', type: COMPONENT_TYPE_ID, name: 'Counted' },
            { id: 'child-other', type: NOTE_TYPE_ID, name: 'Other' },
          ],
        },
      ],
      relations: [],
    };

    expect(buildVisualMap(doc).get('parent')?.projection.summaryLabel).toBe('2 components');
  });

  it('keeps specific authored labels for intentionally filtered counts', () => {
    const specificSchema: SchemaModule = {
      ...schema,
      types: schema.types.map((type) =>
        type.id === CONTAINER_TYPE_ID
          ? {
              ...type,
              display: {
                ...type.display,
                count: { childTypes: [NOTE_TYPE_ID], label: 'notes' },
              },
            }
          : type,
      ),
    };
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'parent',
          type: CONTAINER_TYPE_ID,
          name: 'Parent Container',
          children: [
            { id: 'child-note', type: NOTE_TYPE_ID, name: 'Note' },
            { id: 'child-image', type: IMAGE_TYPE_ID, name: 'Image' },
          ],
        },
      ],
      relations: [],
    };
    const tree = buildSceneTree({ tree: buildEntityTree(doc) });
    const visual = buildNodeVisualMap({ schema: specificSchema, tree }).get('parent');

    expect(visual?.projection.summaryLabel).toBe('1 note');
  });

  it('resolves markdown and image rich content from the display content config', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'tour-note',
          type: NOTE_TYPE_ID,
          props: {
            body: 'Hello **world**',
          },
        },
        {
          id: 'tour-image',
          type: IMAGE_TYPE_ID,
          props: {
            media: {
              src: '/example.svg',
              alt: 'Example image',
            },
            caption: 'Rendered in the node',
          },
        },
      ],
      relations: [],
    };

    const visuals = buildVisualMap(doc);
    expect(visuals.get('tour-note')?.projection.richContent).toEqual({
      kind: 'markdown',
      markdown: 'Hello **world**',
    });
    expect(visuals.get('tour-image')?.projection.richContent).toEqual({
      kind: 'image',
      src: '/example.svg',
      alt: 'Example image',
      caption: 'Rendered in the node',
    });
  });

  it('resolves typed groups from groupType for type label, summary label, and identity', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'typed-group',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'typed', groupType: COMPONENT_TYPE_ID },
          children: [{ id: 'child-a', type: COMPONENT_TYPE_ID, name: 'A' }],
        },
      ],
      relations: [],
    };

    const visual = buildVisualMap(doc).get('typed-group');
    expect(visual?.identity.primaryTagId).toBe(DATA_TAG_ID);
    expect(visual?.projection.typeLabel).toBe('Component Group');
    expect(visual?.projection.summaryLabel).toBe('1 component');
  });

  it('does not present a filtered typed group count as a generic component total', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'typed-group',
          type: CORE_GROUP_TYPE_ID,
          props: { mode: 'typed', groupType: COMPONENT_TYPE_ID },
          children: [
            { id: 'child-counted', type: COMPONENT_TYPE_ID, name: 'Counted' },
            { id: 'child-other', type: NOTE_TYPE_ID, name: 'Other' },
          ],
        },
      ],
      relations: [],
    };

    expect(buildVisualMap(doc).get('typed-group')?.projection.summaryLabel).toBe('2 components');
  });

  it('uses the direct child type when an untyped expandable node is homogeneous', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'svc',
          type: SERVICE_TYPE_ID,
          name: 'App',
          children: [
            { id: 'tour-note-a', type: NOTE_TYPE_ID, name: 'Intro' },
            { id: 'tour-note-b', type: NOTE_TYPE_ID, name: 'Outro' },
          ],
        },
      ],
      relations: [],
    };

    const visual = buildVisualMap(doc).get('svc');
    expect(visual?.projection.summaryLabel).toBe('2 notes');
  });

  it('falls back to components when an untyped expandable node has mixed direct child types', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'svc',
          type: SERVICE_TYPE_ID,
          name: 'App',
          children: [
            { id: 'tour-note', type: NOTE_TYPE_ID, name: 'Intro' },
            { id: 'tour-image', type: IMAGE_TYPE_ID, name: 'Diagram' },
          ],
        },
      ],
      relations: [],
    };

    const visual = buildVisualMap(doc).get('svc');
    expect(visual?.projection.summaryLabel).toBe('2 components');
  });

  it('resolves mixed groups from child identity and falls back to the parent tag when empty', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'app',
          type: SERVICE_TYPE_ID,
          name: 'App',
          children: [
            {
              id: 'mixed-runtime',
              type: CORE_GROUP_TYPE_ID,
              props: { mode: 'mixed' },
              children: [{ id: 'worker-a', type: COMPONENT_TYPE_ID, name: 'A' }],
            },
            {
              id: 'mixed-empty',
              type: CORE_GROUP_TYPE_ID,
              props: { mode: 'mixed' },
            },
          ],
        },
      ],
      relations: [],
    };

    const visuals = buildVisualMap(doc);
    expect(visuals.get('mixed-runtime')?.identity.primaryTagId).toBe(DATA_TAG_ID);
    expect(visuals.get('mixed-runtime')?.projection.summaryLabel).toBe('1 component');
    expect(visuals.get('mixed-empty')?.identity.primaryTagId).toBe(INTERACTION_TAG_ID);
  });

  it('resolves mixed groups from semantic children even when the rendered tree hides descendants', () => {
    const mixedGroupEntity = {
      id: 'mixed-runtime',
      type: CORE_GROUP_TYPE_ID,
      props: { mode: 'mixed' },
      children: [{ id: 'worker-a', type: COMPONENT_TYPE_ID, name: 'A' }],
    };
    const tree = buildSceneTree({
      tree: indexTree({
        rootId: 'root',
        byId: new Map([
          [
            'root',
            {
              id: 'root',
              entity: { id: 'root', type: 'viewport', name: 'Root' },
              children: [
                {
                  id: 'mixed-runtime',
                  entity: mixedGroupEntity,
                  hasDiagramChildren: true,
                  children: [],
                },
              ],
            },
          ],
          [
            'mixed-runtime',
            {
              id: 'mixed-runtime',
              entity: mixedGroupEntity,
              hasDiagramChildren: true,
              children: [],
            },
          ],
        ]),
      }),
    });

    const visual = buildNodeVisualMap({ schema, tree }).get('mixed-runtime');
    expect(visual?.identity.primaryTagId).toBe(DATA_TAG_ID);
  });

  it('derives summaries from the provided rendered tree rather than hidden raw children', () => {
    const parentEntity = {
      id: 'parent',
      type: CONTAINER_TYPE_ID,
      name: 'Parent Container',
    };
    const visibleChild = {
      id: 'child-visible',
      type: COMPONENT_TYPE_ID,
      name: 'Visible Child',
    };
    const tree = buildSceneTree({
      tree: indexTree({
        rootId: 'root',
        byId: new Map([
          [
            'root',
            {
              id: 'root',
              entity: { id: 'root', type: 'viewport', name: 'Root' },
              children: [
                {
                  id: 'parent',
                  entity: parentEntity,
                  hasDiagramChildren: true,
                  children: [{ id: 'child-visible', entity: visibleChild, children: [] }],
                },
              ],
            },
          ],
          [
            'parent',
            {
              id: 'parent',
              entity: parentEntity,
              hasDiagramChildren: true,
              children: [{ id: 'child-visible', entity: visibleChild, children: [] }],
            },
          ],
          ['child-visible', { id: 'child-visible', entity: visibleChild, children: [] }],
        ]),
      }),
    });

    const visuals = buildNodeVisualMap({ schema, tree });
    expect(visuals.get('parent')?.projection.summaryLabel).toBe('1 component');
  });

  it('preserves summary counts from structural child metadata when descendants are hidden', () => {
    const parentEntity = {
      id: 'parent',
      type: CONTAINER_TYPE_ID,
      name: 'Parent Container',
    };
    const tree = buildSceneTree({
      tree: indexTree({
        rootId: 'root',
        byId: new Map([
          [
            'root',
            {
              id: 'root',
              entity: { id: 'root', type: 'viewport', name: 'Root' },
              children: [
                {
                  id: 'parent',
                  entity: parentEntity,
                  hasDiagramChildren: true,
                  diagramChildCount: 2,
                  diagramChildTypeCounts: { [COMPONENT_TYPE_ID]: 2 },
                  children: [],
                },
              ],
            },
          ],
          [
            'parent',
            {
              id: 'parent',
              entity: parentEntity,
              hasDiagramChildren: true,
              diagramChildCount: 2,
              diagramChildTypeCounts: { [COMPONENT_TYPE_ID]: 2 },
              children: [],
            },
          ],
        ]),
      }),
    });

    const visuals = buildNodeVisualMap({ schema, tree });
    expect(visuals.get('parent')?.projection.summaryLabel).toBe('2 components');
  });

  it('uses structural child metadata for shallow fallback summaries when descendants are hidden', () => {
    const parentEntity = {
      id: 'parent',
      type: SERVICE_TYPE_ID,
      name: 'Parent Service',
    };
    const tree = buildSceneTree({
      tree: indexTree({
        rootId: 'root',
        byId: new Map([
          [
            'root',
            {
              id: 'root',
              entity: { id: 'root', type: 'viewport', name: 'Root' },
              children: [
                {
                  id: 'parent',
                  entity: parentEntity,
                  hasDiagramChildren: true,
                  diagramChildCount: 3,
                  diagramChildTypeCounts: { [NOTE_TYPE_ID]: 1, [IMAGE_TYPE_ID]: 2 },
                  children: [],
                },
              ],
            },
          ],
          [
            'parent',
            {
              id: 'parent',
              entity: parentEntity,
              hasDiagramChildren: true,
              diagramChildCount: 3,
              diagramChildTypeCounts: { [NOTE_TYPE_ID]: 1, [IMAGE_TYPE_ID]: 2 },
              children: [],
            },
          ],
        ]),
      }),
    });

    const visuals = buildNodeVisualMap({ schema, tree });
    expect(visuals.get('parent')?.projection.summaryLabel).toBe('3 components');
  });
});
