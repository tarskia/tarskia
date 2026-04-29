import { useEffect, useMemo } from 'react';

import type { AnimationSettings } from '../diagram/animation-settings';
import type { NodeVisualMode } from '../node-visual-mode';
import { buildEntityIndex, type SemanticDocument, sanitizeDiagramDoc } from '../semantic';
import type { CommitDoc } from './types';

interface UseShellEffectsArgs {
  animationSettingsStorageKey: string;
  nodeVisualModeStorageKey: string;
  animationSettings: AnimationSettings;
  nodeVisualMode: NodeVisualMode;
  doc: SemanticDocument;
  commitDoc: CommitDoc;
  selectedEntityId?: string;
  selectedEdgeId?: string;
  setSelectedEntity: (id: string | undefined) => void;
  setSelectedEdge: (id: string | undefined) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

export function useShellEffects({
  animationSettingsStorageKey,
  nodeVisualModeStorageKey,
  animationSettings,
  nodeVisualMode,
  doc,
  commitDoc,
  selectedEntityId,
  selectedEdgeId,
  setSelectedEntity,
  setSelectedEdge,
  canUndo,
  canRedo,
  undo,
  redo,
}: UseShellEffectsArgs) {
  useEffect(() => {
    localStorage.setItem(animationSettingsStorageKey, JSON.stringify(animationSettings));
  }, [animationSettings, animationSettingsStorageKey]);

  useEffect(() => {
    localStorage.setItem(nodeVisualModeStorageKey, nodeVisualMode);
  }, [nodeVisualMode, nodeVisualModeStorageKey]);

  const entityIdSet = useMemo(
    () => new Set(buildEntityIndex(doc.entities).byId.keys()),
    [doc.entities],
  );
  const hasDanglingRelations = useMemo(
    () => doc.relations.some((rel) => !entityIdSet.has(rel.from) || !entityIdSet.has(rel.to)),
    [doc.relations, entityIdSet],
  );

  useEffect(() => {
    if (!hasDanglingRelations) return;
    commitDoc((prev) => sanitizeDiagramDoc(prev), { undoable: false });
  }, [commitDoc, hasDanglingRelations]);

  useEffect(() => {
    if (selectedEntityId && !entityIdSet.has(selectedEntityId)) {
      setSelectedEntity(undefined);
    }
  }, [entityIdSet, selectedEntityId, setSelectedEntity]);

  useEffect(() => {
    if (selectedEdgeId && !doc.relations.some((relation) => relation.id === selectedEdgeId)) {
      setSelectedEdge(undefined);
    }
  }, [doc.relations, selectedEdgeId, setSelectedEdge]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'z') return;

      if (event.shiftKey) {
        if (!canRedo) return;
        event.preventDefault();
        redo();
        return;
      }

      if (!canUndo) return;
      event.preventDefault();
      undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canRedo, canUndo, redo, undo]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    const handleGesture = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGesture as EventListener, {
      passive: false,
      capture: true,
    });
    window.addEventListener('gesturechange', handleGesture as EventListener, {
      passive: false,
      capture: true,
    });
    window.addEventListener('gestureend', handleGesture as EventListener, {
      passive: false,
      capture: true,
    });
    return () => {
      window.removeEventListener('wheel', handleWheel as EventListener, true);
      window.removeEventListener('gesturestart', handleGesture as EventListener, true);
      window.removeEventListener('gesturechange', handleGesture as EventListener, true);
      window.removeEventListener('gestureend', handleGesture as EventListener, true);
    };
  }, []);
}
