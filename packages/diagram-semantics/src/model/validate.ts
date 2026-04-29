import {
  type Diagnostic,
  diagramDiagnostic,
  type RelationAnalysisDiagnosticDetails,
} from './diagnostics';
import { buildEntityIndex } from './entity-tree';
import { resolveTypeDef, traitMatches, typeMatches } from './schema';
import {
  CORE_CONTAINS_RELATION_ID,
  CORE_GROUP_TYPE_ID,
  FREEFORM_RELATION_TYPE,
} from './schema-ids';
import { buildSchemaActivationMap, buildSchemaId, parseSchemaRef } from './schema-ref';
import {
  compileSchemaSemantics,
  getAllowedChildTypeIds,
  relationTypeMatchesEndpoints,
} from './schema-semantics';
import type {
  DocumentInput,
  PropertySchema,
  Provenance,
  RelationTypeDef,
  SchemaModule,
  SemanticDocument,
} from './types';

const CONTAINER_TRAIT_ID = 'core/base.traits.container';
const CONTAINABLE_TRAIT_ID = 'core/base.traits.containable';
const GROUP_LIKE_TRAIT_ID = 'core/base.traits.group-like';

export interface DiagramValidationOptions {
  provenance?: {
    requireDocumentInputs?: boolean;
    requireEntityProvenance?: boolean;
    requireRelationProvenance?: boolean;
    allowSingleInputShorthand?: boolean;
    disallowedPathPrefixes?: string[];
  };
  structure?: {
    requireChildrenForGroupLikeEntities?: boolean;
  };
}

export const DEFAULT_DIAGRAM_VALIDATION_OPTIONS: Required<DiagramValidationOptions> = {
  provenance: {
    requireDocumentInputs: false,
    requireEntityProvenance: false,
    requireRelationProvenance: false,
    allowSingleInputShorthand: true,
    disallowedPathPrefixes: [],
  },
  structure: {
    requireChildrenForGroupLikeEntities: false,
  },
};

export const STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS: Required<DiagramValidationOptions> =
  {
    provenance: {
      requireDocumentInputs: false,
      requireEntityProvenance: true,
      requireRelationProvenance: true,
      allowSingleInputShorthand: true,
      disallowedPathPrefixes: ['target-repo'],
    },
    structure: {
      requireChildrenForGroupLikeEntities: true,
    },
  };

const FULL_GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const DOCUMENT_INPUT_ROLE_VALUES = new Set(['primary', 'secondary']);

const pushDiagramError = (diagnostics: Diagnostic[], input: Omit<Diagnostic, 'domain'>) => {
  diagnostics.push(diagramDiagnostic(input));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const resolveDiagramValidationOptions = (
  options?: DiagramValidationOptions,
): Required<DiagramValidationOptions> => ({
  provenance: {
    ...DEFAULT_DIAGRAM_VALIDATION_OPTIONS.provenance,
    ...(options?.provenance ?? {}),
  },
  structure: {
    ...DEFAULT_DIAGRAM_VALIDATION_OPTIONS.structure,
    ...(options?.structure ?? {}),
  },
});

const normalizePathForValidation = (value: string) =>
  value.replace(/\\/g, '/').trim().replace(/^\.\//, '');

export const isRepoRelativePath = (value: string) => {
  const normalized = normalizePathForValidation(value);
  if (!normalized || normalized === '.' || normalized === '..') return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.startsWith('../') || normalized.includes('/../')) return false;
  return true;
};

export const hasDisallowedRepoPathPrefix = (value: string, prefixes: string[]) => {
  const normalized = normalizePathForValidation(value);
  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizePathForValidation(prefix).replace(/\/+$/, '');
    if (!normalizedPrefix) {
      return false;
    }
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
};

const buildInvalidRelationEndpointDetails = ({
  schema,
  relationType,
  compiledSchemaSemantics,
  fromRef,
  fromType,
  toRef,
  toType,
}: {
  schema: SchemaModule;
  relationType: RelationTypeDef;
  compiledSchemaSemantics: ReturnType<typeof compileSchemaSemantics>;
  fromRef: string;
  fromType: string;
  toRef: string;
  toType: string;
}): RelationAnalysisDiagnosticDetails => {
  const validRelationTypes = schema.relations
    .filter((candidate) => candidate.id !== CORE_CONTAINS_RELATION_ID)
    .filter((candidate) =>
      relationTypeMatchesEndpoints({
        semantics: compiledSchemaSemantics,
        relationType: candidate,
        fromType,
        toType,
      }),
    )
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));

  return {
    relationAnalysis: {
      fromRef,
      fromType,
      toRef,
      toType,
      selectedType: relationType.id,
      validRelationTypes,
      requiresEndpointChange: validRelationTypes.length === 0,
    },
  };
};

