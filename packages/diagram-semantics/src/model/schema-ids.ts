export type SchemaObjectSection = 'types' | 'traits' | 'relations' | 'tags';

export interface QualifiedSchemaObjectId {
  schemaId: string;
  section: SchemaObjectSection;
  localId: string;
}

const QUALIFIED_ID_PATTERNS: Array<{ section: SchemaObjectSection; marker: string }> = [
  { section: 'types', marker: '.types.' },
  { section: 'traits', marker: '.traits.' },
  { section: 'relations', marker: '.relations.' },
  { section: 'tags', marker: '.tags.' },
];

export const CORE_SCHEMA_ID = 'core/web-app';
export const CORE_GROUP_TYPE_ID = `${CORE_SCHEMA_ID}.types.group`;
export const CORE_TABLE_TYPE_ID = 'core/data-model.types.table';
export const CORE_CONTAINS_RELATION_ID = `${CORE_SCHEMA_ID}.relations.contains`;
export const FREEFORM_RELATION_TYPE = 'other';

export const buildQualifiedSchemaObjectId = (
  schemaId: string,
  section: SchemaObjectSection,
  localId: string,
) => `${schemaId}.${section}.${localId}`;

export const parseQualifiedSchemaObjectId = (
  value: string,
): QualifiedSchemaObjectId | undefined => {
  for (const { section, marker } of QUALIFIED_ID_PATTERNS) {
    const markerIndex = value.indexOf(marker);
    if (markerIndex <= 0) continue;
    const schemaId = value.slice(0, markerIndex);
    const localId = value.slice(markerIndex + marker.length);
    if (!schemaId || !localId) continue;
    return { schemaId, section, localId };
  }
  return undefined;
};

export const isQualifiedSchemaObjectId = (value: string) =>
  parseQualifiedSchemaObjectId(value) !== undefined;

export const getSchemaObjectLocalId = (value: string) =>
  parseQualifiedSchemaObjectId(value)?.localId ?? value;

export const getSchemaObjectOwnerId = (value: string) =>
  parseQualifiedSchemaObjectId(value)?.schemaId;
