import type {
  SemanticDiagramDiff,
  SemanticDiagramDiffChange,
  SemanticDiagramEntityChangedField,
  SemanticDiagramEntityDiff,
  SemanticDiagramRelationChangedField,
  SemanticDiagramRelationDiff,
} from '../diff/diagram-diff';
import { type Diagnostic, diagramDiagnostic, sortDiagnostics } from '../model/diagnostics';
import type { Entity, Relation } from '../model/types';
import type { ValidationResult } from '../validation/types';
import { parseYamlTextResult, serializeYamlText } from './yaml';

const DIFF_KIND = 'semantic-diagram-diff';
const DIFF_VERSION = 1;

const ENTITY_FIELD_ORDER: SemanticDiagramEntityChangedField[] = [
  'name',
  'type',
  'parent',
  'tags',
  'props',
];

const RELATION_FIELD_ORDER: SemanticDiagramRelationChangedField[] = [
  'type',
  'label',
  'state',
  'tags',
  'from',
  'to',
  'props',
];

const SERIALIZED_CHANGE_SET = new Set<SemanticDiagramDiffChange>(['added', 'removed', 'changed']);
const ENTITY_FIELD_SET = new Set<SemanticDiagramEntityChangedField>(ENTITY_FIELD_ORDER);
const RELATION_FIELD_SET = new Set<SemanticDiagramRelationChangedField>(RELATION_FIELD_ORDER);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeStringArray = (values?: string[]): string[] | undefined => {
  if (!values || values.length === 0) return undefined;
  return [...values].sort((left, right) => left.localeCompare(right));
};

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
};

const tagFieldKey = (
  subject?:
    | Pick<Entity, 'tags' | 'removeDefaultTags' | 'replaceDefaultTags'>
    | Pick<Relation, 'tags' | 'removeDefaultTags' | 'replaceDefaultTags'>,
) => {
  if (!subject) return undefined;
  return stableSerialize({
    tags: normalizeStringArray(subject.tags),
    removeDefaultTags: normalizeStringArray(subject.removeDefaultTags),
    replaceDefaultTags: subject.replaceDefaultTags === true ? true : undefined,
  });
};

const propsKey = (props?: Record<string, unknown>) => stableSerialize(props);

const collectEntityChangedFields = (
  before: Entity,
  after: Entity,
): SemanticDiagramEntityChangedField[] =>
  ENTITY_FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'name':
        return before.name !== after.name;
      case 'type':
        return before.type !== after.type;
      case 'parent':
        return before.parent !== after.parent;
      case 'tags':
        return tagFieldKey(before) !== tagFieldKey(after);
      case 'props':
        return propsKey(before.props) !== propsKey(after.props);
      default:
        return false;
    }
  });

const collectRelationChangedFields = (
  before: Relation,
  after: Relation,
): SemanticDiagramRelationChangedField[] =>
  RELATION_FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'type':
        return before.type !== after.type;
      case 'label':
        return before.label !== after.label;
      case 'state':
        return before.state !== after.state;
      case 'tags':
        return tagFieldKey(before) !== tagFieldKey(after);
      case 'from':
        return before.from !== after.from;
      case 'to':
        return before.to !== after.to;
      case 'props':
        return propsKey(before.props) !== propsKey(after.props);
      default:
        return false;
    }
  });

const buildDiffDiagnostic = (params: {
  code: string;
  message: string;
  path?: string;
  entityId?: string;
  relationId?: string;
}): Diagnostic =>
  diagramDiagnostic({
    phase: 'shape',
    severity: 'error',
    code: params.code,
    message: params.message,
    path: params.path,
    entityId: params.entityId,
    relationId: params.relationId,
  });