const buildInvalidRelationEndpointHint = (details: RelationAnalysisDiagnosticDetails) => {
  const analysis = details.relationAnalysis;
  if (analysis.requiresEndpointChange) {
    return `Chosen endpoints ${analysis.fromRef} (${analysis.fromType}) -> ${analysis.toRef} (${analysis.toType}) admit no legal relation types; choose different endpoints.`;
  }
  return `Chosen endpoints ${analysis.fromRef} (${analysis.fromType}) -> ${analysis.toRef} (${analysis.toType}) can use: ${analysis.validRelationTypes.join(', ')}. Keep the endpoints and choose one of those relation types.`;
};

const validateDocumentInputs = ({
  diagnostics,
  doc,
}: {
  diagnostics: Diagnostic[];
  doc: SemanticDocument;
}): Map<string, DocumentInput> => {
  const inputMap = new Map<string, DocumentInput>();
  const seenInputIds = new Set<string>();

  for (const input of doc.inputs ?? []) {
    const inputId = input.id?.trim();
    if (!inputId) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_document_input_id',
        message: 'Document input is missing a valid id',
      });
      continue;
    }
    if (seenInputIds.has(inputId)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.duplicate_document_input_id',
        targetId: inputId,
        message: `Document input id ${inputId} is duplicated`,
      });
      continue;
    }
    seenInputIds.add(inputId);

    if (input.kind !== 'git') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_document_input_kind',
        targetId: inputId,
        message: `Document input ${inputId} must use kind git`,
      });
    }
    if (!input.repo?.trim()) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_document_input_repo',
        targetId: inputId,
        message: `Document input ${inputId} must declare a repo`,
      });
    }
    if (input.role && !DOCUMENT_INPUT_ROLE_VALUES.has(input.role)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_document_input_role',
        targetId: inputId,
        message: `Document input ${inputId} uses invalid role ${input.role}`,
      });
    }

    inputMap.set(inputId, input);
  }

  return inputMap;
};

