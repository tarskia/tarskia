import { resolveTypeDef } from '../schema';
import { getSchemaModuleRef } from '../schema-ref';
import type {
  EntityTypeDef,
  PropertySchema,
  RelationTypeDef,
  SchemaModule,
  TraitDef,
  TraitRelationParticipation,
} from '../types';
import type { SchemaCompatibilityChangeSubject } from './schema-compatibility-types';

export type SchemaDiffEntry =
  | {
      kind: 'schema_id_changed';
      subject: 'schema';
      targetId: string;
      displayId: string;
      previousId: string;
      nextId: string;
    }
  | {
      kind: 'object_added' | 'object_removed';
      subject: 'tag' | 'trait' | 'type' | 'relation';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'extends_changed';
      subject: 'trait' | 'type';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'trait_may_terminate_enabled' | 'trait_may_terminate_disabled';
      subject: 'trait';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'constraint_restricted' | 'constraint_relaxed';
      subject: 'trait' | 'type' | 'relation';
      targetId: string;
      displayId: string;
      label: string;
    }
  | {
      kind: 'constraint_values_removed' | 'constraint_values_added';
      subject: 'trait' | 'type' | 'relation';
      targetId: string;
      displayId: string;
      label: string;
      values: string[];
    }
  | {
      kind: 'type_traits_removed' | 'type_traits_added';
      subject: 'type';
      targetId: string;
      displayId: string;
      values: string[];
    }
  | {
      kind: 'name_required_enabled' | 'name_required_disabled';
      subject: 'type';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'containment_added' | 'containment_removed';
      subject: 'type';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'relation_became_directed' | 'relation_became_undirected';
      subject: 'relation';
      targetId: string;
      displayId: string;
    }
  | {
      kind: 'relation_flow_direction_changed';
      subject: 'relation';
      targetId: string;
      displayId: string;
      previousDirection: 'forward' | 'reverse';
      nextDirection: 'forward' | 'reverse';
    }
  | {
      kind: 'property_added' | 'property_removed';
      subject: 'property';
      targetId: string;
      displayId: string;
      ownerLabel: string;
      propertyId: string;
    }
  | {
      kind: 'property_type_changed';
      subject: 'property';
      targetId: string;
      displayId: string;
      ownerLabel: string;
      propertyId: string;
      previousType: string;
      nextType: string;
    }
  | {
      kind: 'property_allow_other_disabled' | 'property_allow_other_enabled';
      subject: 'property';
      targetId: string;
      displayId: string;
      ownerLabel: string;
      propertyId: string;
    }
  | {
      kind: 'property_enum_values_removed' | 'property_enum_values_added';
      subject: 'property';
      targetId: string;
      displayId: string;
      ownerLabel: string;
      propertyId: string;
      values: string[];
    };

const normalizeList = (values?: string[]) =>
  values ? Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)) : undefined;

const compareStringSets = (
  previous: string[] | undefined,
  next: string[] | undefined,
): { removed: string[]; added: string[] } => {
  const previousSet = new Set(previous ?? []);
  const nextSet = new Set(next ?? []);
  return {
    removed: [...previousSet]
      .filter((value) => !nextSet.has(value))
      .sort((left, right) => left.localeCompare(right)),
    added: [...nextSet]
      .filter((value) => !previousSet.has(value))
      .sort((left, right) => left.localeCompare(right)),
  };
};

const getObjectDisplayId = (value: { id: string; localId?: string }) => value.localId ?? value.id;

const addDiff = (store: Map<string, SchemaDiffEntry>, entry: SchemaDiffEntry) => {
  store.set(JSON.stringify(entry), entry);
};

const compareConstraintLists = (
  owner: {
    subject: 'trait' | 'type' | 'relation';
    targetId: string;
    displayId: string;
    label: string;
  },
  previous: string[] | undefined,
  next: string[] | undefined,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  const previousNormalized = normalizeList(previous);
  const nextNormalized = normalizeList(next);
  if (!previousNormalized && !nextNormalized) return;
  if (!previousNormalized && nextNormalized) {
    addDiff(diffs, {
      kind: 'constraint_restricted',
      subject: owner.subject,
      targetId: owner.targetId,
      displayId: owner.displayId,
      label: owner.label,
    });
    return;
  }
  if (previousNormalized && !nextNormalized) {
    addDiff(diffs, {
      kind: 'constraint_relaxed',
      subject: owner.subject,
      targetId: owner.targetId,
      displayId: owner.displayId,
      label: owner.label,
    });
    return;
  }
  const { removed, added } = compareStringSets(previousNormalized, nextNormalized);
  if (removed.length > 0) {
    addDiff(diffs, {
      kind: 'constraint_values_removed',
      subject: owner.subject,
      targetId: owner.targetId,
      displayId: owner.displayId,
      label: owner.label,
      values: removed,
    });
  }
  if (added.length > 0) {
    addDiff(diffs, {
      kind: 'constraint_values_added',
      subject: owner.subject,
      targetId: owner.targetId,
      displayId: owner.displayId,
      label: owner.label,
      values: added,
    });
  }
};

