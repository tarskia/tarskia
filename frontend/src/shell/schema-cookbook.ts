import addRelationRaw from '../data/schema-cookbook/add-relation.yaml?raw';
import addTagRaw from '../data/schema-cookbook/add-tag.yaml?raw';
import addTraitRaw from '../data/schema-cookbook/add-trait.yaml?raw';
import addTypeRaw from '../data/schema-cookbook/add-type.yaml?raw';
import removeDeprecatedElementsRaw from '../data/schema-cookbook/remove-deprecated-elements.yaml?raw';
import updateImportedTypeRaw from '../data/schema-cookbook/update-imported-type.yaml?raw';
import type { SchemaImport, SchemaModule } from '../semantic';
import { parseAndValidateSchemaModule, summarizeSchemaModule } from '../semantic';
import {
  type EditorSchemaDraftRecord,
  parseEditorSchemaDraftRecord,
  serializeEditorSchemaDraftRecord,
  toEditorSchemaDraftText,
} from './schema-editor-draft';

export type SchemaCookbookRecipeCategory = 'define' | 'adapt' | 'remove';
export type SchemaCookbookItemKind =
  | 'use'
  | 'tag'
  | 'trait'
  | 'type'
  | 'relation'
  | 'update'
  | 'remove';
export type SchemaCookbookSkippedReason = 'conflict' | 'already_present';

export interface SchemaCookbookRecipe {
  id: string;
  title: string;
  description: string;
  category: SchemaCookbookRecipeCategory;
  moduleYaml: string;
  previewText: string;
  summaryLines: string[];
}

export interface SchemaCookbookRange {
  startLine: number;
  endLine: number;
}

export interface SchemaCookbookItemRef {
  kind: SchemaCookbookItemKind;
  key: string;
  label: string;
}

export interface SchemaCookbookSkippedItem extends SchemaCookbookItemRef {
  reason: SchemaCookbookSkippedReason;
}

export interface SchemaCookbookMergeResult {
  nextDraftText: string;
  insertedRanges: SchemaCookbookRange[];
  insertedItems: SchemaCookbookItemRef[];
  skippedItems: SchemaCookbookSkippedItem[];
  messageLines: string[];
}

const DRAFT_SECTION_ORDER = ['use', 'tags', 'traits', 'types', 'relations', 'update', 'remove'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepClone = <T>(value: T): T =>
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

const humanizeKind = (kind: SchemaCookbookItemKind, count: number) => {
  const noun =
    kind === 'use'
      ? 'import'
      : kind === 'tag'
        ? 'tag'
        : kind === 'trait'
          ? 'trait'
          : kind === 'type'
            ? 'type'
            : kind === 'relation'
              ? 'relation'
              : kind === 'update'
                ? 'update'
                : 'remove entry';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
};

const describeItem = (item: SchemaCookbookItemRef) => {
  switch (item.kind) {
    case 'use':
      return `import ${item.label}`;
    case 'tag':
      return `tag ${item.label}`;
    case 'trait':
      return `trait ${item.label}`;
    case 'type':
      return `type ${item.label}`;
    case 'relation':
      return `relation ${item.label}`;
    case 'update':
      return `update ${item.label}`;
    case 'remove':
      return `remove ${item.label}`;
    default:
      return item.label;
  }
};

const joinWithAnd = (parts: string[]) => {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadCookbookModule = (raw: string, label: string): SchemaModule => {
  const result = parseAndValidateSchemaModule(raw);
  if (!result.ok || !result.value) {
    throw new Error(`Invalid cookbook recipe ${label}`);
  }
  return result.value;
};

const normalizeImport = (entry: unknown): SchemaImport | undefined => {
  if (!isRecord(entry) || typeof entry.schema !== 'string') return undefined;
  const schema = entry.schema.trim();
  if (schema.length === 0) return undefined;
  return {
    schema,
    alias:
      typeof entry.alias === 'string' && entry.alias.trim().length > 0 ? entry.alias : undefined,
  };
};

const rewriteAliasInString = (value: string, rewrites: Map<string, string>) => {
  let next = value;
  for (const [from, to] of rewrites) {
    if (from === to) continue;
    if (next === from) {
      next = to;
      continue;
    }
    if (next.startsWith(`${from}.`)) {
      next = `${to}${next.slice(from.length)}`;
    }
  }
  return next;
};

const rewriteAliases = (value: unknown, rewrites: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    return rewriteAliasInString(value, rewrites);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteAliases(entry, rewrites));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[rewriteAliasInString(key, rewrites)] = rewriteAliases(entry, rewrites);
    }
    return next;
  }
  return value;
};

const asImportList = (value: unknown): SchemaImport[] =>
  Array.isArray(value)
    ? value
        .map((entry) => normalizeImport(entry))
        .filter((entry): entry is SchemaImport => Boolean(entry))
    : [];