const validateProvenance = ({
  diagnostics,
  provenance,
  ownerLabel,
  ownerId,
  inputMap,
  validationOptions,
}: {
  diagnostics: Diagnostic[];
  provenance: Provenance | undefined;
  ownerLabel: 'Entity' | 'Relation';
  ownerId: string;
  inputMap: Map<string, DocumentInput>;
  validationOptions: Required<DiagramValidationOptions>;
}): void => {
  const requiresProvenance =
    ownerLabel === 'Entity'
      ? validationOptions.provenance.requireEntityProvenance
      : validationOptions.provenance.requireRelationProvenance;

  if (!provenance) {
    if (requiresProvenance) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code:
          ownerLabel === 'Entity'
            ? 'diagram.document.missing_entity_provenance'
            : 'diagram.document.missing_relation_provenance',
        entityId: ownerLabel === 'Entity' ? ownerId : undefined,
        relationId: ownerLabel === 'Relation' ? ownerId : undefined,
        message: `${ownerLabel} ${ownerId} is missing provenance`,
      });
    }
    return;
  }

  if (
    provenance.confidence !== undefined &&
    (typeof provenance.confidence !== 'number' || !Number.isFinite(provenance.confidence))
  ) {
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.invalid_provenance_confidence',
      entityId: ownerLabel === 'Entity' ? ownerId : undefined,
      relationId: ownerLabel === 'Relation' ? ownerId : undefined,
      message: `${ownerLabel} ${ownerId} uses invalid provenance confidence`,
    });
  }
  if (!Array.isArray(provenance.locations) || provenance.locations.length === 0) {
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.provenance_locations_required',
      entityId: ownerLabel === 'Entity' ? ownerId : undefined,
      relationId: ownerLabel === 'Relation' ? ownerId : undefined,
      message: `${ownerLabel} ${ownerId} provenance must include at least one location`,
    });
    return;
  }

  for (const location of provenance.locations) {
    const disallowedPathPrefixes = validationOptions.provenance.disallowedPathPrefixes;
    const disallowedPrefix = disallowedPathPrefixes.find((prefix) =>
      hasDisallowedRepoPathPrefix(location.path, [prefix]),
    );
    if (!isRepoRelativePath(location.path) || disallowedPrefix) {
      const normalizedPrefix = disallowedPrefix
        ? normalizePathForValidation(disallowedPrefix).replace(/\/+$/, '')
        : undefined;
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_provenance_location_path',
        entityId: ownerLabel === 'Entity' ? ownerId : undefined,
        relationId: ownerLabel === 'Relation' ? ownerId : undefined,
        path: location.path,
        message: normalizedPrefix
          ? `${ownerLabel} ${ownerId} provenance path must be repo-relative to the input root and must not start with ${normalizedPrefix}/`
          : `${ownerLabel} ${ownerId} provenance path must be a repo-relative path`,
      });
    }

    if (location.input) {
      if (!inputMap.has(location.input)) {
        pushDiagramError(diagnostics, {
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.unknown_provenance_input',
          entityId: ownerLabel === 'Entity' ? ownerId : undefined,
          relationId: ownerLabel === 'Relation' ? ownerId : undefined,
          targetId: location.input,
          path: location.path,
          message: `${ownerLabel} ${ownerId} provenance references unknown input ${location.input}`,
        });
      }
      continue;
    }

    const hasAbsoluteCoordinates =
      typeof location.repo === 'string' &&
      location.repo.trim().length > 0 &&
      FULL_GIT_COMMIT_PATTERN.test(location.commit?.trim() ?? '');
    if (hasAbsoluteCoordinates) {
      continue;
    }

    const canUseSingleInputShorthand =
      validationOptions.provenance.allowSingleInputShorthand && inputMap.size === 1;
    if (canUseSingleInputShorthand) {
      continue;
    }

    if (!location.repo?.trim()) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_provenance_location_repo',
        entityId: ownerLabel === 'Entity' ? ownerId : undefined,
        relationId: ownerLabel === 'Relation' ? ownerId : undefined,
        message: `${ownerLabel} ${ownerId} provenance location must declare a repo`,
      });
    }
    if (!FULL_GIT_COMMIT_PATTERN.test(location.commit?.trim() ?? '')) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_provenance_location_commit',
        entityId: ownerLabel === 'Entity' ? ownerId : undefined,
        relationId: ownerLabel === 'Relation' ? ownerId : undefined,
        message: `${ownerLabel} ${ownerId} provenance location must use a full git commit id`,
      });
    }
    if (!canUseSingleInputShorthand) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.provenance_input_required',
        entityId: ownerLabel === 'Entity' ? ownerId : undefined,
        relationId: ownerLabel === 'Relation' ? ownerId : undefined,
        path: location.path,
        message: `${ownerLabel} ${ownerId} provenance location must declare an input`,
      });
    }
  }
};

const describePropertyType = (property: PropertySchema) =>
  property.type === 'enum'
    ? property.values && property.values.length > 0
      ? `one of ${property.values.join(', ')}`
      : 'an enum value'
    : property.type;

const validatePropertyValue = ({
  diagnostics,
  relationId,
  property,
  value,
  propertyPath,
}: {
  diagnostics: Diagnostic[];
  relationId: string;
  property: PropertySchema;
  value: unknown;
  propertyPath: string;
}): void => {
  if (value === undefined) return;
  if (property.type === 'string') {
    if (typeof value !== 'string') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_property_type',
        relationId,
        message: `Relation ${relationId} property ${propertyPath} must be a string`,
      });
    }
    return;
  }
  if (property.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_property_type',
        relationId,
        message: `Relation ${relationId} property ${propertyPath} must be a number`,
      });
    }
    return;
  }
  if (property.type === 'boolean') {
    if (typeof value !== 'boolean') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_property_type',
        relationId,
        message: `Relation ${relationId} property ${propertyPath} must be a boolean`,
      });
    }
    return;
  }
  if (property.type === 'enum') {
    if (typeof value !== 'string') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_property_type',
        relationId,
        message: `Relation ${relationId} property ${propertyPath} must be ${describePropertyType(property)}`,
      });
      return;
    }
    const values = property.values ?? [];
    if (values.length > 0 && !values.includes(value) && !property.allowOther) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_property_value',
        relationId,
        message: `Relation ${relationId} property ${propertyPath} must be ${describePropertyType(property)}`,
      });
    }
    return;
  }
  if (!isRecord(value)) {
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.invalid_relation_property_type',
      relationId,
      message: `Relation ${relationId} property ${propertyPath} must be an object`,
    });
    return;
  }

  validateRelationProps({
    diagnostics,
    relationId,
    props: value,
    properties: property.properties,
    prefix: propertyPath,
  });
};

