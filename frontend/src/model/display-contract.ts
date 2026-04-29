import { resolveTypeLayoutDefaults } from './layout-defaults';
import {
  resolvePropertyProjectionOptions,
  resolveTypeProjectionOptions,
  shouldProjectPropertyOnCard,
} from './projection-contract';
import type { DisplayContentConfig, DisplayCount, EntityTypeDef, PropertySchema } from './types';
import { resolveTypeVisualDefaults } from './visual-defaults';

export type DisplayCapabilityScope = 'type' | 'property';

export interface DisplayCapabilityDoc {
  key: string;
  scope: DisplayCapabilityScope;
  summary: string;
  details: string;
}

export const TYPE_DISPLAY_CAPABILITIES: DisplayCapabilityDoc[] = [
  {
    key: 'primaryTag',
    scope: 'type',
    summary: 'Sets the default visual identity tag for this type.',
    details:
      'The renderer uses this tag to derive the default node tag label and tag chip styling when an entity does not override it.',
  },
  {
    key: 'defaultSize',
    scope: 'type',
    summary: 'Sets the starting node size for this type.',
    details:
      'Layout can still grow a node to fit content, but this controls the default base width and height.',
  },
  {
    key: 'content',
    scope: 'type',
    summary: 'Selects a richer content renderer for this type.',
    details:
      'Use this for note-like nodes such as markdown or image cards. The renderer resolves content from entity props using the configured prop paths.',
  },
  {
    key: 'count',
    scope: 'type',
    summary: 'Shows a count label for matching child entities.',
    details:
      'The renderer counts contained children whose types match childTypes and renders the configured label on the card or group header.',
  },
  {
    key: 'style.hue',
    scope: 'type',
    summary: 'Provides the preferred hue for the node style.',
    details:
      'When set, the renderer uses this hue for the node chrome and only falls back to tag-derived color when the type does not define one.',
  },
];

export const PROPERTY_DISPLAY_CAPABILITIES: DisplayCapabilityDoc[] = [
  {
    key: 'label',
    scope: 'property',
    summary: 'Overrides the human-facing name shown for this property.',
    details:
      'If omitted, the UI falls back to a prettified version of the property id. An empty label renders only the value.',
  },
  {
    key: 'showIn',
    scope: 'property',
    summary: 'Controls whether the property is shown on cards.',
    details: 'The current renderer supports card display and hidden properties.',
  },
  {
    key: 'valuePath',
    scope: 'property',
    summary: 'Selects a nested value from an object property for display.',
    details:
      'Use this when the property value is an object but the card should show one nested field.',
  },
  {
    key: 'template',
    scope: 'property',
    summary: 'Combines fields from an object property into one display string.',
    details:
      'Template placeholders like {method} and {path} are resolved against the property value when it is an object.',
  },
  {
    key: 'priority',
    scope: 'property',
    summary: 'Orders properties when space is constrained.',
    details:
      'Lower numbers are shown first when the card has to choose which property displays to surface.',
  },
];

export interface ResolvedTypeDisplayOptions {
  primaryTag?: string;
  count?: DisplayCount;
  defaultSize?: {
    width: number;
    height: number;
  };
  content?: DisplayContentConfig;
  hue?: number;
}

export interface ResolvedPropertyDisplayOptions {
  label?: string;
  showIn: 'card' | 'hidden';
  valuePath?: string;
  template?: string;
  priority: number;
}

export const resolveTypeDisplayOptions = (
  typeDef?: Pick<EntityTypeDef, 'display'>,
): ResolvedTypeDisplayOptions => {
  const visual = resolveTypeVisualDefaults(typeDef);
  const projection = resolveTypeProjectionOptions(typeDef);
  const layout = resolveTypeLayoutDefaults(typeDef);
  return {
    primaryTag: visual.primaryTag,
    count: projection.summary,
    defaultSize: layout.baseSize,
    content: projection.richContent,
    hue: visual.fallbackHue,
  };
};

export const resolvePropertyDisplayOptions = (
  property: PropertySchema,
): ResolvedPropertyDisplayOptions | undefined => resolvePropertyProjectionOptions(property);

export const shouldShowPropertyOnCard = (property: PropertySchema) =>
  shouldProjectPropertyOnCard(property);