const ensureRecordSection = (
  record: EditorSchemaDraftRecord,
  key: string,
): Record<string, unknown> => {
  const existing = record[key];
  if (isRecord(existing)) return existing;
  const next: Record<string, unknown> = {};
  record[key] = next;
  return next;
};

const ensureArraySection = (
  record: EditorSchemaDraftRecord,
  key: string,
): Record<string, unknown>[] => {
  const existing = record[key];
  if (Array.isArray(existing))
    return existing.filter((entry): entry is Record<string, unknown> => isRecord(entry));
  const next: Record<string, unknown>[] = [];
  record[key] = next;
  return next;
};

const buildMessageLines = (
  insertedItems: SchemaCookbookItemRef[],
  skippedItems: SchemaCookbookSkippedItem[],
): string[] => {
  const insertedCounts = new Map<SchemaCookbookItemKind, number>();
  const skippedConflictCounts = new Map<SchemaCookbookItemKind, number>();
  const skippedDuplicateCounts = new Map<SchemaCookbookItemKind, number>();

  for (const item of insertedItems) {
    insertedCounts.set(item.kind, (insertedCounts.get(item.kind) ?? 0) + 1);
  }
  for (const item of skippedItems) {
    const targetMap =
      item.reason === 'already_present' ? skippedDuplicateCounts : skippedConflictCounts;
    targetMap.set(item.kind, (targetMap.get(item.kind) ?? 0) + 1);
  }

  const insertedLine =
    insertedItems.length > 0
      ? `Inserted ${joinWithAnd(
          [...insertedCounts.entries()].map(([kind, count]) => humanizeKind(kind, count)),
        )}.`
      : undefined;
  const skippedConflictLine =
    skippedConflictCounts.size > 0
      ? `Skipped ${joinWithAnd(
          [...skippedConflictCounts.entries()].map(([kind, count]) => humanizeKind(kind, count)),
        )} because they already exist in the draft.`
      : undefined;
  const skippedDuplicateLine =
    skippedDuplicateCounts.size > 0
      ? `Skipped ${joinWithAnd(
          [...skippedDuplicateCounts.entries()].map(([kind, count]) => humanizeKind(kind, count)),
        )} because they are already present.`
      : undefined;

  const skippedDetailLines = skippedItems.map((item) =>
    item.reason === 'already_present'
      ? `Skipped ${describeItem(item)} because it is already present.`
      : `Skipped ${describeItem(item)} because it already exists in the draft.`,
  );

  return [insertedLine, skippedConflictLine, skippedDuplicateLine, ...skippedDetailLines].filter(
    (line): line is string => Boolean(line),
  );
};

const findSectionBounds = (lines: string[], section: string) => {
  const sectionPattern = new RegExp(`^${escapeRegExp(section)}:$`);
  const start = lines.findIndex((line) => sectionPattern.test(line));
  if (start < 0) return undefined;
  let end = lines.length - 1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[a-z][A-Za-z0-9_-]*:/.test(lines[index] ?? '')) {
      end = index - 1;
      break;
    }
  }
  return { start, end };
};

const findListItemRange = (
  lines: string[],
  section: string,
  id: string,
): SchemaCookbookRange | undefined => {
  const bounds = findSectionBounds(lines, section);
  if (!bounds) return undefined;
  const itemPattern = new RegExp(`^ {2}- id: ${escapeRegExp(id)}$`);
  const start = lines.findIndex(
    (line, index) => index >= bounds.start && index <= bounds.end && itemPattern.test(line),
  );
  if (start < 0) return undefined;
  let end = bounds.end;
  for (let index = start + 1; index <= bounds.end; index += 1) {
    if (/^ {2}- id: /.test(lines[index] ?? '')) {
      end = index - 1;
      break;
    }
  }
  return { startLine: start + 1, endLine: end + 1 };
};

const findUseRange = (
  lines: string[],
  schemaDisplayId: string,
): SchemaCookbookRange | undefined => {
  const bounds = findSectionBounds(lines, 'use');
  if (!bounds) return undefined;
  const itemPattern = new RegExp(`^ {2}- schema: ${escapeRegExp(schemaDisplayId)}$`);
  const start = lines.findIndex(
    (line, index) => index >= bounds.start && index <= bounds.end && itemPattern.test(line),
  );
  if (start < 0) return undefined;
  let end = bounds.end;
  for (let index = start + 1; index <= bounds.end; index += 1) {
    if (/^ {2}- schema: /.test(lines[index] ?? '')) {
      end = index - 1;
      break;
    }
  }
  return { startLine: start + 1, endLine: end + 1 };
};