const validateRelationProps = ({
  diagnostics,
  relationId,
  props,
  properties,
  prefix,
}: {
  diagnostics: Diagnostic[];
  relationId: string;
  props: Record<string, unknown> | undefined;
  properties: PropertySchema[] | undefined;
  prefix?: string;
}): void => {
  if (!props) return;
  if (!properties || properties.length === 0) {
    const scopeLabel = prefix ? ` property ${prefix}` : '';
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.relation_properties_not_allowed',
      relationId,
      message: `Relation ${relationId}${scopeLabel} does not allow properties`,
    });
    return;
  }

  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  for (const [key, value] of Object.entries(props)) {
    const propertyPath = prefix ? `${prefix}.${key}` : key;
    const property = propertyMap.get(key);
    if (!property) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.unknown_relation_property',
        relationId,
        message: `Relation ${relationId} uses unknown property ${propertyPath}`,
      });
      continue;
    }
    validatePropertyValue({
      diagnostics,
      relationId,
      property,
      value,
      propertyPath,
    });
  }
};

const validateEntityPropertyValue = ({
  diagnostics,
  entityId,
  property,
  value,
  propertyPath,
}: {
  diagnostics: Diagnostic[];
  entityId: string;
  property: PropertySchema;
  value: unknown;
  propertyPath: string;
}): void => {
  if (value === undefined) return;
  if (property.type === 'string') {
    if (typeof value !== 'string') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_entity_property_type',
        entityId,
        message: `Entity ${entityId} property ${propertyPath} must be a string`,
      });
    }
    return;
  }
  if (property.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_entity_property_type',
        entityId,
        message: `Entity ${entityId} property ${propertyPath} must be a number`,
      });
    }
    return;
  }
  if (property.type === 'boolean') {
    if (typeof value !== 'boolean') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_entity_property_type',
        entityId,
        message: `Entity ${entityId} property ${propertyPath} must be a boolean`,
      });
    }
    return;
  }
  if (property.type === 'enum') {
    if (typeof value !== 'string') {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_entity_property_type',
        entityId,
        message: `Entity ${entityId} property ${propertyPath} must be ${describePropertyType(property)}`,
      });
      return;
    }
    const values = property.values ?? [];
    if (values.length > 0 && !values.includes(value) && !property.allowOther) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_entity_property_value',
        entityId,
        message: `Entity ${entityId} property ${propertyPath} must be ${describePropertyType(property)}`,
      });
    }
    return;
  }
  if (!isRecord(value)) {
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.invalid_entity_property_type',
      entityId,
      message: `Entity ${entityId} property ${propertyPath} must be an object`,
    });
    return;
  }

  validateEntityProps({
    diagnostics,
    entityId,
    props: value,
    properties: property.properties,
    prefix: propertyPath,
  });
};

const validateEntityProps = ({
  diagnostics,
  entityId,
  props,
  properties,
  prefix,
}: {
  diagnostics: Diagnostic[];
  entityId: string;
  props: Record<string, unknown> | undefined;
  properties: PropertySchema[] | undefined;
  prefix?: string;
}): void => {
  if (!props) return;
  if (!properties || properties.length === 0) return;

  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  for (const [key, value] of Object.entries(props)) {
    const propertyPath = prefix ? `${prefix}.${key}` : key;
    const property = propertyMap.get(key);
    if (!property) continue;
    validateEntityPropertyValue({
      diagnostics,
      entityId,
      property,
      value,
      propertyPath,
    });
  }
};

