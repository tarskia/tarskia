import type { SchemaOptionView } from './view-models';

type SchemaOptionInput = {
  id: string;
  label: string;
  version?: string;
  owner: 'core' | 'gallery' | 'user';
  disabled?: boolean;
  disabledReason?: string;
};

export const buildSchemaOptionViews = (params: {
  availableSchemas: SchemaOptionInput[];
  selectedSchemaIds: string[];
  schemaLockReasons: Record<string, string>;
  schemaToggleBlockReasons: Record<string, string>;
}): SchemaOptionView[] => {
  const { availableSchemas, selectedSchemaIds, schemaLockReasons, schemaToggleBlockReasons } =
    params;
  const selected = new Set(selectedSchemaIds);
  return availableSchemas.map((schema) => ({
    id: schema.id,
    label: schema.label,
    ownerLabel: schema.owner,
    version: schema.version,
    selected: selected.has(schema.id),
    disabled: schema.disabled,
    disabledReason: schema.disabledReason,
    inUseReason: schemaLockReasons[schema.id],
    blockedReason: schemaToggleBlockReasons[schema.id],
    statusTitle: [
      schema.disabledReason,
      schemaLockReasons[schema.id],
      schemaToggleBlockReasons[schema.id],
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));
};
