import {
  CORE_GROUP_TYPE_ID,
  type Entity,
  getSchemaObjectLocalId,
  pluralize,
  resolveTypeDef,
  type SchemaModule,
} from '@tarskia/diagram-semantics';
import { createEntityDisplayTypeResolver } from '../../../model/entity-display';
import { resolveTypeLayoutDefaults } from '../../../model/layout-defaults';
import { resolveTypeProjectionOptions } from '../../../model/projection-contract';
import { resolveTypeVisualDefaults } from '../../../model/visual-defaults';
import { DEFAULT_NODE_SIZE } from '../layout/defaults';
import type { LayoutNode, LayoutTree } from '../layout/layout-geometry';

export type ResolvedNodeRichContent =
  | {
      kind: 'markdown';
      markdown: string;
    }
  | {
      kind: 'image';
      src: string;
      alt?: string;
      caption?: string;
    };

export interface ResolvedNodeVisual {
  identity: {
    primaryTagId?: string;
    fallbackHue?: number;
  };
  projection: {
    typeLabel: string;
    explicitLabel?: string;
    summaryLabel?: string;
    richContent?: ResolvedNodeRichContent;
  };
  layout: {
    baseSize: { width: number; height: number };
  };
}

const getPropValue = (props: Record<string, unknown> | undefined, path: string) => {
  if (!props) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, props);
};

