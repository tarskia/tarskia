import type { DisplayContentConfig, DisplayCount, EntityTypeDef, PropertySchema } from './types';

export const DEFAULT_PROPERTY_PROJECTION_SHOW_IN = 'card' as const;
export const DEFAULT_PROPERTY_PROJECTION_PRIORITY = Number.POSITIVE_INFINITY;

export interface TypeProjectionOptions {
  summary?: DisplayCount;
  richContent?: DisplayContentConfig;
}

export interface PropertyProjectionOptions {
  label?: string;
  showIn: 'card' | 'hidden';
  valuePath?: string;
  template?: string;
  priority: number;
}

export const resolveTypeProjectionOptions = (
  typeDef?: Pick<EntityTypeDef, 'display'>,
): TypeProjectionOptions => ({
  summary: typeDef?.display?.count,
  richContent: typeDef?.display?.content,
});

export const resolvePropertyProjectionOptions = (
  property: PropertySchema,
): PropertyProjectionOptions | undefined => {
  if (!property.display) return undefined;
  return {
    label: property.label,
    showIn: property.display.showIn ?? DEFAULT_PROPERTY_PROJECTION_SHOW_IN,
    valuePath: property.display.valuePath,
    template: property.display.template,
    priority: property.display.priority ?? DEFAULT_PROPERTY_PROJECTION_PRIORITY,
  };
};

export const shouldProjectPropertyOnCard = (property: PropertySchema) => {
  const projection = resolvePropertyProjectionOptions(property);
  if (!projection) return false;
  return projection.showIn === 'card';
};