const stringifyTraitParticipation = (entry: TraitRelationParticipation) =>
  `${entry.relation}:${entry.endpoint}`;

const compareTraitBehavior = (
  previous: TraitDef,
  next: TraitDef,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  const traitId = previous.id;
  const traitDisplayId = getObjectDisplayId(previous);

  compareConstraintLists(
    {
      subject: 'trait',
      targetId: traitId,
      displayId: traitDisplayId,
      label: `Trait ${traitDisplayId} relation participation`,
    },
    previous.relationParticipation?.map(stringifyTraitParticipation),
    next.relationParticipation?.map(stringifyTraitParticipation),
    diffs,
  );
  compareConstraintLists(
    {
      subject: 'trait',
      targetId: traitId,
      displayId: traitDisplayId,
      label: `Trait ${traitDisplayId} expected relations`,
    },
    previous.analysis?.expectedRelationIds,
    next.analysis?.expectedRelationIds,
    diffs,
  );
  if (previous.analysis?.mayTerminate !== next.analysis?.mayTerminate) {
    addDiff(diffs, {
      kind: next.analysis?.mayTerminate
        ? 'trait_may_terminate_enabled'
        : 'trait_may_terminate_disabled',
      subject: 'trait',
      targetId: traitId,
      displayId: traitDisplayId,
    });
  }
};

const compareContainment = (
  previous: EntityTypeDef,
  next: EntityTypeDef,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  const typeId = previous.id;
  const typeDisplayId = getObjectDisplayId(previous);
  if (!previous.containment && !next.containment) return;
  if (!previous.containment && next.containment) {
    addDiff(diffs, {
      kind: 'containment_added',
      subject: 'type',
      targetId: typeId,
      displayId: typeDisplayId,
    });
    return;
  }
  if (previous.containment && !next.containment) {
    addDiff(diffs, {
      kind: 'containment_removed',
      subject: 'type',
      targetId: typeId,
      displayId: typeDisplayId,
    });
    return;
  }
  compareConstraintLists(
    {
      subject: 'type',
      targetId: typeId,
      displayId: typeDisplayId,
      label: `Type ${typeDisplayId} containment child types`,
    },
    previous.containment?.allowedChildTypes,
    next.containment?.allowedChildTypes,
    diffs,
  );
  compareConstraintLists(
    {
      subject: 'type',
      targetId: typeId,
      displayId: typeDisplayId,
      label: `Type ${typeDisplayId} containment child traits`,
    },
    previous.containment?.allowedChildTraits,
    next.containment?.allowedChildTraits,
    diffs,
  );
};

