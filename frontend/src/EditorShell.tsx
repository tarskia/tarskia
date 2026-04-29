import { lazy, Suspense, useEffect, useRef } from 'react';

import { LoadingState } from './components/ui/loading-state';
import { useRemoteWorkspace } from './persistence/useRemoteWorkspace';
import { useAppSessionState } from './session/useAppSession';

const LazyApp = lazy(() => import('./App'));

export default function EditorShell() {
  const { session, backendAvailable } = useAppSessionState();
  const remoteWorkspace = useRemoteWorkspace(session.mode === 'authenticated');
  const isWorkspaceLoading =
    session.mode === 'loading' || (session.mode === 'authenticated' && remoteWorkspace.isLoading);
  const hasLoggedBackendUnavailableRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV || backendAvailable || session.mode === 'loading') {
      return;
    }
    if (hasLoggedBackendUnavailableRef.current) {
      return;
    }
    console.warn('Backend unavailable; running in local-only mode.');
    hasLoggedBackendUnavailableRef.current = true;
  }, [backendAvailable, session.mode]);

  if (isWorkspaceLoading) {
    return (
      <LoadingState
        fullscreen
        label="Loading workspace"
        hint="Connecting your diagrams and schemas."
      />
    );
  }

  return (
    <Suspense
      fallback={<LoadingState fullscreen label="Loading editor" hint="Preparing the canvas." />}
    >
      <LazyApp session={session} remoteWorkspace={remoteWorkspace} />
    </Suspense>
  );
}
