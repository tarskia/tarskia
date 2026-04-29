import { forwardRef, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api/generated/gallery/gallery', () => ({
  getGalleryDiagram: vi.fn(),
  useListGalleryDiagrams: vi.fn(() => ({ data: undefined })),
}));

vi.mock('./shell/useAppShellController', () => ({
  useAppShellController: vi.fn(),
}));

vi.mock('./shell/WorkspaceDiagramPane', () => ({
  WorkspaceDiagramPane: forwardRef<
    HTMLDivElement,
    { leftOcclusion: number; model: { showInspector: boolean } }
  >(function WorkspaceDiagramPaneMock({ leftOcclusion, model }, _ref) {
    return (
      <div
        data-left-occlusion={String(leftOcclusion)}
        data-show-inspector={String(model.showInspector)}
      >
        workspace-diagram-pane
      </div>
    );
  }),
}));

vi.mock('./ui/ActivityBar', () => ({
  ActivityBar: () => <div>activity-bar</div>,
}));

vi.mock('./ui/AppHeader', () => ({
  AppHeader: () => <div>app-header</div>,
}));

vi.mock('./ui/Palette', () => ({
  Palette: () => <div>palette</div>,
}));

vi.mock('./ui/SettingsPanel', () => ({
  SettingsPanel: () => <div>settings-panel</div>,
}));

vi.mock('./ui/SidebarPanelFrame', () => ({
  SidebarPanelFrame: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-title={title}>{children}</div>
  ),
}));

import App from './App';
import { useAppShellController } from './shell/useAppShellController';

const mockedUseAppShellController = vi.mocked(useAppShellController);

const buildModel = () =>
  ({
    workspaceBannerProps: undefined,
    topBarProps: {
      diagramName: 'Commerce Platform',
      onDiagramNameChange: vi.fn(),
      diagramNameReadOnly: false,
      diagramStatusLabel: 'Draft',
      onRevertDiagramName: undefined,
    },
    diagramToolbarProps: {
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      canUndo: false,
      canRedo: false,
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
      onClearSearch: vi.fn(),
      searchTotalMatches: 0,
      searchHiddenMatches: 0,
      onRevealSearchResults: undefined,
    },
    settingsPanelProps: {
      nodeVisualMode: 'default',
      onNodeVisualModeChange: vi.fn(),
    },
    workspaceClassName: 'workspace workspace--no-inspector',
    showSchemaEditor: false,
    openSchemaEditor: vi.fn(),
    closeSchemaEditor: vi.fn(),
    editorPanelProps: {
      documentManagerStreams: [],
      onOpenDiagramStream: vi.fn(),
      onRestoreDiagramRevision: vi.fn(),
      onStartNewSchemaDraft: vi.fn(),
      onEditSchemaStream: vi.fn(),
      schemaManagerStreams: [],
      schemaManagerNotice: undefined,
      onDeleteSchemaStream: vi.fn(),
      onUndoDeleteSchemaStream: vi.fn(),
    },
    paletteProps: {
      viewModel: { sections: [] },
      onAdd: vi.fn(),
    },
    importDiagramText: vi.fn(),
    workspaceDiagramRuntimeRef: { current: null },
    workspaceDiagramModel: {
      showInspector: true,
    },
  }) as const;

describe('App workspace diagram boundary', () => {
  it('renders the dedicated workspace diagram pane without relying on hot canvas props', () => {
    mockedUseAppShellController.mockReturnValue(buildModel() as never);

    const html = renderToStaticMarkup(
      <App session={{ mode: 'guest' }} remoteWorkspace={{} as never} />,
    );

    expect(html).toContain('app-header');
    expect(html).toContain('activity-bar');
    expect(html).toContain('workspace-diagram-pane');
    expect(html).toContain('data-show-inspector="true"');
  });
});
