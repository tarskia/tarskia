import { isGroupLikeType } from '../advanced/refinement-helpers';
import type { Entity, SchemaSemantics, SemanticDocument, SemanticSourceDocument } from './index';

const DOTTED_QUALIFIED_ID_PATTERN =
  /^(core|gallery|user)\.([a-z0-9]+(?:-[a-z0-9]+)*)\.(types|relations|traits|tags|properties)\./;

function normalizeQualifiedId(value: string): string {
  return value.replace(DOTTED_QUALIFIED_ID_PATTERN, '$1/$2.$3.');
}

function normalizeProps(props: Entity['props']): Entity['props'] {
  if (!props) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      key === 'groupType' && typeof value === 'string' ? normalizeQualifiedId(value) : value,
    ]),
  );
}

function normalizeEntity(entity: Entity, semantics: SchemaSemantics): Entity {
  const normalizedChildren = entity.children?.map((child) => normalizeEntity(child, semantics));
  const normalizedType = normalizeQualifiedId(entity.type);
  const normalizedProps = normalizeProps(entity.props);

  if (!isGroupLikeType(semantics, normalizedType)) {
    return {
      ...entity,
      type: normalizedType,
      props: normalizedProps,
      children: normalizedChildren,
    };
  }

  const props = normalizedProps ? { ...normalizedProps } : undefined;
  const mode = props?.mode;
  if (mode === 'mixed' && props && 'groupType' in props) {
    delete props.groupType;
  }

  return {
    ...entity,
    type: normalizedType,
    props: props && Object.keys(props).length > 0 ? props : undefined,
    children: normalizedChildren,
  };
}

function normalizeRelation(relation: SemanticDocument['relations'][number]) {
  return relation.type
    ? {
        ...relation,
        type: normalizeQualifiedId(relation.type),
      }
    : relation;
}

export function normalizeGeneratedDocument(
  doc: SemanticDocument,
  semantics: SchemaSemantics,
): SemanticDocument {
  return {
    ...doc,
    entities: doc.entities.map((entity) => normalizeEntity(entity, semantics)),
    relations: doc.relations.map((relation) => normalizeRelation(relation)),
  };
}

export function normalizeGeneratedSourceDocument(
  doc: SemanticSourceDocument,
  semantics: SchemaSemantics,
): SemanticSourceDocument {
  return {
    ...doc,
    entities: doc.entities.map((entity) => normalizeEntity(entity, semantics)),
  };
}
