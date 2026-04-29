import { getSchemaDisplayName, parseSchemaRef } from '../schema-ref';
import type { SchemaModule } from '../types';

export interface SchemaModuleSummary {
  imports: string[];
  definitionCounts: {
    types: number;
    traits: number;
    relations: number;
    tags: number;
  };
  updateCount: number;
  removeCount: number;
  summaryLines: string[];
}

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const joinWithAnd = (parts: string[]) => {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
};

const summarizeImports = (imports: string[]) => {
  if (imports.length === 0) return undefined;
  if (imports.length <= 3) {
    return `Uses ${joinWithAnd(imports)}`;
  }
  const first = imports.slice(0, 2);
  const rest = imports.length - first.length;
  return `Uses ${first.join(', ')}, and ${rest} other schema${rest === 1 ? '' : 's'}`;
};

export const summarizeSchemaModule = (module: SchemaModule): SchemaModuleSummary => {
  const imports = Array.from(
    new Set(
      (module.use ?? [])
        .map((entry) => getSchemaDisplayName(parseSchemaRef(entry.schema)))
        .filter((entry) => entry.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const definitionCounts = {
    types: module.types.length,
    traits: (module.traits ?? []).length,
    relations: module.relations.length,
    tags: (module.tags ?? []).length,
  };

  const updateCount = Object.keys(module.update ?? {}).length;
  const removeCount = Object.values(module.remove ?? {}).reduce(
    (count, selectors) => count + selectors.length,
    0,
  );

  const definitionParts = [
    definitionCounts.types > 0 ? formatCount(definitionCounts.types, 'type') : undefined,
    definitionCounts.traits > 0 ? formatCount(definitionCounts.traits, 'trait') : undefined,
    definitionCounts.relations > 0
      ? formatCount(definitionCounts.relations, 'relation')
      : undefined,
    definitionCounts.tags > 0 ? formatCount(definitionCounts.tags, 'tag') : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  const summaryLines = [
    summarizeImports(imports),
    definitionParts.length > 0 ? `Defines ${joinWithAnd(definitionParts)}` : undefined,
    updateCount > 0 ? `Updates ${formatCount(updateCount, 'imported object')}` : undefined,
    removeCount > 0 ? `Removes ${formatCount(removeCount, 'imported object')}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    imports,
    definitionCounts,
    updateCount,
    removeCount,
    summaryLines: summaryLines.length > 0 ? summaryLines : ['No schema elements defined yet'],
  };
};
