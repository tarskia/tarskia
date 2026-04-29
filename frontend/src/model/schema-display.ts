import { getSchemaObjectLocalId, getSchemaObjectOwnerId } from './schema-ids';
import { getSchemaDisplayName } from './schema-ref';

type SchemaChoice = {
  id: string;
  label?: string;
  localId?: string;
  originSchemaId?: string;
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

export const getSchemaObjectDisplayLabel = (item: SchemaChoice) =>
  item.label ?? item.localId ?? getSchemaObjectLocalId(item.id);

export const buildDisambiguatedSchemaObjectLabels = <T extends SchemaChoice>(items: T[]) => {
  const labelCounts = new Map<string, number>();
  const localIdCounts = new Map<string, number>();

  for (const item of items) {
    const baseLabel = getSchemaObjectDisplayLabel(item);
    const localId = item.localId ?? getSchemaObjectLocalId(item.id);
    labelCounts.set(normalizeKey(baseLabel), (labelCounts.get(normalizeKey(baseLabel)) ?? 0) + 1);
    localIdCounts.set(normalizeKey(localId), (localIdCounts.get(normalizeKey(localId)) ?? 0) + 1);
  }

  return items.map((item) => {
    const baseLabel = getSchemaObjectDisplayLabel(item);
    const localId = item.localId ?? getSchemaObjectLocalId(item.id);
    const ownerId = item.originSchemaId ?? getSchemaObjectOwnerId(item.id);
    const ambiguous =
      (labelCounts.get(normalizeKey(baseLabel)) ?? 0) > 1 ||
      (localIdCounts.get(normalizeKey(localId)) ?? 0) > 1;

    return {
      ...item,
      displayLabel:
        ambiguous && ownerId ? `${baseLabel} · ${getSchemaDisplayName(ownerId)}` : baseLabel,
    };
  });
};
