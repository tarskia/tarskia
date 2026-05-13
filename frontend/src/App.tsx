import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { resolveRequestUrl } from './api/client/custom-fetch';
import { getGalleryDiagram, useListGalleryDiagrams } from './api/generated/gallery/gallery';
import type { DtoGalleryDiagramSummaryResponse } from './api/generated/model';
import type { RemoteWorkspaceState } from './persistence/useRemoteWorkspace';
import type { AppSession } from './session/useAppSession';
import { formatDiagramImportFailureNotice } from './shell/imported-diagram';
import { useAppShellController } from './shell/useAppShellController';
import { WorkspaceDiagramPane } from './shell/WorkspaceDiagramPane';
import { ActivityBar } from './ui/ActivityBar';
import { AppHeader } from './ui/AppHeader';
import { Palette } from './ui/Palette';
import { SettingsPanel } from './ui/SettingsPanel';
import { SidebarPanelFrame } from './ui/SidebarPanelFrame';

const loadEditorPanel = () => import('./ui/EditorPanel');
const loadDiagramBrowser = () => import('./ui/DiagramBrowser');
const loadGalleryBrowser = () => import('./ui/GalleryBrowser');
const loadSchemaBrowser = () => import('./ui/SchemaBrowser');
const loadSchemaAuthoringSupport = () => import('./shell/schema-authoring-support');

const LazyEditorPanel = lazy(async () => ({ default: (await loadEditorPanel()).EditorPanel }));
const LazyDiagramBrowser = lazy(async () => ({
  default: (await loadDiagramBrowser()).DiagramBrowser,
}));
const LazyGalleryBrowser = lazy(async () => ({
  default: (await loadGalleryBrowser()).GalleryBrowser,
}));
const LazySchemaBrowser = lazy(async () => ({
  default: (await loadSchemaBrowser()).SchemaBrowser,
}));

export type SidebarPanel = 'palette' | 'diagrams' | 'gallery' | 'schemas' | 'settings' | null;

const COMPACT_SIDEBAR_DEFAULT_WIDTH = 416;
const EDITOR_SIDEBAR_DEFAULT_WIDTH = 912;
const SIDEBAR_KEYBOARD_STEP = 32;
const SIDEBAR_RESIZE_HANDLE_WIDTH = 8;
const ACTIVITY_BAR_WIDTH = 48;
const INSPECTOR_PANEL_WIDTH = 320;
const EMPTY_EXAMPLE_DIAGRAMS: DtoGalleryDiagramSummaryResponse[] = [];

const buildExampleDiagramKey = (entry: { namespace: string; slug: string }) =>
  `${entry.namespace}/${entry.slug}`;

const getViewportWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);
const getSidebarViewportWidth = (viewportWidth: number, showInspector: boolean) =>
  Math.max(420, viewportWidth - ACTIVITY_BAR_WIDTH - (showInspector ? INSPECTOR_PANEL_WIDTH : 0));

const getSidebarBounds = (showSchemaEditor: boolean, availableWidth: number) => {
  if (showSchemaEditor) {
    const min = 420;
    const max = Math.max(min, Math.min(1080, Math.floor(availableWidth * 0.78)));
    return { min, max };
  }
  const min = 220;
  const max = Math.max(min, Math.min(560, Math.floor(availableWidth * 0.5)));
  return { min, max };
};

const clampSidebarWidth = (width: number, showSchemaEditor: boolean, availableWidth: number) => {
  const { min, max } = getSidebarBounds(showSchemaEditor, availableWidth);
  return Math.min(max, Math.max(min, width));
};

const schedulePostInteractiveWork = (work: () => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  let cancelled = false;
  let idleId: number | undefined;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const run = () => {
    if (!cancelled) {
      work();
    }
  };
  const frameId = window.requestAnimationFrame(() => {
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run);
      return;
    }
    timeoutId = globalThis.setTimeout(run, 300);
  });
  return () => {
    cancelled = true;
    if (frameId !== undefined) {
      window.cancelAnimationFrame(frameId);
    }
    if (idleId !== undefined && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleId);
    }
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  };
};