const getStringPropValue = (props: Record<string, unknown> | undefined, path: string) => {
  const value = getPropValue(props, path);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const formatLabel = (value: string | undefined) => {
  if (!value) return undefined;
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
};

const isGenericComponentCountLabel = (label: string, singularLabel?: string) => {
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedSingularLabel = singularLabel?.trim().toLowerCase();
  return (
    (normalizedLabel === 'component' || normalizedLabel === 'components') &&
    (!normalizedSingularLabel || normalizedSingularLabel === 'component')
  );
};

const getStructuralChildCount = (node: LayoutNode) =>
  node.diagramChildCount ?? node.children.length;

const getStructuralChildTypeCounts = (node: LayoutNode) => {
  if (node.diagramChildTypeCounts) {
    return node.diagramChildTypeCounts;
  }
  const counts: Record<string, number> = {};
  for (const child of node.children) {
    counts[child.entity.type] = (counts[child.entity.type] ?? 0) + 1;
  }
  return counts;
};

const getStructuralChildTypeCount = (node: LayoutNode, typeId: string) => {
  const explicitCount = getStructuralChildTypeCounts(node)[typeId];
  if (typeof explicitCount === 'number') {
    return explicitCount;
  }
  return 0;
};

const buildShallowStructuralSummaryLabel = (node: LayoutNode, schema: SchemaModule) => {
  const count = getStructuralChildCount(node);
  if (count <= 0) {
    return undefined;
  }

  const childTypeCounts = Object.entries(getStructuralChildTypeCounts(node)).filter(
    ([, childCount]) => childCount > 0,
  );
  if (childTypeCounts.length === 1) {
    const [typeId, typeCount] = childTypeCounts[0];
    const childType = resolveTypeDef(schema, typeId);
    const label =
      formatLabel(childType?.label ?? getSchemaObjectLocalId(typeId)) ??
      getSchemaObjectLocalId(typeId);
    return `${typeCount} ${pluralize(label, typeCount)}`;
  }

  return `${count} ${count === 1 ? 'component' : 'components'}`;
};

const visualCache = new WeakMap<SchemaModule, WeakMap<Entity, Map<string, ResolvedNodeVisual>>>();

export function buildNodeVisualMap(params: {
  schema: SchemaModule;
  tree: LayoutTree;
  uncached?: boolean;
}): Map<string, ResolvedNodeVisual> {
  const { schema, tree } = params;
  let schemaCache = visualCache.get(schema);
  if (!schemaCache) {
    schemaCache = new WeakMap();
    visualCache.set(schema, schemaCache);
  }
  const entityById = new Map<string, Entity>();
  const parentById = new Map<string, string | undefined>();
  const childrenByParent = new Map<string, Entity[]>();

  for (const [nodeId, sceneNode] of tree.byId.entries()) {
    entityById.set(nodeId, sceneNode.entity);
    parentById.set(nodeId, sceneNode.parentId);
    if (sceneNode.children.length > 0) {
      childrenByParent.set(
        nodeId,
        sceneNode.children.map((child) => child.entity),
      );
    }
  }

  const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver({
    byId: entityById,
    parentById,
    childrenByParent,
  });

  const getEntityTypeLabel = (entity: Entity) => {
    if (entity.type !== CORE_GROUP_TYPE_ID) {
      return resolveTypeDef(schema, entity.type)?.label ?? getSchemaObjectLocalId(entity.type);
    }
    const props = entity.props as Record<string, unknown> | undefined;
    const groupType = typeof props?.groupType === 'string' ? props.groupType : undefined;
    const typeLabel =
      (groupType ? resolveTypeDef(schema, groupType)?.label : undefined) ??
      (groupType ? getSchemaObjectLocalId(groupType) : undefined);
    return typeLabel ? `${typeLabel} Group` : 'Group';
  };

  const nodeVisuals = new Map<string, ResolvedNodeVisual>();
  for (const [nodeId, sceneNode] of tree.byId.entries()) {
    if (nodeId === tree.rootId) continue;
    const entity = sceneNode.entity;
    const displayTypeId = resolveEntityDisplayTypeId(entity);
    // Mixed-group identity and fallback child summaries can change with projection.
    // Entity/schema identity covers immutable semantic content; these cover the view inputs.
    const cacheKey = JSON.stringify([
      displayTypeId,
      sceneNode.hasChildren,
      getStructuralChildCount(sceneNode),
      getStructuralChildTypeCounts(sceneNode),
    ]);
    const entityCache = schemaCache.get(entity) ?? new Map<string, ResolvedNodeVisual>();
    const cached = params.uncached ? undefined : entityCache.get(cacheKey);
    if (cached) {
      nodeVisuals.set(nodeId, cached);
      continue;
    }
    const typeDef = resolveTypeDef(schema, entity.type);
    const identityVisual = resolveTypeVisualDefaults(resolveTypeDef(schema, displayTypeId));
    const typeProjection = resolveTypeProjectionOptions(typeDef);
    const typeLayout = resolveTypeLayoutDefaults(typeDef);
    const rootProps = entity.props as Record<string, unknown> | undefined;
    const richContent = (() => {
      const config = typeProjection.richContent;
      if (!config) return undefined;
      if (config.kind === 'markdown') {
        const markdown = getStringPropValue(rootProps, config.bodyPath ?? 'body');
        return markdown ? ({ kind: 'markdown', markdown } as const) : undefined;
      }

      const src = getStringPropValue(rootProps, config.srcPath ?? 'src');
      if (!src) return undefined;
      return {
        kind: 'image' as const,
        src,
        alt: getStringPropValue(rootProps, config.altPath ?? 'alt'),
        caption: getStringPropValue(rootProps, config.captionPath ?? 'caption'),
      };
    })();

    let summaryLabel: string | undefined;
    if (entity.type === CORE_GROUP_TYPE_ID) {
      const groupType = rootProps?.groupType;
      if (typeof groupType === 'string' && groupType.length > 0) {
        const count = getStructuralChildTypeCount(sceneNode, groupType);
        const childType = resolveTypeDef(schema, groupType);
        const label =
          formatLabel(childType?.label ?? getSchemaObjectLocalId(groupType)) ??
          getSchemaObjectLocalId(groupType);
        const countCoversAllChildren = count === getStructuralChildCount(sceneNode);
        if (count > 0 && (!isGenericComponentCountLabel(label) || countCoversAllChildren)) {
          summaryLabel = `${count} ${pluralize(label, count)}`;
        }
      } else {
        summaryLabel = buildShallowStructuralSummaryLabel(sceneNode, schema);
      }
    } else if (typeProjection.summary) {
      let count = 0;
      for (const childType of typeProjection.summary.childTypes) {
        count += getStructuralChildTypeCount(sceneNode, childType);
      }
      const countCoversAllChildren = count === getStructuralChildCount(sceneNode);
      const usesGenericComponentLabel = isGenericComponentCountLabel(
        typeProjection.summary.label,
        typeProjection.summary.singularLabel,
      );
      if (count > 0 && (!usesGenericComponentLabel || countCoversAllChildren)) {
        const label =
          count === 1
            ? (typeProjection.summary.singularLabel ??
              typeProjection.summary.label.replace(/s$/, ''))
            : typeProjection.summary.label;
        summaryLabel = `${count} ${label}`;
      }
    }
    if (!summaryLabel && sceneNode.hasChildren) {
      summaryLabel = buildShallowStructuralSummaryLabel(sceneNode, schema);
    }

    const explicitLabel = entity.name?.trim() || undefined;
    const visual: ResolvedNodeVisual = {
      identity: {
        primaryTagId: identityVisual.primaryTag,
        fallbackHue: identityVisual.fallbackHue,
      },
      projection: {
        typeLabel: getEntityTypeLabel(entity),
        explicitLabel,
        summaryLabel,
        richContent,
      },
      layout: {
        baseSize: Object.freeze({ ...(typeLayout.baseSize ?? DEFAULT_NODE_SIZE) }),
      },
    };
    Object.freeze(visual.identity);
    if (visual.projection.richContent) Object.freeze(visual.projection.richContent);
    Object.freeze(visual.projection);
    Object.freeze(visual.layout);
    Object.freeze(visual);
    nodeVisuals.set(nodeId, visual);
    if (!params.uncached) {
      entityCache.set(cacheKey, visual);
      if (entityCache.size > 8) entityCache.delete(entityCache.keys().next().value!);
      schemaCache.set(entity, entityCache);
    }
  }

  return nodeVisuals;
}
