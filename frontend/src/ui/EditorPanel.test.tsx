import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EditorPanel } from './EditorPanel';

const buildProps = (
  overrides: Partial<ComponentProps<typeof EditorPanel>> = {},
): ComponentProps<typeof EditorPanel> => ({
  schemaDraftText: 'types: []',
  schemaDraftName: 'Example',
  schemaDraftVersionLabel: 'v1.0',
  onSchemaDraftChange: vi.fn(),
  onSchemaDraftNameChange: vi.fn(),
  onResetSchemaDraft: vi.fn(),
  resetDraftLabel: 'Reset to scratch',
  draftSchemaDiagnostics: [],
  schemaDraftNoticeLines: [],
  schemaStateTone: 'valid',
  schemaStateLines: ['Defines 1 type'],
  diagramStateTone: 'valid',
  diagramStateLines: ['Current diagram is compatible with this schema.'],
  schemaDraftHighlights: [],
  saveDraftLabel: 'Save draft',
  onSaveDraft: vi.fn(),
  canPublish: true,
  publishLabel: 'Publish v1.0',
  onPublish: vi.fn(),
  showPublishedDiagramAction: false,
  publishedDiagramActionDisabled: true,
  publishedDiagramActionDisabledReason: undefined,
  onApplyPublishedSchema: vi.fn(),
  referencePanelMode: undefined,
  onSelectReferencePanel: vi.fn(),
  schemaCookbookRecipes: [],
  canInsertCookbook: true,
  onInsertSchemaCookbookRecipe: vi.fn(),
  schemaDependencies: [],
  schemaReferenceSections: [],
  schemaManagerStreams: [],
  schemaManagerNotice: undefined,
  onEditSchemaStream: vi.fn(),
  onDeleteSchemaStream: vi.fn(),
  onUndoDeleteSchemaStream: vi.fn(),
  ...overrides,
});

describe('EditorPanel', () => {
  it('renders publishability status and cookbook content when the cookbook rail is open', () => {
    const html = renderToStaticMarkup(
      <EditorPanel
        {...buildProps({
          referencePanelMode: 'cookbook',
          schemaStateLines: ['Defines 1 type', 'Uses web-app', 'Updates 1 imported object'],
          schemaDraftHighlights: [{ startLine: 4, endLine: 8 }],
          canPublish: false,
          publishLabel: 'Publish v1.1',
          schemaCookbookRecipes: [
            {
              id: 'add-type',
              title: 'Add a type',
              description: 'Define a new component.',
              category: 'define',
              previewText: 'use:\n  - schema: web-app\n    alias: web\n\ntypes:\n  - id: worker',
            },
          ],
        })}
      />,
    );

    expect(html).toContain('v1.0');
    expect(html).toContain('Checks');
    expect(html).toContain('Schema');
    expect(html).toContain('Diagram');
    expect(html).toContain('Defines 1 type');
    expect(html).toContain('Uses web-app');
    expect(html).toContain('Updates 1 imported object');
    expect(html).toContain('Cook');
    expect(html).toContain('Deps');
    expect(html).toContain('Ref');
    expect(html).toContain('Save');
    expect(html).toContain('Add a type');
    expect(html).toContain('use:\n  - schema: web-app');
    expect(html).toContain('Insert');
    expect(html).toContain('Publish v1.1');
    expect(html).toContain('disabled=""');
  });

  it('renders dependency content when the dependency rail is open', () => {
    const html = renderToStaticMarkup(
      <EditorPanel
        {...buildProps({
          referencePanelMode: 'dependencies',
          schemaDraftText: 'use:\n  - schema: core/web-app@1.0\n    alias: web',
          schemaStateLines: ['Uses web-app'],
          schemaDependencies: [
            {
              schemaRef: 'core/web-app',
              schemaLabel: 'web-app',
              version: '1.0',
              alias: 'web',
              objects: [
                {
                  section: 'types',
                  id: 'api-endpoint',
                  label: 'API endpoint',
                  selectorPath: 'web.types.api-endpoint',
                  previewText:
                    'types:\n  - id: api-endpoint\n    label: API endpoint\n    extends: application-component',
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(html).toContain('Dependencies');
    expect(html).toContain('Imported schemas');
    expect(html).toContain('web-app');
    expect(html).toContain('Imported as web');
    expect(html).toContain('Selector: web.types.api-endpoint');
    expect(html).toContain('api-endpoint');
    expect(html).toContain('Copy selector');
  });

  it('renders curated schema reference content when the reference rail is open', () => {
    const html = renderToStaticMarkup(
      <EditorPanel
        {...buildProps({
          referencePanelMode: 'reference',
          diagramStateTone: 'invalid',
          diagramStateLines: ['The current diagram would not validate under this schema.'],
          schemaReferenceSections: [
            {
              id: 'types',
              title: 'Types',
              description: 'Keys used to define entity types.',
              entries: [
                {
                  key: 'types[].extends',
                  summary: 'Inherits defaults and behavior from another type.',
                  details: 'This merges traits, default tags, display, and properties.',
                  example: 'extends: web.types.service',
                  values: ['web.types.service'],
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(html).toContain('Reference');
    expect(html).toContain('Types');
    expect(html).toContain('types[].extends');
    expect(html).toContain('Inherits defaults and behavior from another type.');
    expect(html).toContain('extends: web.types.service');
    expect(html).toContain('The current diagram would not validate under this schema.');
    expect(html).toContain('warning');
  });

  it('keeps the reference column visible with a placeholder when no schema tool is open', () => {
    const html = renderToStaticMarkup(<EditorPanel {...buildProps()} />);

    expect(html).toContain('Checks');
    expect(html).toContain('Context');
    expect(html).toContain('Choose a context tool above');
  });

  it('renders the schema manager with editable streams and read-only version previews', () => {
    const html = renderToStaticMarkup(
      <EditorPanel
        {...buildProps({
          schemaDraftVersionLabel: 'v1.1',
          resetDraftLabel: 'Reset to v1.1',
          schemaStateLines: ['Changed 1 relation'],
          publishLabel: 'Publish v1.2',
          referencePanelMode: 'schemas',
          schemaManagerStreams: [
            {
              schemaRef: 'user/payments',
              name: 'Payments',
              updatedAtLabel: '2026-03-23 09:30Z',
              latestVersion: '1.1',
              hasDraft: true,
              draftBaseVersion: '1.1',
              draftUpdatedAtLabel: '2026-03-23 09:31Z',
              isEditing: true,
              inUse: false,
              deleteDisabled: false,
              versions: [
                {
                  key: 'user/payments@1.1',
                  version: '1.1',
                  publishedAtLabel: '2026-03-23 09:00Z',
                  summaryLines: ['Removed read-write relation'],
                  previewText: 'owner: user\nname: payments\nversion: "1.1"',
                  isLatest: true,
                  isAppliedToDiagram: false,
                },
              ],
            },
          ],
          schemaManagerNotice: 'Deleted Orders.',
        })}
      />,
    );

    expect(html).toContain('Schemas');
    expect(html).toContain('Payments');
    expect(html).toContain('editing');
    expect(html).toContain('Continue editing');
    expect(html).toContain('Published versions');
    expect(html).toContain('Copy');
    expect(html).toContain('Deleted Orders.');
    expect(html).toContain('Undo');
  });
});