const compareProperties = (
  ownerLabel: string,
  ownerTargetId: string,
  previous: PropertySchema[] | undefined,
  next: PropertySchema[] | undefined,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  const previousMap = new Map((previous ?? []).map((property) => [property.id, property]));
  const nextMap = new Map((next ?? []).map((property) => [property.id, property]));
  for (const propertyId of previousMap.keys()) {
    if (!nextMap.has(propertyId)) {
      addDiff(diffs, {
        kind: 'property_removed',
        subject: 'property',
        targetId: `${ownerTargetId}.${propertyId}`,
        displayId: `${ownerLabel}.${propertyId}`,
        ownerLabel,
        propertyId,
      });
    }
  }
  for (const propertyId of nextMap.keys()) {
    if (!previousMap.has(propertyId)) {
      addDiff(diffs, {
        kind: 'property_added',
        subject: 'property',
        targetId: `${ownerTargetId}.${propertyId}`,
        displayId: `${ownerLabel}.${propertyId}`,
        ownerLabel,
        propertyId,
      });
    }
  }

  for (const [propertyId, previousProperty] of previousMap) {
    const nextProperty = nextMap.get(propertyId);
    if (!nextProperty) continue;
    if (previousProperty.type !== nextProperty.type) {
      addDiff(diffs, {
        kind: 'property_type_changed',
        subject: 'property',
        targetId: `${ownerTargetId}.${propertyId}`,
        displayId: `${ownerLabel}.${propertyId}`,
        ownerLabel,
        propertyId,
        previousType: previousProperty.type,
        nextType: nextProperty.type,
      });
      continue;
    }
    if ((previousProperty.allowOther ?? false) && !(nextProperty.allowOther ?? false)) {
      addDiff(diffs, {
        kind: 'property_allow_other_disabled',
        subject: 'property',
        targetId: `${ownerTargetId}.${propertyId}`,
        displayId: `${ownerLabel}.${propertyId}`,
        ownerLabel,
        propertyId,
      });
    } else if (!(previousProperty.allowOther ?? false) && (nextProperty.allowOther ?? false)) {
      addDiff(diffs, {
        kind: 'property_allow_other_enabled',
        subject: 'property',
        targetId: `${ownerTargetId}.${propertyId}`,
        displayId: `${ownerLabel}.${propertyId}`,
        ownerLabel,
        propertyId,
      });
    }
    if (previousProperty.type === 'enum' && nextProperty.type === 'enum') {
      const { removed, added } = compareStringSets(previousProperty.values, nextProperty.values);
      if (removed.length > 0) {
        addDiff(diffs, {
          kind: 'property_enum_values_removed',
          subject: 'property',
          targetId: `${ownerTargetId}.${propertyId}`,
          displayId: `${ownerLabel}.${propertyId}`,
          ownerLabel,
          propertyId,
          values: removed,
        });
      }
      if (added.length > 0) {
        addDiff(diffs, {
          kind: 'property_enum_values_added',
          subject: 'property',
          targetId: `${ownerTargetId}.${propertyId}`,
          displayId: `${ownerLabel}.${propertyId}`,
          ownerLabel,
          propertyId,
          values: added,
        });
      }
    }
    if (previousProperty.type === 'object' && nextProperty.type === 'object') {
      compareProperties(
        `${ownerLabel} property ${propertyId}`,
        `${ownerTargetId}.${propertyId}`,
        previousProperty.properties,
        nextProperty.properties,
        diffs,
      );
    }
  }
};

const compareRelations = (
  previous: RelationTypeDef,
  next: RelationTypeDef,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  const relationId = previous.id;
  const relationDisplayId = getObjectDisplayId(previous);
  const previousFlowDirection = previous.display?.flowDirection ?? 'forward';
  const nextFlowDirection = next.display?.flowDirection ?? 'forward';
  if ((previous.directed ?? true) && !(next.directed ?? true)) {
    addDiff(diffs, {
      kind: 'relation_became_undirected',
      subject: 'relation',
      targetId: relationId,
      displayId: relationDisplayId,
    });
  } else if (!(previous.directed ?? true) && (next.directed ?? true)) {
    addDiff(diffs, {
      kind: 'relation_became_directed',
      subject: 'relation',
      targetId: relationId,
      displayId: relationDisplayId,
    });
  }
  if (previousFlowDirection !== nextFlowDirection) {
    addDiff(diffs, {
      kind: 'relation_flow_direction_changed',
      subject: 'relation',
      targetId: relationId,
      displayId: relationDisplayId,
      previousDirection: previousFlowDirection,
      nextDirection: nextFlowDirection,
    });
  }

  compareConstraintLists(
    {
      subject: 'relation',
      targetId: relationId,
      displayId: relationDisplayId,
      label: `Relation ${relationDisplayId} fulfilment from`,
    },
    previous.analysis?.fulfills?.from,
    next.analysis?.fulfills?.from,
    diffs,
  );
  compareConstraintLists(
    {
      subject: 'relation',
      targetId: relationId,
      displayId: relationDisplayId,
      label: `Relation ${relationDisplayId} fulfilment to`,
    },
    previous.analysis?.fulfills?.to,
    next.analysis?.fulfills?.to,
    diffs,
  );
  compareProperties(
    `Relation ${relationDisplayId}`,
    relationId,
    previous.properties,
    next.properties,
    diffs,
  );
};

const compareAddedOrRemovedObjects = <T extends { id: string; localId?: string }>(
  subject: Extract<SchemaCompatibilityChangeSubject, 'tag' | 'trait' | 'type' | 'relation'>,
  previous: Map<string, T>,
  next: Map<string, T>,
  diffs: Map<string, SchemaDiffEntry>,
) => {
  for (const [objectId, object] of previous) {
    if (!next.has(objectId)) {
      addDiff(diffs, {
        kind: 'object_removed',
        subject,
        targetId: objectId,
        displayId: getObjectDisplayId(object),
      });
    }
  }
  for (const [objectId, object] of next) {
    if (!previous.has(objectId)) {
      addDiff(diffs, {
        kind: 'object_added',
        subject,
        targetId: objectId,
        displayId: getObjectDisplayId(object),
      });
    }
  }
};

