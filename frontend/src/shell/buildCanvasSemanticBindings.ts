import type { GraphModel } from '../canvas/rendering/graph/graph-model';
import {
  addEntityToDocument,
  addRelationToDocument,
  buildDisambiguatedSchemaObjectLabels,
  CORE_CONTAINS_RELATION_ID,
  CORE_GROUP_TYPE_ID,
  createEntityDisplayTypeResolver,
  type Entity,
  type EntityIndex,
  getSchemaObjectLocalId,
  relationTypeMatchesEndpoints,
  resolveTypeDef,
  resolveTypeDisplayOptions,
  type SchemaModule,
  type SchemaRuntime,
  type SemanticDocument,
  typeMatches,
} from '../semantic';
import { createId } from '../util/id';
import type { CanvasSemanticBindings } from './view-models';

const getEntityTypeLabel = (schema: SchemaModule, entity: Entity) => {
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

const getEntityDisplayName = (schema: SchemaModule, entity: Entity) =>
  entity.name?.trim() ||
  resolveTypeDef(schema, entity.type)?.label ||
  getSchemaObjectLocalId(entity.type);

export const buildCanvasSemanticBindings = (params: {
  doc: SemanticDocument;
  schema: SchemaModule;
  schemaRuntime: Pick<SchemaRuntime, 'semantics'>;
  graph: GraphModel;
  entityIndex: Pick<EntityIndex, 'byId' | 'parentById' | 'childrenByParent'>;
  commitDoc: (
    updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
    options?: { undoable?: boolean },
  ) => void;
  canContainEntity: (parent: Entity, childType: string) => boolean;
  resolveDefaultEntityName: (
    typeId: string,
    requestedName: string | undefined,
    existingCount: number,
  ) => string | undefined;
}): CanvasSemanticBindings => {
  const {
    doc,
    schema,
    schemaRuntime,
    graph,
    entityIndex,
    commitDoc,
    canContainEntity,
    resolveDefaultEntityName,
  } = params;
  const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver({
    byId: entityIndex.byId,
    parentById: entityIndex.parentById,
    childrenByParent: entityIndex.childrenByParent,
  });

  const relationMatchesEndpoints = (
    sourceTypeId: string,
    targetTypeId: string,
    relation: SchemaModule['relations'][number],
  ) =>
    relationTypeMatchesEndpoints({
      semantics: schemaRuntime.semantics,
      relationType: relation,
      fromType: sourceTypeId,
      toType: targetTypeId,
    });
  const isRenderableRelation = (relationId: string) => relationId !== CORE_CONTAINS_RELATION_ID;

  return {
    getEntityDisplayName: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      return entity ? getEntityDisplayName(schema, entity) : entityId;
    },
    getEntityTypeLabel: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      return entity ? getEntityTypeLabel(schema, entity) : entityId;
    },
    getEntityFocusHue: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      if (!entity) return undefined;
      const typeHue = resolveTypeDisplayOptions(
        resolveTypeDef(schema, resolveEntityDisplayTypeId(entity)),
      ).hue;
      return typeof typeHue === 'number' ? typeHue : undefined;
    },
    listCandidateTypes: (sourceId) => {
      const sourceEntity = entityIndex.byId.get(sourceId);
      if (!sourceEntity) return [];
      const candidates = schema.types
        .filter((targetType) =>
          schema.relations.some(
            (relation) =>
              isRenderableRelation(relation.id) &&
              relationMatchesEndpoints(sourceEntity.type, targetType.id, relation),
          ),
        )
        .map((targetType) => ({
          id: targetType.id,
          label: resolveTypeDef(schema, targetType.id)?.label,
          localId: targetType.localId ?? getSchemaObjectLocalId(targetType.id),
          originSchemaId: targetType.originSchemaId,
        }));
      return buildDisambiguatedSchemaObjectLabels(candidates).map((candidate) => ({
        id: candidate.id,
        label: candidate.displayLabel,
      }));
    },
    listCandidateEntities: (sourceId) => {
      const candidateTypeIds = new Set(
        schema.types
          .filter((targetType) =>
            schema.relations.some(
              (relation) =>
                isRenderableRelation(relation.id) &&
                relationMatchesEndpoints(
                  entityIndex.byId.get(sourceId)?.type ?? '',
                  targetType.id,
                  relation,
                ),
            ),
          )
          .map((targetType) => targetType.id),
      );
      if (candidateTypeIds.size === 0) return [];
      return graph.entities
        .filter((entity) => typeMatches(schema, entity.type, Array.from(candidateTypeIds)))
        .map((entity) => ({
          id: entity.id,
          label: getEntityDisplayName(schema, entity),
        }));
    },
    listRelationOptions: (edgeId) => {
      const relation = doc.relations.find((candidate) => candidate.id === edgeId);
      if (!relation) return [];
      const source = entityIndex.byId.get(relation.from);
      const target = entityIndex.byId.get(relation.to);
      if (!source || !target) return [];
      return buildDisambiguatedSchemaObjectLabels(
        schema.relations.flatMap((candidate) => {
          if (!isRenderableRelation(candidate.id)) return [];
          if (!relationMatchesEndpoints(source.type, target.type, candidate)) return [];
          return [
            {
              id: candidate.id,
              label: candidate.label,
              localId: candidate.localId,
              originSchemaId: candidate.originSchemaId,
            },
          ];
        }),
      ).map((entry) => ({
        id: entry.id,
        label: entry.displayLabel,
      }));
    },
    createRelation: (from, to) => {
      commitDoc((prev) =>
        addRelationToDocument({
          doc: prev,
          relationId: createId('rel'),
          from,
          to,
        }),
      );
    },
    createRelatedEntity: (sourceId, typeId, requestedName) => {
      const sourceEntity = entityIndex.byId.get(sourceId);
      const sourceParentId = sourceEntity ? entityIndex.parentById.get(sourceEntity.id) : undefined;
      const siblingParent =
        sourceParentId && sourceEntity ? entityIndex.byId.get(sourceParentId) : undefined;
      const targetParentId =
        siblingParent && canContainEntity(siblingParent, typeId) ? sourceParentId : undefined;
      let createdEntityId = '';
      commitDoc((prev) => {
        const created = addEntityToDocument({
          doc: prev,
          typeId,
          parentId: targetParentId,
          name: requestedName,
          createEntityId: createId,
          resolveEntityName: resolveDefaultEntityName,
          canContainEntity,
        });
        createdEntityId = created.createdEntityId;
        return addRelationToDocument({
          doc: created.doc,
          relationId: createId('rel'),
          from: sourceId,
          to: createdEntityId,
        });
      });
      return createdEntityId || undefined;
    },
    setRelationType: (edgeId, type, label, state) => {
      commitDoc((prev) => ({
        ...prev,
        relations: prev.relations.map((relation) =>
          relation.id === edgeId ? { ...relation, type, label, state } : relation,
        ),
      }));
    },
    applyRelationOption: (edgeId, option) => {
      commitDoc((prev) => ({
        ...prev,
        relations: prev.relations.map((relation) =>
          relation.id === edgeId
            ? { ...relation, type: option.id, label: undefined, state: undefined }
            : relation,
        ),
      }));
    },
  };
};
