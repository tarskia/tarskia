import {
  buildDisambiguatedSchemaObjectLabels,
  CORE_GROUP_TYPE_ID,
  createEntityDisplayTypeResolver,
  type Entity,
  type EntityIndex,
  FREEFORM_RELATION_TYPE,
  getSchemaObjectLocalId,
  type PropertySchema,
  type Relation,
  resolveEntityEffectiveAndDerivedTags,
  resolveRelationEffectiveTags,
  resolveTypeDef,
  resolveTypeDisplayOptions,
  type SchemaModule,
  type SemanticDocument,
  traitMatches,
  typeMatches,
} from '../semantic';
import type {
  DiagramProvenanceSourceView,
  InspectorProvenanceView,
  InspectorViewModel,
} from './view-models';

const titleCase = (value: string) =>
  value.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getEntityTypeLabel = (schema: SchemaModule, entity: Entity) => {
  if (entity.type !== CORE_GROUP_TYPE_ID) {
    return resolveTypeDef(schema, entity.type)?.label ?? getSchemaObjectLocalId(entity.type);
  }
  const props = entity.props as Record<string, unknown> | undefined;
  const groupType = typeof props?.groupType === 'string' ? props.groupType : undefined;
  const childTypeLabel =
    (groupType ? resolveTypeDef(schema, groupType)?.label : undefined) ??
    (groupType ? getSchemaObjectLocalId(groupType) : undefined);
  return childTypeLabel ? `${childTypeLabel} Group` : 'Group';
};

const getEntityTypeHue = (
  schema: SchemaModule,
  entity: Entity,
  resolveEntityDisplayTypeId: (entity: Entity) => string,
) => {
  const typeHue = resolveTypeDisplayOptions(
    resolveTypeDef(schema, resolveEntityDisplayTypeId(entity)),
  ).hue;
  return typeof typeHue === 'number' ? typeHue : undefined;
};

const formatEntityLabel = (schema: SchemaModule, entity: Entity) =>
  entity.name?.trim() || getEntityTypeLabel(schema, entity);

const getTagLabel = (schema: SchemaModule, tagId: string) =>
  schema.tags?.find((tag) => tag.id === tagId)?.label ?? getSchemaObjectLocalId(tagId);

const getTagColor = (schema: SchemaModule, tagId: string) =>
  schema.tags?.find((tag) => tag.id === tagId)?.color;

const normalizeTagIds = (tags?: string[]) =>
  Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)));

const flattenSchemaFields = (
  properties: PropertySchema[] | undefined,
  prefixPath = '',
  prefixLabel = '',
): Array<{
  path: string;
  label: string;
  type: PropertySchema['type'];
  values?: string[];
  allowOther?: boolean;
}> => {
  if (!properties) return [];
  const fields: Array<{
    path: string;
    label: string;
    type: PropertySchema['type'];
    values?: string[];
    allowOther?: boolean;
  }> = [];
  for (const property of properties) {
    const nextPath = prefixPath ? `${prefixPath}.${property.id}` : property.id;
    const baseLabel = property.label ?? titleCase(property.id);
    const nextLabel = prefixLabel ? `${prefixLabel} / ${baseLabel}` : baseLabel;
    if (property.type === 'object' && property.properties && property.properties.length > 0) {
      fields.push(...flattenSchemaFields(property.properties, nextPath, nextLabel));
      continue;
    }
    fields.push({
      path: nextPath,
      label: nextLabel,
      type: property.type,
      values: property.values,
      allowOther: property.allowOther,
    });
  }
  return fields;
};

const flattenProps = (
  value: Record<string, unknown> | undefined,
  prefixPath = '',
): Array<{ path: string; value: unknown }> => {
  if (!value) return [];
  const entries: Array<{ path: string; value: unknown }> = [];
  for (const [key, item] of Object.entries(value)) {
    const nextPath = prefixPath ? `${prefixPath}.${key}` : key;
    if (isPlainObject(item) && Object.keys(item).length > 0) {
      entries.push(...flattenProps(item, nextPath));
      continue;
    }
    entries.push({ path: nextPath, value: item });
  }
  return entries;
};

const serializePropValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const resolveExternalHref = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const normalizeGitHubRepoBaseUrl = (repo?: string | null): string | undefined => {
  const normalized = repo?.trim();
  if (!normalized) return undefined;
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch?.[1]) return `https://github.com/${httpsMatch[1]}`;
  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1]) return `https://github.com/${sshMatch[1]}`;
  const sshUrlMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (sshUrlMatch?.[1]) return `https://github.com/${sshUrlMatch[1]}`;
  return undefined;
};

