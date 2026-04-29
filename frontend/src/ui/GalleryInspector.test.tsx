import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { InspectorViewModel } from '../shell/view-models';
import { GalleryInspector } from './GalleryInspector';

const entityViewModel: InspectorViewModel = {
  kind: 'entity',
  entityId: 'entity-1',
  name: 'Orders API',
  description: 'Serves order data to internal consumers.',
  displayName: 'Orders API',
  typeLabel: 'API',
  typeHue: 32,
  displayedTags: [{ id: 'tag-1', label: 'Public' }],
  explicitTagIds: [],
  derivedTagLabels: [],
  availableTagOptions: [],
  propertyEntries: [
    {
      path: 'docs.url',
      label: 'Docs URL',
      value: 'https://example.com/docs/orders',
      href: 'https://example.com/docs/orders',
    },
    {
      path: 'owner',
      label: 'Owner',
      value: 'platform',
    },
  ],
  propertyFields: [],
  provenance: {
    confidence: 0.82,
    locations: [
      {
        path: 'src/orders/api.ts',
        note: 'Matched by worker output.',
        permalink: 'https://github.com/example/repo/blob/main/src/orders/api.ts',
      },
    ],
  },
  selectedChildCount: 0,
  canFocusView: false,
  isFocusedEntity: false,
  childTypeOptions: [],
  siblingTypeOptions: [],
  currentParentLabel: 'Top level',
  moveParentOptions: [],
};

const relationViewModel: InspectorViewModel = {
  kind: 'relation',
  relationId: 'rel-1',
  relationLabel: 'Calls',
  description: 'Invokes the downstream billing service.',
  sourceLabel: 'Orders API',
  targetLabel: 'Billing Service',
  displayedTags: [{ id: 'tag-2', label: 'Sync' }],
  propertyEntries: [
    {
      path: 'reference',
      label: 'Reference',
      value: 'http://example.com/rels/calls',
      href: 'http://example.com/rels/calls',
    },
  ],
  provenance: {
    locations: [
      {
        path: 'src/orders/billing.ts',
        permalink: 'https://github.com/example/repo/blob/main/src/orders/billing.ts',
      },
    ],
  },
};

describe('GalleryInspector', () => {
  it('renders entity information with clickable property and provenance links', () => {
    const html = renderToStaticMarkup(<GalleryInspector viewModel={entityViewModel} />);

    expect(html).toContain('Orders API');
    expect(html).toContain('Serves order data to internal consumers.');
    expect(html).toContain('style="color:hsla(32, 48%, 58%, 0.96)"');
    expect(html).toContain('href="https://example.com/docs/orders"');
    expect(html).toContain('href="https://github.com/example/repo/blob/main/src/orders/api.ts"');
    expect(html).toContain('Matched by worker output.');
  });

  it('renders relation information without editor actions', () => {
    const html = renderToStaticMarkup(<GalleryInspector viewModel={relationViewModel} />);

    expect(html).toContain('Calls');
    expect(html).toContain('From');
    expect(html).toContain('To');
    expect(html).toContain('href="http://example.com/rels/calls"');
    expect(html).not.toContain('Edit tags');
    expect(html).not.toContain('Duplicate');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Add child');
  });
});