const readRequiredString = (
  candidate: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
) => {
  const value = candidate[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  diagnostics.push(
    buildDiffDiagnostic({
      code: 'diagram.diff.invalid_snapshot',
      message: `Expected "${path}.${key}" to be a non-empty string.`,
      path: `${path}.${key}`,
    }),
  );
  return undefined;
};

const readOptionalString = (
  candidate: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
) => {
  const value = candidate[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  diagnostics.push(
    buildDiffDiagnostic({
      code: 'diagram.diff.invalid_snapshot',
      message: `Expected "${path}.${key}" to be a string when present.`,
      path: `${path}.${key}`,
    }),
  );
  return undefined;
};

const readOptionalBoolean = (
  candidate: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
) => {
  const value = candidate[key];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  diagnostics.push(
    buildDiffDiagnostic({
      code: 'diagram.diff.invalid_snapshot',
      message: `Expected "${path}.${key}" to be a boolean when present.`,
      path: `${path}.${key}`,
    }),
  );
  return undefined;
};

const readOptionalStringArray = (
  candidate: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
) => {
  const value = candidate[key];
  if (value === undefined) return undefined;
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    return normalizeStringArray(value);
  }
  diagnostics.push(
    buildDiffDiagnostic({
      code: 'diagram.diff.invalid_snapshot',
      message: `Expected "${path}.${key}" to be an array of non-empty strings when present.`,
      path: `${path}.${key}`,
    }),
  );
  return undefined;
};

const readOptionalRecord = (
  candidate: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
) => {
  const value = candidate[key];
  if (value === undefined) return undefined;
  if (isRecord(value)) {
    return value;
  }
  diagnostics.push(
    buildDiffDiagnostic({
      code: 'diagram.diff.invalid_snapshot',
      message: `Expected "${path}.${key}" to be an object when present.`,
      path: `${path}.${key}`,
    }),
  );
  return undefined;
};

const validateEntitySnapshot = (candidate: unknown, path: string): ValidationResult<Entity> => {
  if (!isRecord(candidate)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_snapshot',
          message: `Expected "${path}" to be an entity snapshot object.`,
          path,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const id = readRequiredString(candidate, 'id', path, diagnostics);
  const type = readRequiredString(candidate, 'type', path, diagnostics);
  const name = readOptionalString(candidate, 'name', path, diagnostics);
  const parent = readOptionalString(candidate, 'parent', path, diagnostics);
  const tags = readOptionalStringArray(candidate, 'tags', path, diagnostics);
  const removeDefaultTags = readOptionalStringArray(
    candidate,
    'removeDefaultTags',
    path,
    diagnostics,
  );
  const replaceDefaultTags = readOptionalBoolean(
    candidate,
    'replaceDefaultTags',
    path,
    diagnostics,
  );
  const props = readOptionalRecord(candidate, 'props', path, diagnostics);

  if (diagnostics.length > 0 || !id || !type) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    value: {
      id,
      type,
      ...(name !== undefined ? { name } : {}),
      ...(parent !== undefined ? { parent } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(removeDefaultTags !== undefined ? { removeDefaultTags } : {}),
      ...(replaceDefaultTags !== undefined ? { replaceDefaultTags } : {}),
      ...(props !== undefined ? { props } : {}),
    },
    diagnostics: [],
  };
};

const validateRelationSnapshot = (candidate: unknown, path: string): ValidationResult<Relation> => {
  if (!isRecord(candidate)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_snapshot',
          message: `Expected "${path}" to be a relation snapshot object.`,
          path,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const id = readRequiredString(candidate, 'id', path, diagnostics);
  const from = readRequiredString(candidate, 'from', path, diagnostics);
  const to = readRequiredString(candidate, 'to', path, diagnostics);
  const type = readOptionalString(candidate, 'type', path, diagnostics);
  const label = readOptionalString(candidate, 'label', path, diagnostics);
  const stateCandidate = candidate.state;
  if (stateCandidate !== undefined && stateCandidate !== 'undecided' && stateCandidate !== 'none') {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_snapshot',
        message: `Expected "${path}.state" to be "undecided" or "none" when present.`,
        path: `${path}.state`,
      }),
    );
  }
  const state =
    stateCandidate === 'undecided' || stateCandidate === 'none' ? stateCandidate : undefined;
  const tags = readOptionalStringArray(candidate, 'tags', path, diagnostics);
  const removeDefaultTags = readOptionalStringArray(
    candidate,
    'removeDefaultTags',
    path,
    diagnostics,
  );
  const replaceDefaultTags = readOptionalBoolean(
    candidate,
    'replaceDefaultTags',
    path,
    diagnostics,
  );
  const props = readOptionalRecord(candidate, 'props', path, diagnostics);

  if (diagnostics.length > 0 || !id || !from || !to) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    value: {
      id,
      from,
      to,
      ...(type !== undefined ? { type } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(state !== undefined ? { state } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(removeDefaultTags !== undefined ? { removeDefaultTags } : {}),
      ...(replaceDefaultTags !== undefined ? { replaceDefaultTags } : {}),
      ...(props !== undefined ? { props } : {}),
    },
    diagnostics: [],
  };
};

const validateChangedFields = <T extends string>(params: {
  candidate: Record<string, unknown>;
  key: 'changedFields';
  path: string;
  validSet: Set<T>;
  order: T[];
}): ValidationResult<T[]> => {
  const value = params.candidate[params.key];
  if (!Array.isArray(value)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Expected "${params.path}.${params.key}" to be an array.`,
          path: `${params.path}.${params.key}`,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const fields: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== 'string' || !params.validSet.has(entry as T)) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Unsupported changed field at "${params.path}.${params.key}[${index}]".`,
          path: `${params.path}.${params.key}[${index}]`,
        }),
      );
      continue;
    }
    fields.push(entry as T);
  }

  if (new Set(fields).size !== fields.length) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_changed_fields',
        message: `Duplicate changed field entries are not allowed at "${params.path}.${params.key}".`,
        path: `${params.path}.${params.key}`,
      }),
    );
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    value: params.order.filter((field) => fields.includes(field)),
    diagnostics: [],
  };
};