export function validateDocument(
  doc: SemanticDocument,
  schema: SchemaModule,
  options?: DiagramValidationOptions,
): Diagnostic[] {
  const compiledSchemaSemantics = compileSchemaSemantics(schema);
  const validationOptions = resolveDiagramValidationOptions(options);
  const diagnostics: Diagnostic[] = [];
  const inputMap = validateDocumentInputs({ diagnostics, doc });
  if (validationOptions.provenance.requireDocumentInputs && inputMap.size === 0) {
    pushDiagramError(diagnostics, {
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.document_inputs_required',
      message: 'Document inputs are required',
    });
  }
  const typeSet = new Set(schema.types.map((type) => type.id));
  const relationMap = new Map(schema.relations.map((relation) => [relation.id, relation]));
  const entityIndex = buildEntityIndex(doc.entities);
  const entities = entityIndex.entries.map((entry) => entry.entity);
  const entityMap = entityIndex.byId;
  const entityIds = new Set(entityMap.keys());
  const activationMap = buildSchemaActivationMap(doc.schemaRefs);
  const childrenByParent = new Map<string, Set<string>>();
  const addChild = (parentId: string, childId: string) => {
    if (!parentId || !childId) return;
    const set = childrenByParent.get(parentId) ?? new Set<string>();
    set.add(childId);
    childrenByParent.set(parentId, set);
  };

  for (const entity of entities) {
    validateProvenance({
      diagnostics,
      provenance: entity.provenance,
      ownerLabel: 'Entity',
      ownerId: entity.id,
      inputMap,
      validationOptions,
    });
    if (!typeSet.has(entity.type)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.unknown_entity_type',
        entityId: entity.id,
        message: `Entity ${entity.id} uses unknown type ${entity.type}`,
      });
    }
    const typeDef = resolveTypeDef(schema, entity.type);
    if (typeDef?.naming?.required) {
      const name = entity.name?.trim();
      if (!name) {
        pushDiagramError(diagnostics, {
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.required_name_missing',
          entityId: entity.id,
          message: `Entity ${entity.id} (${entity.type}) requires a name`,
        });
      }
    }
    validateEntityProps({
      diagnostics,
      entityId: entity.id,
      props: isRecord(entity.props) ? entity.props : undefined,
      properties: typeDef?.properties,
    });
    const parentId = entityIndex.parentById.get(entity.id);
    if (parentId && !entityIds.has(parentId)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.missing_parent',
        entityId: entity.id,
        targetId: parentId,
        message: `Entity ${entity.id} references missing parent ${parentId}`,
      });
    }
    if (parentId) {
      const parentEntity = entityMap.get(parentId);
      const parentTypeDef = parentEntity ? resolveTypeDef(schema, parentEntity.type) : undefined;
      const containment = parentTypeDef?.containment;
      const parentLayer = parentTypeDef?.originSchemaId
        ? activationMap.get(buildSchemaId(parseSchemaRef(parentTypeDef.originSchemaId)))?.layer
        : undefined;
      const childLayer = typeDef?.originSchemaId
        ? activationMap.get(buildSchemaId(parseSchemaRef(typeDef.originSchemaId)))?.layer
        : undefined;

      const explicitContainmentOk = containment
        ? (containment.allowedChildTypes
            ? typeMatches(schema, entity.type, containment.allowedChildTypes)
            : true) &&
          (containment.allowedChildTraits
            ? traitMatches(schema, entity.type, containment.allowedChildTraits)
            : true)
        : false;
      const structuralGroupContainmentOk =
        explicitContainmentOk && traitMatches(schema, entity.type, [GROUP_LIKE_TRAIT_ID]);

      const genericCrossLayerContainmentOk =
        parentLayer !== undefined &&
        childLayer !== undefined &&
        childLayer - parentLayer === 1 &&
        parentEntity !== undefined &&
        traitMatches(schema, parentEntity.type, [CONTAINER_TRAIT_ID]) &&
        traitMatches(schema, entity.type, [CONTAINABLE_TRAIT_ID]);
      const allowedChildTypeIds = parentEntity
        ? getAllowedChildTypeIds({
            schema,
            parentTypeId: parentEntity.type,
            schemaActivations: doc.schemaRefs,
          })
        : [];
      const containmentDetails = {
        parentTypeId: parentEntity?.type,
        childTypeId: entity.type,
        parentLayer,
        childLayer,
        explicitContainmentOk,
        genericCrossLayerContainmentOk,
        allowedChildTypes: containment?.allowedChildTypes ?? [],
        allowedChildTraits: containment?.allowedChildTraits ?? [],
        allowedChildTypeIds,
      };
      const containmentHint =
        allowedChildTypeIds.length > 0
          ? `Use an allowed child type such as ${allowedChildTypeIds.slice(0, 5).join(', ')} or move ${entity.id} to a compatible parent.`
          : `Move ${entity.id} to a compatible parent or remove the child nesting.`;

      const invalidLayerDirection =
        parentLayer !== undefined &&
        childLayer !== undefined &&
        (childLayer < parentLayer || childLayer > parentLayer + 1);

      if (
        (!containment && !genericCrossLayerContainmentOk) ||
        (invalidLayerDirection && !structuralGroupContainmentOk)
      ) {
        pushDiagramError(diagnostics, {
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.invalid_nested_parent',
          entityId: entity.id,
          targetId: parentId,
          message: `Entity ${entity.id} has invalid parent ${parentId}`,
          hint: containmentHint,
          details: containmentDetails,
        });
      } else if (!genericCrossLayerContainmentOk && !explicitContainmentOk) {
        pushDiagramError(diagnostics, {
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.invalid_nested_child',
          entityId: entity.id,
          targetId: parentId,
          message: `Entity ${entity.id} has invalid parent ${parentId}`,
          hint: containmentHint,
          details: containmentDetails,
        });
      }
    }
    if (parentId) {
      addChild(parentId, entity.id);
    }
  }

  for (const relation of doc.relations) {
    validateProvenance({
      diagnostics,
      provenance: relation.provenance,
      ownerLabel: 'Relation',
      ownerId: relation.id,
      inputMap,
      validationOptions,
    });
    if (!relation.type || relation.type === FREEFORM_RELATION_TYPE) continue;

    const relationType = relationMap.get(relation.type);
    if (!relationType) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.unknown_relation_type',
        relationId: relation.id,
        message: `Relation ${relation.id} uses unknown type ${relation.type}`,
      });
      continue;
    }
    if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.missing_relation_endpoint',
        relationId: relation.id,
        message: `Relation ${relation.id} references missing entities`,
      });
      continue;
    }
    const fromEntity = entityMap.get(relation.from);
    const toEntity = entityMap.get(relation.to);
    if (!fromEntity || !toEntity) continue;

    if (relation.type === CORE_CONTAINS_RELATION_ID) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.authored_contains_relation_not_allowed',
        relationId: relation.id,
        message: `Relation ${relation.id} uses contains, but containment must be represented structurally`,
      });
      continue;
    }

    const endpointsMatch = relationTypeMatchesEndpoints({
      semantics: compiledSchemaSemantics,
      relationType,
      fromType: fromEntity.type,
      toType: toEntity.type,
    });

    if (!endpointsMatch) {
      const details = buildInvalidRelationEndpointDetails({
        schema,
        relationType,
        compiledSchemaSemantics,
        fromRef: relation.from,
        fromType: fromEntity.type,
        toRef: relation.to,
        toType: toEntity.type,
      });
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.invalid_relation_endpoints',
        relationId: relation.id,
        message: `Relation ${relation.id} has invalid endpoints for ${relation.type}`,
        hint: buildInvalidRelationEndpointHint(details),
        details,
      });
    }

    validateRelationProps({
      diagnostics,
      relationId: relation.id,
      props: relation.props,
      properties: relationType.properties,
    });
  }

  for (const entity of entities) {
    if (entity.type !== CORE_GROUP_TYPE_ID) continue;
    const props = entity.props as Record<string, unknown> | undefined;
    const mode = props?.mode;
    const groupType = props?.groupType;
    const typed = mode === 'typed' || typeof groupType === 'string';
    if (!typed) continue;
    if (typeof groupType !== 'string' || groupType.length === 0) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.typed_group_missing_group_type',
        entityId: entity.id,
        message: `Group ${entity.id} is typed but has no groupType`,
      });
      continue;
    }
    if (!typeSet.has(groupType)) {
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.typed_group_unknown_group_type',
        entityId: entity.id,
        targetId: groupType,
        message: `Group ${entity.id} uses unknown groupType ${groupType}`,
      });
      continue;
    }
    const children = childrenByParent.get(entity.id) ?? new Set<string>();
    for (const childId of children) {
      const child = entityMap.get(childId);
      if (!child) continue;
      if (child.type === CORE_GROUP_TYPE_ID) {
        continue;
      }
      if (child.type !== groupType) {
        pushDiagramError(diagnostics, {
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.typed_group_contains_wrong_child_type',
          entityId: entity.id,
          targetId: childId,
          message: `Group ${entity.id} contains non-${groupType} child ${childId}`,
        });
      }
    }
  }

  if (validationOptions.structure.requireChildrenForGroupLikeEntities) {
    for (const entity of entities) {
      if (!traitMatches(schema, entity.type, [GROUP_LIKE_TRAIT_ID])) {
        continue;
      }
      const children = childrenByParent.get(entity.id) ?? new Set<string>();
      if (children.size > 0) {
        continue;
      }
      pushDiagramError(diagnostics, {
        phase: 'document',
        severity: 'error',
        code: 'diagram.document.group_like_entity_missing_children',
        entityId: entity.id,
        message: `Group-like entity ${entity.id} has no children; use a concrete boundary or add contained entities`,
      });
    }
  }

  return diagnostics;
}