export const extractSchemaDiff = (
  previous: SchemaModule,
  next: SchemaModule,
): SchemaDiffEntry[] => {
  const diffs = new Map<string, SchemaDiffEntry>();

  if (getSchemaModuleRef(previous) !== getSchemaModuleRef(next)) {
    addDiff(diffs, {
      kind: 'schema_id_changed',
      subject: 'schema',
      targetId: getSchemaModuleRef(next),
      displayId: getSchemaModuleRef(next),
      previousId: getSchemaModuleRef(previous),
      nextId: getSchemaModuleRef(next),
    });
  }

  const previousTagMap = new Map((previous.tags ?? []).map((tag) => [tag.id, tag]));
  const nextTagMap = new Map((next.tags ?? []).map((tag) => [tag.id, tag]));
  compareAddedOrRemovedObjects('tag', previousTagMap, nextTagMap, diffs);

  const previousTraitMap = new Map((previous.traits ?? []).map((trait) => [trait.id, trait]));
  const nextTraitMap = new Map((next.traits ?? []).map((trait) => [trait.id, trait]));
  compareAddedOrRemovedObjects('trait', previousTraitMap, nextTraitMap, diffs);
  for (const [traitId, previousTrait] of previousTraitMap) {
    const nextTrait = nextTraitMap.get(traitId);
    if (!nextTrait) continue;
    if ((previousTrait.extends ?? '') !== (nextTrait.extends ?? '')) {
      addDiff(diffs, {
        kind: 'extends_changed',
        subject: 'trait',
        targetId: traitId,
        displayId: getObjectDisplayId(previousTrait),
      });
    }
    compareTraitBehavior(previousTrait, nextTrait, diffs);
  }

  const previousTypeMap = new Map(previous.types.map((type) => [type.id, type]));
  const nextTypeMap = new Map(next.types.map((type) => [type.id, type]));
  compareAddedOrRemovedObjects('type', previousTypeMap, nextTypeMap, diffs);
  for (const [typeId, previousType] of previousTypeMap) {
    const nextType = nextTypeMap.get(typeId);
    if (!nextType) continue;
    const typeDisplayId = getObjectDisplayId(previousType);
    if ((previousType.extends ?? '') !== (nextType.extends ?? '')) {
      addDiff(diffs, {
        kind: 'extends_changed',
        subject: 'type',
        targetId: typeId,
        displayId: typeDisplayId,
      });
    }
    const previousResolved = resolveTypeDef(previous, typeId);
    const nextResolved = resolveTypeDef(next, typeId);
    if (!previousResolved || !nextResolved) continue;
    const previousTraits = normalizeList(previousResolved.traits) ?? [];
    const nextTraits = normalizeList(nextResolved.traits) ?? [];
    const { removed, added } = compareStringSets(previousTraits, nextTraits);
    if (removed.length > 0) {
      addDiff(diffs, {
        kind: 'type_traits_removed',
        subject: 'type',
        targetId: typeId,
        displayId: typeDisplayId,
        values: removed,
      });
    }
    if (added.length > 0) {
      addDiff(diffs, {
        kind: 'type_traits_added',
        subject: 'type',
        targetId: typeId,
        displayId: typeDisplayId,
        values: added,
      });
    }
    if (!(previousResolved.naming?.required ?? false) && (nextResolved.naming?.required ?? false)) {
      addDiff(diffs, {
        kind: 'name_required_enabled',
        subject: 'type',
        targetId: typeId,
        displayId: typeDisplayId,
      });
    } else if (
      (previousResolved.naming?.required ?? false) &&
      !(nextResolved.naming?.required ?? false)
    ) {
      addDiff(diffs, {
        kind: 'name_required_disabled',
        subject: 'type',
        targetId: typeId,
        displayId: typeDisplayId,
      });
    }
    compareContainment(previousResolved, nextResolved, diffs);
    compareProperties(
      `Type ${typeDisplayId}`,
      typeId,
      previousResolved.properties,
      nextResolved.properties,
      diffs,
    );
  }

  const previousRelationMap = new Map(
    previous.relations.map((relation) => [relation.id, relation]),
  );
  const nextRelationMap = new Map(next.relations.map((relation) => [relation.id, relation]));
  compareAddedOrRemovedObjects('relation', previousRelationMap, nextRelationMap, diffs);
  for (const [relationId, previousRelation] of previousRelationMap) {
    const nextRelation = nextRelationMap.get(relationId);
    if (!nextRelation) continue;
    compareRelations(previousRelation, nextRelation, diffs);
  }

  return [...diffs.values()];
};