const validateEntityDiffEntry = (
  candidate: unknown,
  index: number,
): ValidationResult<SemanticDiagramEntityDiff> => {
  const path = `$.entities[${index}]`;
  if (!isRecord(candidate)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_entities',
          message: `Expected "${path}" to be an entity diff object.`,
          path,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const entityId = readRequiredString(candidate, 'entityId', path, diagnostics);
  const changeCandidate = candidate.change;
  let changeValue: SemanticDiagramDiffChange | undefined;
  if (changeCandidate === 'unchanged') {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change',
        message: `Serialized diff documents cannot contain unchanged entity entries at "${path}".`,
        path: `${path}.change`,
        entityId,
      }),
    );
  } else if (
    typeof changeCandidate !== 'string' ||
    !SERIALIZED_CHANGE_SET.has(changeCandidate as SemanticDiagramDiffChange)
  ) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change',
        message: `Expected "${path}.change" to be one of added, removed, or changed.`,
        path: `${path}.change`,
        entityId,
      }),
    );
  } else {
    changeValue = changeCandidate as SemanticDiagramDiffChange;
  }

  const changedFields = validateChangedFields<SemanticDiagramEntityChangedField>({
    candidate,
    key: 'changedFields',
    path,
    validSet: ENTITY_FIELD_SET,
    order: ENTITY_FIELD_ORDER,
  });
  diagnostics.push(...changedFields.diagnostics);

  const before =
    candidate.before !== undefined
      ? validateEntitySnapshot(candidate.before, `${path}.before`)
      : undefined;
  const after =
    candidate.after !== undefined
      ? validateEntitySnapshot(candidate.after, `${path}.after`)
      : undefined;
  if (before && !before.ok) diagnostics.push(...before.diagnostics);
  if (after && !after.ok) diagnostics.push(...after.diagnostics);

  if (diagnostics.length > 0 || !entityId || !changedFields.ok || !changeValue) {
    return {
      ok: false,
      diagnostics,
    };
  }

  const normalizedBefore = before?.value;
  const normalizedAfter = after?.value;
  if (normalizedBefore && normalizedBefore.id !== entityId) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change_shape',
        message: `Entity diff "${entityId}" has a before snapshot with mismatched id "${normalizedBefore.id}".`,
        path: `${path}.before.id`,
        entityId,
      }),
    );
  }
  if (normalizedAfter && normalizedAfter.id !== entityId) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change_shape',
        message: `Entity diff "${entityId}" has an after snapshot with mismatched id "${normalizedAfter.id}".`,
        path: `${path}.after.id`,
        entityId,
      }),
    );
  }

  if (changeValue === 'added') {
    if (normalizedBefore) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Added entity "${entityId}" must not include a before snapshot.`,
          path: `${path}.before`,
          entityId,
        }),
      );
    }
    if (!normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Added entity "${entityId}" must include an after snapshot.`,
          path: `${path}.after`,
          entityId,
        }),
      );
    }
    if (changedFields.value.length > 0) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Added entity "${entityId}" must not declare changedFields.`,
          path: `${path}.changedFields`,
          entityId,
        }),
      );
    }
  }

  if (changeValue === 'removed') {
    if (!normalizedBefore) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Removed entity "${entityId}" must include a before snapshot.`,
          path: `${path}.before`,
          entityId,
        }),
      );
    }
    if (normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Removed entity "${entityId}" must not include an after snapshot.`,
          path: `${path}.after`,
          entityId,
        }),
      );
    }
    if (changedFields.value.length > 0) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Removed entity "${entityId}" must not declare changedFields.`,
          path: `${path}.changedFields`,
          entityId,
        }),
      );
    }
  }

  if (changeValue === 'changed') {
    if (!normalizedBefore || !normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Changed entity "${entityId}" must include both before and after snapshots.`,
          path,
          entityId,
        }),
      );
    } else {
      const actualChangedFields = collectEntityChangedFields(normalizedBefore, normalizedAfter);
      if (actualChangedFields.length === 0) {
        diagnostics.push(
          buildDiffDiagnostic({
            code: 'diagram.diff.invalid_changed_fields',
            message: `Changed entity "${entityId}" must have at least one changed field.`,
            path: `${path}.changedFields`,
            entityId,
          }),
        );
      } else if (stableSerialize(actualChangedFields) !== stableSerialize(changedFields.value)) {
        diagnostics.push(
          buildDiffDiagnostic({
            code: 'diagram.diff.invalid_changed_fields',
            message: `Changed entity "${entityId}" changedFields do not match its snapshots.`,
            path: `${path}.changedFields`,
            entityId,
          }),
        );
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    value: {
      entityId,
      change: changeValue,
      ...(normalizedBefore ? { before: normalizedBefore } : {}),
      ...(normalizedAfter ? { after: normalizedAfter } : {}),
      changedFields: changedFields.value,
    },
    diagnostics: [],
  };
};

const validateRelationDiffEntry = (
  candidate: unknown,
  index: number,
): ValidationResult<SemanticDiagramRelationDiff> => {
  const path = `$.relations[${index}]`;
  if (!isRecord(candidate)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_relations',
          message: `Expected "${path}" to be a relation diff object.`,
          path,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const relationId = readRequiredString(candidate, 'relationId', path, diagnostics);
  const changeCandidate = candidate.change;
  let changeValue: SemanticDiagramDiffChange | undefined;
  if (changeCandidate === 'unchanged') {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change',
        message: `Serialized diff documents cannot contain unchanged relation entries at "${path}".`,
        path: `${path}.change`,
        relationId,
      }),
    );
  } else if (
    typeof changeCandidate !== 'string' ||
    !SERIALIZED_CHANGE_SET.has(changeCandidate as SemanticDiagramDiffChange)
  ) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change',
        message: `Expected "${path}.change" to be one of added, removed, or changed.`,
        path: `${path}.change`,
        relationId,
      }),
    );
  } else {
    changeValue = changeCandidate as SemanticDiagramDiffChange;
  }

  const changedFields = validateChangedFields<SemanticDiagramRelationChangedField>({
    candidate,
    key: 'changedFields',
    path,
    validSet: RELATION_FIELD_SET,
    order: RELATION_FIELD_ORDER,
  });
  diagnostics.push(...changedFields.diagnostics);

  const before =
    candidate.before !== undefined
      ? validateRelationSnapshot(candidate.before, `${path}.before`)
      : undefined;
  const after =
    candidate.after !== undefined
      ? validateRelationSnapshot(candidate.after, `${path}.after`)
      : undefined;
  if (before && !before.ok) diagnostics.push(...before.diagnostics);
  if (after && !after.ok) diagnostics.push(...after.diagnostics);

  if (diagnostics.length > 0 || !relationId || !changedFields.ok || !changeValue) {
    return {
      ok: false,
      diagnostics,
    };
  }

  const normalizedBefore = before?.value;
  const normalizedAfter = after?.value;
  if (normalizedBefore && normalizedBefore.id !== relationId) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change_shape',
        message: `Relation diff "${relationId}" has a before snapshot with mismatched id "${normalizedBefore.id}".`,
        path: `${path}.before.id`,
        relationId,
      }),
    );
  }
  if (normalizedAfter && normalizedAfter.id !== relationId) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_change_shape',
        message: `Relation diff "${relationId}" has an after snapshot with mismatched id "${normalizedAfter.id}".`,
        path: `${path}.after.id`,
        relationId,
      }),
    );
  }

  if (changeValue === 'added') {
    if (normalizedBefore) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Added relation "${relationId}" must not include a before snapshot.`,
          path: `${path}.before`,
          relationId,
        }),
      );
    }
    if (!normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Added relation "${relationId}" must include an after snapshot.`,
          path: `${path}.after`,
          relationId,
        }),
      );
    }
    if (changedFields.value.length > 0) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Added relation "${relationId}" must not declare changedFields.`,
          path: `${path}.changedFields`,
          relationId,
        }),
      );
    }
  }

  if (changeValue === 'removed') {
    if (!normalizedBefore) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Removed relation "${relationId}" must include a before snapshot.`,
          path: `${path}.before`,
          relationId,
        }),
      );
    }
    if (normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Removed relation "${relationId}" must not include an after snapshot.`,
          path: `${path}.after`,
          relationId,
        }),
      );
    }
    if (changedFields.value.length > 0) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_changed_fields',
          message: `Removed relation "${relationId}" must not declare changedFields.`,
          path: `${path}.changedFields`,
          relationId,
        }),
      );
    }
  }

  if (changeValue === 'changed') {
    if (!normalizedBefore || !normalizedAfter) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_change_shape',
          message: `Changed relation "${relationId}" must include both before and after snapshots.`,
          path,
          relationId,
        }),
      );
    } else {
      const actualChangedFields = collectRelationChangedFields(normalizedBefore, normalizedAfter);
      if (actualChangedFields.length === 0) {
        diagnostics.push(
          buildDiffDiagnostic({
            code: 'diagram.diff.invalid_changed_fields',
            message: `Changed relation "${relationId}" must have at least one changed field.`,
            path: `${path}.changedFields`,
            relationId,
          }),
        );
      } else if (stableSerialize(actualChangedFields) !== stableSerialize(changedFields.value)) {
        diagnostics.push(
          buildDiffDiagnostic({
            code: 'diagram.diff.invalid_changed_fields',
            message: `Changed relation "${relationId}" changedFields do not match its snapshots.`,
            path: `${path}.changedFields`,
            relationId,
          }),
        );
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    value: {
      relationId,
      change: changeValue,
      ...(normalizedBefore ? { before: normalizedBefore } : {}),
      ...(normalizedAfter ? { after: normalizedAfter } : {}),
      changedFields: changedFields.value,
    },
    diagnostics: [],
  };
};

