import type { EntityTypeDef } from '@tarskia/diagram-semantics';

export interface TypeVisualDefaults {
  primaryTag?: string;
  fallbackHue?: number;
}

export const resolveTypeVisualDefaults = (
  typeDef?: Pick<EntityTypeDef, 'display'>,
): TypeVisualDefaults => ({
  primaryTag: typeDef?.display?.primaryTag,
  fallbackHue: typeDef?.display?.style?.hue,
});
