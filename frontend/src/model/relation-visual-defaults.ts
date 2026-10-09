import type { RelationFlowDirection, RelationTypeDef } from '@tarskia/diagram-semantics';

export const DEFAULT_RELATION_FLOW_DIRECTION: RelationFlowDirection = 'forward';

export interface RelationVisualDefaults {
  flowDirection: RelationFlowDirection;
}

export const resolveRelationVisualDefaults = (
  relationDef?: Pick<RelationTypeDef, 'display'>,
): RelationVisualDefaults => ({
  flowDirection: relationDef?.display?.flowDirection ?? DEFAULT_RELATION_FLOW_DIRECTION,
});