const findMapItemRange = (
  lines: string[],
  section: string,
  key: string,
): SchemaCookbookRange | undefined => {
  const bounds = findSectionBounds(lines, section);
  if (!bounds) return undefined;
  const itemPattern = new RegExp(`^ {2}${escapeRegExp(key)}:$`);
  const start = lines.findIndex(
    (line, index) => index >= bounds.start && index <= bounds.end && itemPattern.test(line),
  );
  if (start < 0) return undefined;
  let end = bounds.end;
  for (let index = start + 1; index <= bounds.end; index += 1) {
    if (/^ {2}[^ ][^:]*:$/.test(lines[index] ?? '')) {
      end = index - 1;
      break;
    }
  }
  return { startLine: start + 1, endLine: end + 1 };
};

const locateInsertedRanges = (draftText: string, insertedItems: SchemaCookbookItemRef[]) => {
  const lines = draftText.split('\n');
  const ranges = new Map<string, SchemaCookbookRange>();

  for (const item of insertedItems) {
    const range =
      item.kind === 'use'
        ? findUseRange(lines, item.key)
        : item.kind === 'tag'
          ? findListItemRange(lines, 'tags', item.key)
          : item.kind === 'trait'
            ? findListItemRange(lines, 'traits', item.key)
            : item.kind === 'type'
              ? findListItemRange(lines, 'types', item.key)
              : item.kind === 'relation'
                ? findListItemRange(lines, 'relations', item.key)
                : item.kind === 'update'
                  ? findMapItemRange(lines, 'update', item.key)
                  : findMapItemRange(lines, 'remove', item.key);
    if (!range) continue;
    ranges.set(`${range.startLine}:${range.endLine}`, range);
  }

  return [...ranges.values()];
};

const buildRecipe = (params: {
  id: string;
  title: string;
  description: string;
  category: SchemaCookbookRecipeCategory;
  moduleYaml: string;
}): SchemaCookbookRecipe => {
  const module = loadCookbookModule(params.moduleYaml, params.id);
  return {
    ...params,
    previewText: toEditorSchemaDraftText(params.moduleYaml),
    summaryLines: summarizeSchemaModule(module).summaryLines,
  };
};

export const schemaCookbookRecipes: SchemaCookbookRecipe[] = [
  buildRecipe({
    id: 'add-tag',
    title: 'Add a tag',
    description: 'Define a tag for private or internal components.',
    category: 'define',
    moduleYaml: addTagRaw,
  }),
  buildRecipe({
    id: 'add-trait',
    title: 'Add a trait',
    description: 'Define a reusable capability that can be applied across types.',
    category: 'define',
    moduleYaml: addTraitRaw,
  }),
  buildRecipe({
    id: 'add-type',
    title: 'Add a type',
    description: 'Define a new application-style component with one concrete property.',
    category: 'define',
    moduleYaml: addTypeRaw,
  }),
  buildRecipe({
    id: 'add-relation',
    title: 'Add a relation',
    description: 'Connect an API endpoint to a data-model table with a cross-schema relation.',
    category: 'define',
    moduleYaml: addRelationRaw,
  }),
  buildRecipe({
    id: 'update-imported-type',
    title: 'Update an imported type',
    description: 'Adapt the imported API endpoint type with an extra property.',
    category: 'adapt',
    moduleYaml: updateImportedTypeRaw,
  }),
  buildRecipe({
    id: 'remove-deprecated-elements',
    title: 'Remove deprecated elements',
    description: 'Remove an imported relation and an imported property that are no longer needed.',
    category: 'remove',
    moduleYaml: removeDeprecatedElementsRaw,
  }),
];

export const shouldAutoOpenSchemaCookbook = (publishedSchemaCount: number) =>
  publishedSchemaCount === 0;

