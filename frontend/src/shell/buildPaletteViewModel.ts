import {
  buildDisambiguatedSchemaObjectLabels,
  getSchemaDisplayName,
  getSchemaObjectLocalId,
  getSchemaObjectOwnerId,
  parseQualifiedSchemaObjectId,
  type SchemaModule,
} from '../semantic';
import type { PaletteTypeDetailLine, PaletteViewModel } from './view-models';

const shortenId = (id: string, ownerSchemaId: string) => {
  const parsed = parseQualifiedSchemaObjectId(id);
  if (!parsed) return id;
  if (parsed.schemaId === ownerSchemaId) return parsed.localId;
  return `${getSchemaDisplayName(parsed.schemaId)}/${parsed.localId}`;
};

const buildDetailLines = (
  schemaId: string,
  typeDef: SchemaModule['types'][number],
): PaletteTypeDetailLine[] => {
  const lines: PaletteTypeDetailLine[] = [];
  if (typeDef.traits && typeDef.traits.length > 0) {
    lines.push({
      label: 'Traits',
      value: typeDef.traits.map((trait) => shortenId(trait, schemaId)).join(', '),
    });
  }
  if (typeDef.defaultTags && typeDef.defaultTags.length > 0) {
    lines.push({
      label: 'Tags',
      value: typeDef.defaultTags.map((tag) => shortenId(tag, schemaId)).join(', '),
    });
  }
  if (
    typeDef.containment?.allowedChildTypes?.length ||
    typeDef.containment?.allowedChildTraits?.length
  ) {
    const children = [
      ...(typeDef.containment.allowedChildTypes ?? []).map((typeId) => shortenId(typeId, schemaId)),
      ...(typeDef.containment.allowedChildTraits ?? []).map((traitId) =>
        shortenId(traitId, schemaId),
      ),
    ];
    lines.push({ label: 'Contains', value: children.join(', ') });
  }
  if (typeDef.properties && typeDef.properties.length > 0) {
    lines.push({
      label: 'Properties',
      value: typeDef.properties.map((property) => property.label ?? property.id).join(', '),
    });
  }
  return lines;
};

export const buildPaletteViewModel = (schema: SchemaModule): PaletteViewModel => {
  const disambiguated = buildDisambiguatedSchemaObjectLabels(
    schema.types.map((type) => ({
      id: type.id,
      label: type.label,
      localId: type.localId,
      originSchemaId: type.originSchemaId,
    })),
  );
  const types = disambiguated.map((item, index) => {
    const typeDef = schema.types[index];
    const schemaId = item.originSchemaId ?? getSchemaObjectOwnerId(item.id) ?? 'unknown';
    return {
      id: item.id,
      displayLabel: item.displayLabel ?? item.localId ?? getSchemaObjectLocalId(item.id),
      schemaId,
      schemaLabel: getSchemaDisplayName(schemaId),
      hue: typeDef?.display?.style?.hue,
      description: typeDef?.description?.trim(),
      detailLines: buildDetailLines(schemaId, typeDef),
    };
  });

  const schemaTabs = Array.from(
    types.reduce((map, type) => {
      const existing = map.get(type.schemaId);
      if (existing) {
        existing.count += 1;
        return map;
      }
      map.set(type.schemaId, {
        id: type.schemaId,
        label: type.schemaLabel,
        count: 1,
      });
      return map;
    }, new Map<string, { id: string; label: string; count: number }>()),
  ).map(([, value]) => value);

  return {
    schemaTabs,
    types,
  };
};