const shouldPrefetchSidebarModules = () => {
  if (import.meta.env.DEV) {
    return true;
  }
  if (typeof navigator === 'undefined') {
    return false;
  }
  const connection = (
    navigator as Navigator & {
      connection?: {
        effectiveType?: string;
        saveData?: boolean;
      };
    }
  ).connection;
  if (connection?.saveData) {
    return false;
  }
  return !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
};

const SidebarLoader = ({ label, title }: { label: string; title: string }) => (
  <SidebarPanelFrame title={title}>
    <div className="flex h-full items-center justify-center rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      Loading {label}…
    </div>
  </SidebarPanelFrame>
);

export interface LoadedAppProps {
  session: Exclude<AppSession, { mode: 'loading' }>;
  remoteWorkspace: RemoteWorkspaceState;
}

export default function App({ session, remoteWorkspace }: LoadedAppProps) {
  const model = useAppShellController({
    session,
    remoteWorkspace,
  });
  const navigateToAuthPath = useCallback((path: '/auth/login' | '/auth/signup') => {
    if (typeof window === 'undefined') {
      return;
    }
    window.location.assign(resolveRequestUrl(path));
  }, []);
  const submitAuthPost = useCallback((path: '/auth/logout') => {
    if (typeof document === 'undefined') {
      return;
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = resolveRequestUrl(path);
    form.style.display = 'none';
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }, []);

  const exampleDiagramCatalogQuery = useListGalleryDiagrams({
    query: {
      staleTime: 30_000,
    },
  });
  const exampleDiagrams =
    exampleDiagramCatalogQuery.data?.status === 200
      ? exampleDiagramCatalogQuery.data.data
      : EMPTY_EXAMPLE_DIAGRAMS;

  useEffect(() => {
    if (!shouldPrefetchSidebarModules()) {
      return undefined;
    }
    return schedulePostInteractiveWork(() => {
      void loadEditorPanel();
      void loadDiagramBrowser();
      void loadGalleryBrowser();
      void loadSchemaBrowser();
      void loadSchemaAuthoringSupport();
    });
  }, []);

  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('diagrams');
  const [compactSidebarWidth, setCompactSidebarWidth] = useState(COMPACT_SIDEBAR_DEFAULT_WIDTH);
  const [editorSidebarWidth, setEditorSidebarWidth] = useState(EDITOR_SIDEBAR_DEFAULT_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const lastSidebarStateRef = useRef<{
    panel: SidebarPanel;
    showSchemaEditor: boolean;
  } | null>(null);
  const sidebarDragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    showSchemaEditor: boolean;
  } | null>(null);
  const [loadingExampleDiagramKey, setLoadingExampleDiagramKey] = useState<string | undefined>();
  const [diagramBrowserNotice, setDiagramBrowserNotice] = useState<string | undefined>();
  const showSchemaEditor = model.showSchemaEditor;
  const layoutShowInspector = model.workspaceDiagramModel.showInspector;
  const isSidebarVisible = showSchemaEditor || sidebarPanel !== null;
  const viewportWidth = getViewportWidth();
  const sidebarViewportWidth = getSidebarViewportWidth(viewportWidth, layoutShowInspector);
  const sidebarBounds = getSidebarBounds(showSchemaEditor, sidebarViewportWidth);
  const activeSidebarWidth = showSchemaEditor ? editorSidebarWidth : compactSidebarWidth;
  const resolvedSidebarWidth = clampSidebarWidth(
    activeSidebarWidth,
    showSchemaEditor,
    sidebarViewportWidth,
  );
  const canvasLeftOcclusion = isSidebarVisible ? resolvedSidebarWidth : 0;

  useEffect(() => {
    if (!showSchemaEditor) {
      return;
    }
    setSidebarPanel('schemas');
  }, [showSchemaEditor]);

  const toggleSidebar = useCallback(
    (panel: SidebarPanel) => {
      if (showSchemaEditor) {
        model.closeSchemaEditor();
        setSidebarPanel(panel);
        return;
      }
      setSidebarPanel((prev) => (prev === panel ? null : panel));
    },
    [model, showSchemaEditor],
  );

  const toggleSidebarVisibility = useCallback(() => {
    if (showSchemaEditor || sidebarPanel !== null) {
      lastSidebarStateRef.current = {
        panel: sidebarPanel ?? 'schemas',
        showSchemaEditor,
      };
      if (showSchemaEditor) {
        model.closeSchemaEditor();
      }
      setSidebarPanel(null);
      return;
    }

    const previousState = lastSidebarStateRef.current;
    const preferredPanel = previousState?.panel ?? 'diagrams';
    setSidebarPanel(preferredPanel);
    if (previousState?.showSchemaEditor) {
      model.openSchemaEditor();
      setSidebarPanel('schemas');
    }
  }, [model, showSchemaEditor, sidebarPanel]);

  const setSidebarWidthForMode = useCallback(
    (nextWidth: number, showSchemaEditor: boolean) => {
      const clamped = clampSidebarWidth(
        nextWidth,
        showSchemaEditor,
        getSidebarViewportWidth(getViewportWidth(), layoutShowInspector),
      );
      if (showSchemaEditor) {
        setEditorSidebarWidth(clamped);
        return;
      }
      setCompactSidebarWidth(clamped);
    },
    [layoutShowInspector],
  );

  const finishSidebarResize = useCallback(() => {
    sidebarDragRef.current = null;
    setIsResizingSidebar(false);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  const handleSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      sidebarDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: resolvedSidebarWidth,
        showSchemaEditor,
      };
      setIsResizingSidebar(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (typeof document !== 'undefined') {
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }
    },
    [resolvedSidebarWidth, showSchemaEditor],
  );

  const handleSidebarResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = sidebarDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setSidebarWidthForMode(drag.startWidth + event.clientX - drag.startX, drag.showSchemaEditor);
    },
    [setSidebarWidthForMode],
  );

  const handleSidebarResizeEnd = useCallback(
    (event?: ReactPointerEvent<HTMLDivElement>) => {
      if (event) {
        const drag = sidebarDragRef.current;
        if (
          drag &&
          drag.pointerId === event.pointerId &&
          event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }
      finishSidebarResize();
    },
    [finishSidebarResize],
  );

  const handleSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = event.shiftKey ? SIDEBAR_KEYBOARD_STEP * 2 : SIDEBAR_KEYBOARD_STEP;
      const delta = event.key === 'ArrowLeft' ? -step : step;
      setSidebarWidthForMode(resolvedSidebarWidth + delta, showSchemaEditor);
    },
    [resolvedSidebarWidth, setSidebarWidthForMode, showSchemaEditor],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        toggleSidebar('palette');
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        toggleSidebarVisibility();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleSidebar, toggleSidebarVisibility]);

  useEffect(() => {
    const handleResize = () => {
      const availableWidth = getSidebarViewportWidth(getViewportWidth(), layoutShowInspector);
      setCompactSidebarWidth((previous) => clampSidebarWidth(previous, false, availableWidth));
      setEditorSidebarWidth((previous) => clampSidebarWidth(previous, true, availableWidth));
    };

    handleResize();
    if (typeof window === 'undefined') return undefined;

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [layoutShowInspector]);

  useEffect(() => {
    if (!sidebarPanel) {
      finishSidebarResize();
    }
  }, [finishSidebarResize, sidebarPanel]);

  useEffect(() => finishSidebarResize, [finishSidebarResize]);

  const handleOpenDiagramStream = useCallback(
    (streamId: string) => {
      setDiagramBrowserNotice(undefined);
      model.editorPanelProps.onOpenDiagramStream?.(streamId);
    },
    [model.editorPanelProps],
  );

  const handleRestoreDiagramRevision = useCallback(
    (revisionId: string) => {
      setDiagramBrowserNotice(undefined);
      model.editorPanelProps.onRestoreDiagramRevision?.(revisionId);
    },
    [model.editorPanelProps],
  );

  const handleStartNewDiagram = useCallback(() => {
    setDiagramBrowserNotice(undefined);
    model.topBarProps.onStartNewDiagram?.();
  }, [model.topBarProps]);

  const handleStartNewSchemaDraft = useCallback(() => {
    model.editorPanelProps.onStartNewSchemaDraft?.();
  }, [model.editorPanelProps]);

  const handleEditSchemaStream = useCallback(
    (schemaRef: string) => {
      model.editorPanelProps.onEditSchemaStream(schemaRef);
    },
    [model.editorPanelProps],
  );

  const handleImportDiagram = useCallback(
    async (file: File) => {
      setDiagramBrowserNotice(undefined);
      const imported = await model.topBarProps.onImport?.(file);
      if (imported && imported.ok === false) {
        setDiagramBrowserNotice(formatDiagramImportFailureNotice(file.name, imported.noticeLines));
      }
    },
    [model.topBarProps],
  );

  const handleExportDiagram = useCallback(() => {
    setDiagramBrowserNotice(undefined);
    model.topBarProps.onExport?.();
  }, [model.topBarProps]);

  const handleLoadExampleDiagram = useCallback(
    async (entry: { namespace: string; slug: string; title?: string }) => {
      const exampleKey = buildExampleDiagramKey(entry);
      setLoadingExampleDiagramKey(exampleKey);
      setDiagramBrowserNotice(undefined);
      try {
        const response = await getGalleryDiagram(entry.namespace, entry.slug);
        if (response.status !== 200) {
          setDiagramBrowserNotice(
            `Failed to open ${entry.title ?? entry.slug} (${response.status}).`,
          );
          return;
        }
        const raw = response.data.raw?.trim();
        if (!raw) {
          setDiagramBrowserNotice(
            `Example ${entry.title ?? entry.slug} does not have any diagram YAML.`,
          );
          return;
        }
        const imported = model.importDiagramText(raw, {
          fallbackName: entry.title ?? entry.slug,
          sourceLabel: `${entry.namespace}/${entry.slug}`,
          successMessage: `Opened ${entry.title ?? entry.slug} as a normal editable diagram.`,
        });
        if (imported.ok === false) {
          setDiagramBrowserNotice(
            formatDiagramImportFailureNotice(entry.title ?? entry.slug, imported.noticeLines),
          );
          return;
        }
        setDiagramBrowserNotice(`Opened ${entry.title ?? entry.slug} as an editable diagram.`);
      } catch {
        setDiagramBrowserNotice(`Failed to open ${entry.title ?? entry.slug}.`);
      } finally {
        setLoadingExampleDiagramKey(undefined);
      }
    },
    [model],
  );

  const workspaceBannerProps = model.workspaceBannerProps;
  const workspaceBannerQuietAction:
    | {
        label: string;
        onClick: () => void;
      }
    | undefined =
    workspaceBannerProps && 'quietAction' in workspaceBannerProps
      ? (workspaceBannerProps.quietAction as { label: string; onClick: () => void } | undefined)
      : undefined;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* App Header */}
      <AppHeader
        diagramName={model.topBarProps.diagramName}
        onDiagramNameChange={model.topBarProps.onDiagramNameChange}
        diagramNameReadOnly={Boolean(model.topBarProps.diagramNameReadOnly)}
        diagramStatusLabel={model.topBarProps.diagramStatusLabel}
        onRevertDiagramName={model.topBarProps.onRevertDiagramName}
        accountEmail={session.mode === 'authenticated' ? session.member.email : undefined}
        accountDisplayName={
          session.mode === 'authenticated' ? session.member.displayName : undefined
        }
        accountProfilePictureUrl={
          session.mode === 'authenticated' ? session.member.profilePictureUrl : undefined
        }
        onSignIn={session.mode === 'guest' ? () => navigateToAuthPath('/auth/login') : undefined}
        onSignUp={session.mode === 'guest' ? () => navigateToAuthPath('/auth/signup') : undefined}
        onSignOut={
          session.mode === 'authenticated' ? () => submitAuthPost('/auth/logout') : undefined
        }
        showBottomBorder={!workspaceBannerProps}
        onUndo={model.diagramToolbarProps.onUndo}
        onRedo={model.diagramToolbarProps.onRedo}
        canUndo={model.diagramToolbarProps.canUndo}
        canRedo={model.diagramToolbarProps.canRedo}
        searchQuery={model.diagramToolbarProps.searchQuery}
        onSearchQueryChange={model.diagramToolbarProps.onSearchQueryChange}
        onClearSearch={model.diagramToolbarProps.onClearSearch}
        searchTotalMatches={model.diagramToolbarProps.searchTotalMatches}
        searchHiddenMatches={model.diagramToolbarProps.searchHiddenMatches}
        onRevealSearchResults={model.diagramToolbarProps.onRevealSearchResults}
      />

      {workspaceBannerProps ? (
        <div
          className={`border-b px-4 py-1 text-xs ${
            workspaceBannerProps.tone === 'warning'
              ? 'border-amber-600/25 bg-amber-500/8 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
              : workspaceBannerProps.tone === 'success'
                ? 'border-emerald-600/25 bg-emerald-500/8 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-amber-600/25 bg-amber-500/8 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{workspaceBannerProps.message}</span>
            <div className="flex flex-wrap items-center gap-2">
              {workspaceBannerProps.actions?.map((action) => (
                <button
                  key={action.label}
                  className={
                    action.emphasis === 'strong'
                      ? 'rounded-full border border-current/20 bg-current/10 px-2.5 py-0.5 text-xs font-semibold hover:bg-current/15'
                      : 'rounded-full border border-current/20 px-2.5 py-0.5 text-xs font-medium hover:bg-current/10'
                  }
                  onClick={action.onClick}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
              {workspaceBannerQuietAction ? (
                <button
                  className="px-1 text-xs text-current/60 underline-offset-2 hover:text-current hover:underline"
                  onClick={workspaceBannerQuietAction.onClick}
                  type="button"
                >
                  {workspaceBannerQuietAction.label}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Main workspace */}
      <div className="flex flex-1 min-h-0">
        {/* Activity Bar */}
        <ActivityBar
          activePanel={sidebarPanel}
          onTogglePanel={toggleSidebar}
          isSidebarVisible={isSidebarVisible}
          onToggleSidebarVisibility={toggleSidebarVisibility}
        />

        <div className="flex flex-1 min-w-0 min-h-0">
          <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
            {/* Left sidebar */}
            {sidebarPanel && (
              <div
                className="absolute bottom-0 left-0 z-40"
                style={{
                  top: 0,
                  width: resolvedSidebarWidth + SIDEBAR_RESIZE_HANDLE_WIDTH,
                }}
              >
                <aside
                  className="h-full border-r border-border bg-surface flex flex-col min-h-0 overflow-hidden"
                  style={{
                    width: resolvedSidebarWidth,
                    minWidth: sidebarBounds.min,
                    maxWidth: sidebarBounds.max,
                  }}
                >
                  {showSchemaEditor ? (
                    <div className="flex-1 min-h-0 p-3 overflow-hidden">
                      <Suspense
                        fallback={<SidebarLoader label="schema editor" title="Schema Editor" />}
                      >
                        <LazyEditorPanel {...model.editorPanelProps} />
                      </Suspense>
                    </div>
                  ) : (
                    <>
                      {sidebarPanel === 'palette' && <Palette {...model.paletteProps} />}
                      {sidebarPanel === 'diagrams' && (
                        <Suspense fallback={<SidebarLoader label="diagrams" title="Diagrams" />}>
                          <LazyDiagramBrowser
                            streams={model.editorPanelProps.documentManagerStreams ?? []}
                            exampleDiagrams={exampleDiagrams}
                            loadingExampleKey={loadingExampleDiagramKey}
                            notice={diagramBrowserNotice}
                            onOpenStream={handleOpenDiagramStream}
                            onRestoreRevision={handleRestoreDiagramRevision}
                            onStartNew={handleStartNewDiagram}
                            onImportDiagram={handleImportDiagram}
                            onExportDiagram={handleExportDiagram}
                            onLoadExampleDiagram={handleLoadExampleDiagram}
                          />
                        </Suspense>
                      )}
                      {sidebarPanel === 'gallery' && (
                        <Suspense
                          fallback={
                            <SidebarLoader label="diagram gallery" title="Diagram Gallery" />
                          }
                        >
                          <LazyGalleryBrowser
                            exampleDiagrams={exampleDiagrams}
                            loadingExampleKey={loadingExampleDiagramKey}
                            notice={diagramBrowserNotice}
                            onLoadExampleDiagram={handleLoadExampleDiagram}
                          />
                        </Suspense>
                      )}
                      {sidebarPanel === 'schemas' && (
                        <Suspense fallback={<SidebarLoader label="schemas" title="Schemas" />}>
                          <LazySchemaBrowser
                            streams={model.editorPanelProps.schemaManagerStreams}
                            notice={model.editorPanelProps.schemaManagerNotice}
                            onEditStream={handleEditSchemaStream}
                            onDeleteStream={model.editorPanelProps.onDeleteSchemaStream}
                            onUndoDelete={model.editorPanelProps.onUndoDeleteSchemaStream}
                            onStartNew={handleStartNewSchemaDraft}
                          />
                        </Suspense>
                      )}
                      {sidebarPanel === 'settings' && (
                        <SettingsPanel
                          nodeVisualMode={model.settingsPanelProps.nodeVisualMode}
                          onNodeVisualModeChange={model.settingsPanelProps.onNodeVisualModeChange}
                        />
                      )}
                    </>
                  )}
                </aside>
                {/* biome-ignore lint/a11y/useSemanticElements: This separator is intentionally interactive for drag and keyboard resizing. */}
                <div
                  role="separator"
                  aria-label="Resize sidebar"
                  aria-orientation="vertical"
                  aria-valuemin={sidebarBounds.min}
                  aria-valuemax={sidebarBounds.max}
                  aria-valuenow={Math.round(resolvedSidebarWidth)}
                  tabIndex={0}
                  className={`group absolute inset-y-0 cursor-col-resize transition-colors focus:outline-none ${
                    isResizingSidebar
                      ? 'bg-accent/25'
                      : 'hover:bg-surface-hover focus:bg-surface-hover'
                  }`}
                  style={{
                    left: resolvedSidebarWidth,
                    width: SIDEBAR_RESIZE_HANDLE_WIDTH,
                    touchAction: 'none',
                  }}
                  onPointerDown={handleSidebarResizeStart}
                  onPointerMove={handleSidebarResizeMove}
                  onPointerUp={handleSidebarResizeEnd}
                  onPointerCancel={handleSidebarResizeEnd}
                  onLostPointerCapture={() => finishSidebarResize()}
                  onKeyDown={handleSidebarResizeKeyDown}
                >
                  <div
                    className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
                      isResizingSidebar
                        ? 'bg-accent/80'
                        : 'bg-border group-hover:bg-accent/35 group-focus:bg-accent/35'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Canvas */}
            <div className="relative flex h-full flex-1 min-h-0">
              <div className="h-full flex-1 min-w-0 min-h-0">
                <WorkspaceDiagramPane
                  ref={model.workspaceDiagramRuntimeRef}
                  model={model.workspaceDiagramModel}
                  leftOcclusion={canvasLeftOcclusion}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