export const mergeSchemaCookbookRecipeIntoDraft = (params: {
  draftText: string;
  recipe: SchemaCookbookRecipe;
}): SchemaCookbookMergeResult => {
  const { draftText, recipe } = params;
  const currentRecord = parseEditorSchemaDraftRecord(draftText);
  if (!currentRecord) {
    throw new Error('Cannot insert cookbook content into an invalid draft.');
  }

  const recipeRecord = parseEditorSchemaDraftRecord(toEditorSchemaDraftText(recipe.moduleYaml));
  if (!recipeRecord) {
    throw new Error(`Cookbook recipe ${recipe.id} is invalid.`);
  }

  const nextRecord = deepClone(currentRecord);
  const insertedItems: SchemaCookbookItemRef[] = [];
  const skippedItems: SchemaCookbookSkippedItem[] = [];

  const currentImports = asImportList(nextRecord.use);
  const existingImportBySchema = new Map<string, SchemaImport>();
  for (const entry of currentImports) {
    existingImportBySchema.set(entry.schema, entry);
  }

  const recipeImports = asImportList(recipeRecord.use);
  const aliasRewrites = new Map<string, string>();
  const mergedImports = [...currentImports];
  for (const entry of recipeImports) {
    const existingImport = existingImportBySchema.get(entry.schema);
    if (existingImport) {
      if (!existingImport.alias && entry.alias) {
        existingImport.alias = entry.alias;
      } else if (entry.alias && existingImport.alias && entry.alias !== existingImport.alias) {
        aliasRewrites.set(entry.alias, existingImport.alias);
      }
      continue;
    }
    mergedImports.push(entry);
    existingImportBySchema.set(entry.schema, entry);
    insertedItems.push({
      kind: 'use',
      key: entry.schema,
      label: entry.alias ? `${entry.schema} as ${entry.alias}` : entry.schema,
    });
  }
  nextRecord.use = mergedImports;

  const rewrittenRecipeRecord = rewriteAliases(
    recipeRecord,
    aliasRewrites,
  ) as EditorSchemaDraftRecord;

  const mergeListSection = (
    section: 'tags' | 'traits' | 'types' | 'relations',
    kind: Extract<SchemaCookbookItemKind, 'tag' | 'trait' | 'type' | 'relation'>,
  ) => {
    const currentSection = ensureArraySection(nextRecord, section);
    const existingIds = new Set(
      currentSection
        .map((entry) => (typeof entry.id === 'string' ? entry.id : undefined))
        .filter((entry): entry is string => Boolean(entry)),
    );
    const recipeSection = Array.isArray(rewrittenRecipeRecord[section])
      ? rewrittenRecipeRecord[section].filter((entry): entry is Record<string, unknown> =>
          isRecord(entry),
        )
      : [];

    for (const entry of recipeSection) {
      const id = typeof entry.id === 'string' ? entry.id : undefined;
      if (!id) continue;
      if (existingIds.has(id)) {
        skippedItems.push({ kind, key: id, label: id, reason: 'conflict' });
        continue;
      }
      currentSection.push(entry);
      existingIds.add(id);
      insertedItems.push({ kind, key: id, label: id });
    }
    nextRecord[section] = currentSection;
  };

  mergeListSection('tags', 'tag');
  mergeListSection('traits', 'trait');
  mergeListSection('types', 'type');
  mergeListSection('relations', 'relation');

  const currentUpdate = ensureRecordSection(nextRecord, 'update');
  const recipeUpdate = isRecord(rewrittenRecipeRecord.update) ? rewrittenRecipeRecord.update : {};
  for (const [selector, entry] of Object.entries(recipeUpdate)) {
    if (selector in currentUpdate) {
      skippedItems.push({ kind: 'update', key: selector, label: selector, reason: 'conflict' });
      continue;
    }
    currentUpdate[selector] = entry;
    insertedItems.push({ kind: 'update', key: selector, label: selector });
  }
  nextRecord.update = currentUpdate;

  const currentRemove = ensureRecordSection(nextRecord, 'remove');
  const recipeRemove = isRecord(rewrittenRecipeRecord.remove) ? rewrittenRecipeRecord.remove : {};
  for (const [target, selectors] of Object.entries(recipeRemove)) {
    const currentSelectors = Array.isArray(currentRemove[target])
      ? [
          ...(currentRemove[target] as unknown[]).filter(
            (entry): entry is string => typeof entry === 'string',
          ),
        ]
      : [];
    const currentSelectorSet = new Set(currentSelectors);
    if (!Array.isArray(selectors)) continue;
    for (const selector of selectors) {
      if (typeof selector !== 'string') continue;
      if (currentSelectorSet.has(selector)) {
        skippedItems.push({
          kind: 'remove',
          key: target,
          label: `${target} → ${selector}`,
          reason: 'already_present',
        });
        continue;
      }
      currentSelectors.push(selector);
      currentSelectorSet.add(selector);
      insertedItems.push({
        kind: 'remove',
        key: target,
        label: `${target} → ${selector}`,
      });
    }
    currentRemove[target] = currentSelectors;
  }
  nextRecord.remove = currentRemove;

  const nextDraftText = serializeEditorSchemaDraftRecord(
    Object.fromEntries(
      Object.entries(nextRecord).sort(([left], [right]) => {
        const leftIndex = DRAFT_SECTION_ORDER.indexOf(left);
        const rightIndex = DRAFT_SECTION_ORDER.indexOf(right);
        if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
        if (leftIndex >= 0) return -1;
        if (rightIndex >= 0) return 1;
        return left.localeCompare(right);
      }),
    ),
  );

  return {
    nextDraftText,
    insertedRanges: locateInsertedRanges(nextDraftText, insertedItems),
    insertedItems,
    skippedItems,
    messageLines: buildMessageLines(insertedItems, skippedItems),
  };
};
