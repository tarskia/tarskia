import { describe, expect, it } from 'vitest';

import {
  PROPERTY_DISPLAY_CAPABILITIES,
  resolvePropertyDisplayOptions,
  resolveTypeDisplayOptions,
  shouldShowPropertyOnCard,
  TYPE_DISPLAY_CAPABILITIES,
} from './display-contract';
import type { EntityTypeDef, PropertySchema } from './types';

describe('display contract', () => {
  it('documents the supported type and property display capabilities', () => {
    expect(TYPE_DISPLAY_CAPABILITIES.map((capability) => capability.key)).toEqual([
      'primaryTag',
      'defaultSize',
      'content',
      'count',
      'style.hue',
    ]);
    expect(PROPERTY_DISPLAY_CAPABILITIES.map((capability) => capability.key)).toEqual([
      'label',
      'showIn',
      'valuePath',
      'template',
      'priority',
    ]);
  });

  it('normalizes supported type display options', () => {
    const typeDef: EntityTypeDef = {
      id: 'service',
      label: 'Service',
      display: {
        primaryTag: 'service',
        defaultSize: { width: 180, height: 80 },
        count: { childTypes: ['worker'], label: 'workers' },
        style: { hue: 210 },
      },
    };

    expect(resolveTypeDisplayOptions(typeDef)).toEqual({
      primaryTag: 'service',
      defaultSize: { width: 180, height: 80 },
      count: { childTypes: ['worker'], label: 'workers' },
      hue: 210,
    });
  });

  it('normalizes supported property display options and card visibility', () => {
    const property: PropertySchema = {
      id: 'http',
      label: 'HTTP',
      type: 'object',
      display: {
        template: '{method} {path}',
        priority: 1,
      },
    };

    expect(resolvePropertyDisplayOptions(property)).toEqual({
      label: 'HTTP',
      showIn: 'card',
      valuePath: undefined,
      template: '{method} {path}',
      priority: 1,
    });
    expect(shouldShowPropertyOnCard(property)).toBe(true);
  });

  it('treats hidden properties as non-card display', () => {
    const property: PropertySchema = {
      id: 'secret',
      type: 'string',
      display: {
        showIn: 'hidden',
      },
    };

    expect(resolvePropertyDisplayOptions(property)?.showIn).toBe('hidden');
    expect(shouldShowPropertyOnCard(property)).toBe(false);
  });
});