const validateSemanticDiagramDiffObject = (
  candidate: unknown,
): ValidationResult<SemanticDiagramDiff> => {
  if (!isRecord(candidate)) {
    return {
      ok: false,
      diagnostics: [
        buildDiffDiagnostic({
          code: 'diagram.diff.invalid_root',
          message: 'Invalid semantic diagram diff.',
          path: '$',
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (candidate.kind !== DIFF_KIND) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_kind',
        message: `Expected "$.kind" to equal "${DIFF_KIND}".`,
        path: '$.kind',
      }),
    );
  }
  if (candidate.version !== DIFF_VERSION) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.unsupported_version',
        message: `Expected "$.version" to equal ${DIFF_VERSION}.`,
        path: '$.version',
      }),
    );
  }

  const entitiesCandidate = Array.isArray(candidate.entities) ? candidate.entities : undefined;
  const relationsCandidate = Array.isArray(candidate.relations) ? candidate.relations : undefined;
  if (!entitiesCandidate) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_entities',
        message: 'Expected "$.entities" to be an array.',
        path: '$.entities',
      }),
    );
  }
  if (!relationsCandidate) {
    diagnostics.push(
      buildDiffDiagnostic({
        code: 'diagram.diff.invalid_relations',
        message: 'Expected "$.relations" to be an array.',
        path: '$.relations',
      }),
    );
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const entityResults = entitiesCandidate.map((entry, index) =>
    validateEntityDiffEntry(entry, index),
  );
  const relationResults = relationsCandidate.map((entry, index) =>
    validateRelationDiffEntry(entry, index),
  );
  diagnostics.push(
    ...entityResults.flatMap((result) => result.diagnostics),
    ...relationResults.flatMap((result) => result.diagnostics),
  );

  const entityIds = entityResults
    .filter(
      (
        result,
      ): result is ValidationResult<SemanticDiagramEntityDiff> & {
        value: SemanticDiagramEntityDiff;
      } => result.ok && result.value !== undefined,
    )
    .map((result) => result.value.entityId);
  const relationIds = relationResults
    .filter(
      (
        result,
      ): result is ValidationResult<SemanticDiagramRelationDiff> & {
        value: SemanticDiagramRelationDiff;
      } => result.ok && result.value !== undefined,
    )
    .map((result) => result.value.relationId);

  if (new Set(entityIds).size !== entityIds.length) {
    const duplicates = entityIds.filter((id, index) => entityIds.indexOf(id) !== index);
    for (const entityId of new Set(duplicates)) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.duplicate_entity_id',
          message: `Duplicate entity diff id "${entityId}".`,
          entityId,
        }),
      );
    }
  }
  if (new Set(relationIds).size !== relationIds.length) {
    const duplicates = relationIds.filter((id, index) => relationIds.indexOf(id) !== index);
    for (const relationId of new Set(duplicates)) {
      diagnostics.push(
        buildDiffDiagnostic({
          code: 'diagram.diff.duplicate_relation_id',
          message: `Duplicate relation diff id "${relationId}".`,
          relationId,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  return {
    ok: true,
    value: {
      kind: DIFF_KIND,
      version: DIFF_VERSION,
      entities: entityResults
        .flatMap((result) => (result.ok && result.value ? [result.value] : []))
        .sort((left, right) => left.entityId.localeCompare(right.entityId)),
      relations: relationResults
        .flatMap((result) => (result.ok && result.value ? [result.value] : []))
        .sort((left, right) => left.relationId.localeCompare(right.relationId)),
    },
    diagnostics: [],
  };
};

const sparsifySemanticDiagramDiff = (diff: SemanticDiagramDiff): SemanticDiagramDiff => ({
  kind: DIFF_KIND,
  version: DIFF_VERSION,
  entities: diff.entities
    .filter((entry) => entry.change !== 'unchanged')
    .map((entry) => ({
      ...entry,
      changedFields: ENTITY_FIELD_ORDER.filter((field) => entry.changedFields.includes(field)),
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId)),
  relations: diff.relations
    .filter((entry) => entry.change !== 'unchanged')
    .map((entry) => ({
      ...entry,
      changedFields: RELATION_FIELD_ORDER.filter((field) => entry.changedFields.includes(field)),
    }))
    .sort((left, right) => left.relationId.localeCompare(right.relationId)),
});

const parseSemanticDiagramDiff = (raw: string): ValidationResult<unknown> =>
  parseYamlTextResult({
    raw,
    domain: 'diagram',
  });

export const serializeSemanticDiagramDiff = (diff: SemanticDiagramDiff): string =>
  serializeYamlText(sparsifySemanticDiagramDiff(diff));

export function ingestSemanticDiagramDiff(raw: string): ValidationResult<SemanticDiagramDiff> {
  const parsed = parseSemanticDiagramDiff(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics,
    };
  }
  return validateSemanticDiagramDiffObject(parsed.value);
}
