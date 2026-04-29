import type { EntityTypeDef } from './types';

export interface TypeLayoutDefaults {
  baseSize?: {
    width: number;
    height: number;
  };
}

export const resolveTypeLayoutDefaults = (
  typeDef?: Pick<EntityTypeDef, 'display'>,
): TypeLayoutDefaults => ({
  baseSize: typeDef?.display?.defaultSize,
});