const buildGitHubProvenancePermalink = (
  repo?: string | null,
  commit?: string | null,
  path?: string | null,
): string | undefined => {
  const repoBaseUrl = normalizeGitHubRepoBaseUrl(repo);
  const revisionish = commit?.trim();
  const normalizedPath = path?.trim();
  if (!repoBaseUrl || !revisionish || !normalizedPath) return undefined;
  const encodedRevisionish = encodeURIComponent(revisionish);
  const encodedPath = normalizedPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${repoBaseUrl}/blob/${encodedRevisionish}/${encodedPath}`;
};

export const buildDiagramProvenanceSource = (
  doc: Pick<SemanticDocument, 'inputs'>,
): DiagramProvenanceSourceView | undefined => {
  const primaryInput = doc.inputs?.find((input) => input.role === 'primary') ?? doc.inputs?.[0];
  const repo = primaryInput?.repo?.trim();
  const commit = primaryInput?.revision?.trim();
  if (!repo && !commit) {
    return undefined;
  }
  return {
    repo: repo || undefined,
    commit: commit || undefined,
  };
};

const buildInspectorProvenance = (
  provenance: Entity['provenance'] | Relation['provenance'] | undefined,
  diagramProvenanceSource?: DiagramProvenanceSourceView,
): InspectorProvenanceView | undefined => {
  if (!provenance || provenance.locations.length === 0) {
    return undefined;
  }
  return {
    confidence: provenance.confidence,
    locations: provenance.locations.map((location) => ({
      path: location.path,
      symbol: location.symbol,
      note: location.note,
      permalink: buildGitHubProvenancePermalink(
        location.repo ?? diagramProvenanceSource?.repo,
        location.commit ?? diagramProvenanceSource?.commit,
        location.path,
      ),
    })),
  };
};

const collectDescendantIds = (entity: Entity, ids: Set<string>) => {
  ids.add(entity.id);
  for (const child of entity.children ?? []) collectDescendantIds(child, ids);
};

export const buildInspectorViewModel = (params: {
  selectedEntity?: Entity;
  selectedEdge?: Relation;
  entityIndex: EntityIndex;
  schema: SchemaModule;
  scopeRootId?: string;
  canFocusView?: boolean;
  diagramProvenanceSource?: DiagramProvenanceSourceView;
}): InspectorViewModel => {
  const {
    selectedEntity,
    selectedEdge,
    entityIndex,
    schema,
    scopeRootId,
    canFocusView,
    diagramProvenanceSource,
  } = params;

  if (!selectedEntity) {
    if (!selectedEdge) {
      return { kind: 'empty' };
    }
    const source = entityIndex.byId.get(selectedEdge.from);
    const target = entityIndex.byId.get(selectedEdge.to);
    const relationLabel = selectedEdge.type
      ? selectedEdge.type === FREEFORM_RELATION_TYPE
        ? (selectedEdge.label ?? FREEFORM_RELATION_TYPE)
        : (schema.relations.find((relation) => relation.id === selectedEdge.type)?.label ??
          getSchemaObjectLocalId(selectedEdge.type))
      : selectedEdge.state === 'none'
        ? 'none'
        : 'undecided';

    return {
      kind: 'relation',
      relationId: selectedEdge.id,
      relationLabel,
      description: selectedEdge.description,
      sourceLabel: source ? formatEntityLabel(schema, source) : selectedEdge.from,
      targetLabel: target ? formatEntityLabel(schema, target) : selectedEdge.to,
      displayedTags: resolveRelationEffectiveTags(schema, selectedEdge).map((tagId) => ({
        id: tagId,
        label: getTagLabel(schema, tagId),
        color: getTagColor(schema, tagId),
      })),
      propertyEntries: flattenProps(selectedEdge.props)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => {
          const relationTypeDef = selectedEdge.type
            ? schema.relations.find((relation) => relation.id === selectedEdge.type)
            : undefined;
          const relationFieldByPath = new Map(
            flattenSchemaFields(relationTypeDef?.properties).map((field) => [field.path, field]),
          );
          const field = relationFieldByPath.get(entry.path);
          return {
            path: entry.path,
            label: field?.label ?? titleCase(entry.path),
            value: serializePropValue(entry.value),
            href: resolveExternalHref(entry.value),
          };
        }),
      provenance: buildInspectorProvenance(selectedEdge.provenance, diagramProvenanceSource),
    };
  }

  const canContain = (parentType: string, childType: string) => {
    const parentDef = resolveTypeDef(schema, parentType);
    const containment = parentDef?.containment;
    if (!containment) return false;
    const typeOk = containment.allowedChildTypes
      ? typeMatches(schema, childType, containment.allowedChildTypes)
      : true;
    const traitOk = containment.allowedChildTraits
      ? traitMatches(schema, childType, containment.allowedChildTraits)
      : true;
    return typeOk && traitOk;
  };

  const canContainEntity = (parent: Entity, childType: string) => {
    if (!canContain(parent.type, childType)) return false;
    if (parent.type !== CORE_GROUP_TYPE_ID) return true;
    const props = parent.props as Record<string, unknown> | undefined;
    if (props?.mode !== 'typed') return true;
    const groupType = typeof props.groupType === 'string' ? props.groupType.trim() : '';
    if (!groupType) return true;
    return childType === groupType;
  };

  const selectedParentId = entityIndex.parentById.get(selectedEntity.id);
  const selectedParent = selectedParentId ? entityIndex.byId.get(selectedParentId) : undefined;
  const currentParentLabel = selectedParent
    ? formatEntityLabel(schema, selectedParent)
    : 'Top level';

  const childTypeOptions = buildDisambiguatedSchemaObjectLabels(
    schema.types
      .filter((type) => canContainEntity(selectedEntity, type.id))
      .map((type) => ({
        id: type.id,
        label: type.label,
        localId: type.localId,
        originSchemaId: type.originSchemaId,
      })),
  ).map((type) => ({ id: type.id, label: type.displayLabel }));

  const siblingTypeOptions = (
    !selectedParent
      ? buildDisambiguatedSchemaObjectLabels(
          schema.types.map((type) => ({
            id: type.id,
            label: type.label,
            localId: type.localId,
            originSchemaId: type.originSchemaId,
          })),
        )
      : buildDisambiguatedSchemaObjectLabels(
          schema.types
            .filter((type) => canContainEntity(selectedParent, type.id))
            .map((type) => ({
              id: type.id,
              label: type.label,
              localId: type.localId,
              originSchemaId: type.originSchemaId,
            })),
        )
  ).map((type) => ({ id: type.id, label: type.displayLabel }));

  const moveParentOptions = (() => {
    const excluded = new Set<string>();
    collectDescendantIds(selectedEntity, excluded);
    const options = Array.from(entityIndex.byId.values())
      .filter((candidate) => !excluded.has(candidate.id))
      .filter((candidate) => canContainEntity(candidate, selectedEntity.type))
      .map((candidate) => ({ id: candidate.id, label: formatEntityLabel(schema, candidate) }))
      .sort((left, right) => left.label.localeCompare(right.label));
    return [{ id: '', label: 'Top level' }, ...options];
  })();

  const typeDef = resolveTypeDef(schema, selectedEntity.type);
  const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver({
    byId: entityIndex.byId,
    parentById: entityIndex.parentById,
    childrenByParent: entityIndex.childrenByParent,
  });
  const selectedEntityTags = resolveEntityEffectiveAndDerivedTags(schema, selectedEntity, {
    childrenByParent: entityIndex.childrenByParent,
  });
  const explicitTagIds = normalizeTagIds(selectedEntity.tags);
  const derivedTagLabels = selectedEntityTags
    .filter((tagId) => !explicitTagIds.includes(tagId))
    .map((tagId) => getTagLabel(schema, tagId));
  const schemaFields = flattenSchemaFields(typeDef?.properties);
  const propertyEntries = flattenProps(selectedEntity.props).sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  return {
    kind: 'entity',
    entityId: selectedEntity.id,
    name: selectedEntity.name,
    description: selectedEntity.description,
    displayName:
      selectedEntity.name?.trim() || `Unnamed ${getEntityTypeLabel(schema, selectedEntity)}`,
    typeLabel: getEntityTypeLabel(schema, selectedEntity),
    typeHue: getEntityTypeHue(schema, selectedEntity, resolveEntityDisplayTypeId),
    displayedTags: selectedEntityTags.map((tagId) => ({
      id: tagId,
      label: getTagLabel(schema, tagId),
      color: getTagColor(schema, tagId),
    })),
    explicitTagIds,
    derivedTagLabels,
    availableTagOptions: Array.from(
      new Map(
        (schema.tags ?? []).map((tag) => [
          tag.id,
          { id: tag.id, label: tag.label ?? getSchemaObjectLocalId(tag.id) },
        ]),
      ).values(),
    ),
    propertyEntries: propertyEntries.map((entry) => {
      const field = schemaFields.find((candidate) => candidate.path === entry.path);
      return {
        path: entry.path,
        label: field?.label ?? titleCase(entry.path.split('.').join(' ')),
        value: serializePropValue(entry.value),
        href: resolveExternalHref(entry.value),
      };
    }),
    propertyFields: schemaFields,
    provenance: buildInspectorProvenance(selectedEntity.provenance, diagramProvenanceSource),
    selectedChildCount: entityIndex.childrenByParent.get(selectedEntity.id)?.length ?? 0,
    canFocusView: canFocusView !== false,
    isFocusedEntity: selectedEntity.id === scopeRootId,
    childTypeOptions,
    siblingTypeOptions,
    currentParentId: selectedParentId,
    currentParentLabel,
    moveParentOptions,
  };
};
