import { createEntityDisplayTypeResolver } from '../../../model/entity-display';
import { resolveTypeLayoutDefaults } from '../../../model/layout-defaults';
import {
  resolvePropertyProjectionOptions,
  resolveTypeProjectionOptions,
  shouldProjectPropertyOnCard,
} from '../../../model/projection-contract';
import { resolveTypeDef } from '../../../model/schema';
import { CORE_GROUP_TYPE_ID, getSchemaObjectLocalId } from '../../../model/schema-ids';
import type { Entity, SchemaModule } from '../../../model/types';
import { resolveTypeVisualDefaults } from '../../../model/visual-defaults';
import { DEFAULT_NODE_SIZE } from '../layout/defaults';
import type { SceneNode, SceneTree } from '../tree/scene-tree';

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
    badges: string[];
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

const stringifyDisplayValue = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  return String(value);
};

const applyTemplate = (template: string, context: Record<string, unknown>) => {
  return template
    .replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = context[key];
      return value === undefined || value === null ? '' : String(value);
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const formatLabel = (value: string | undefined) => {
  if (!value) return undefined;
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
};

const pluralize = (label: string, count: number) => {
  const base = label.toLowerCase();
  if (count === 1) return base;
  if (base.endsWith('s')) return base;
  return `${base}s`;
};

const getStructuralChildCount = (node: SceneNode) => node.diagramChildCount ?? node.children.length;

const getStructuralChildTypeCounts = (node: SceneNode) => {
  if (node.diagramChildTypeCounts) {
    return node.diagramChildTypeCounts;
  }
  const counts: Record<string, number> = {};
  for (const child of node.children) {
    counts[child.entity.type] = (counts[child.entity.type] ?? 0) + 1;
  }
  return counts;
};

const getStructuralChildTypeCount = (node: SceneNode, typeId: string) => {
  const explicitCount = getStructuralChildTypeCounts(node)[typeId];
  if (typeof explicitCount === 'number') {
    return explicitCount;
  }
  return 0;
};

const buildShallowStructuralSummaryLabel = (node: SceneNode, schema: SchemaModule) => {
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

const collectBadges = (
  properties: SchemaModule['types'][number]['properties'] | undefined,
  value: Record<string, unknown> | undefined,
  rootProps: Record<string, unknown> | undefined,
): string[] => {
  if (!properties) return [];
  const badges: string[] = [];
  const ordered = [...properties]
    .map((property, index) => ({
      property,
      index,
      priority: resolvePropertyProjectionOptions(property)?.priority ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) =>
      left.priority !== right.priority ? left.priority - right.priority : left.index - right.index,
    )
    .map((entry) => entry.property);

  for (const property of ordered) {
    const projection = resolvePropertyProjectionOptions(property);
    const propertyValue = value ? (value[property.id] as unknown) : undefined;
    if (projection && shouldProjectPropertyOnCard(property)) {
      if (projection.template && propertyValue && typeof propertyValue === 'object') {
        const text = applyTemplate(projection.template, propertyValue as Record<string, unknown>);
        if (text) badges.push(text);
      } else {
        const raw = projection.valuePath
          ? getPropValue(rootProps, projection.valuePath)
          : propertyValue;
        const formatted = stringifyDisplayValue(raw);
        if (formatted) {
          if (property.label !== undefined) {
            badges.push(property.label ? `${property.label} ${formatted}` : formatted);
          } else {
            const fallbackLabel = formatLabel(property.id);
            badges.push(fallbackLabel ? `${fallbackLabel}: ${formatted}` : formatted);
          }
        }
      }
    }

    if (property.type === 'object' && property.properties) {
      const nestedValue =
        typeof propertyValue === 'object' ? (propertyValue as Record<string, unknown>) : undefined;
      badges.push(...collectBadges(property.properties, nestedValue, rootProps));
    }
  }

  return badges;
};

export function buildNodeVisualMap(params: {
  schema: SchemaModule;
  tree: SceneTree;
}): Map<string, ResolvedNodeVisual> {
  const { schema, tree } = params;
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
    const typeDef = resolveTypeDef(schema, entity.type);
    const identityVisual = resolveTypeVisualDefaults(
      resolveTypeDef(schema, resolveEntityDisplayTypeId(entity)),
    );
    const typeProjection = resolveTypeProjectionOptions(typeDef);
    const typeLayout = resolveTypeLayoutDefaults(typeDef);
    const rootProps = entity.props as Record<string, unknown> | undefined;
    const badges = collectBadges(typeDef?.properties, rootProps, rootProps);
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
        if (count > 0) {
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
      if (count > 0) {
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
    nodeVisuals.set(nodeId, {
      identity: {
        primaryTagId: identityVisual.primaryTag,
        fallbackHue: identityVisual.fallbackHue,
      },
      projection: {
        typeLabel: getEntityTypeLabel(entity),
        explicitLabel,
        badges,
        summaryLabel,
        richContent,
      },
      layout: {
        baseSize: typeLayout.baseSize ?? DEFAULT_NODE_SIZE,
      },
    });
  }

  return nodeVisuals;
}
