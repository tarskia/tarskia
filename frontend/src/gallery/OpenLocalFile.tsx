import { FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { type LocalDiagram, openLocalDiagram } from './local-diagram';

import {
  type DirectoryHandle,
  directoryFromEntry,
  directoryFromHandle,
  type LocalDirectory,
  openRepoFolder,
} from './local-folder';

export function useLocalFileOpening(setLocalDiagram?: (diagram: LocalDiagram) => void) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const attempt = useRef(0);
  const open = useCallback(
    async (load: () => Promise<LocalDiagram>) => {
      const current = ++attempt.current;
      setError(undefined);
      try {
        const diagram = await load();
        if (current !== attempt.current) return;
        setLocalDiagram?.(diagram);
        navigate('/gallery/open');
      } catch (error) {
        if (
          current === attempt.current &&
          !(error instanceof DOMException && error.name === 'AbortError')
        )
          setError(error instanceof Error ? error.message : 'Unable to open files.');
      }
    },
    [navigate, setLocalDiagram],
  );
  const openFiles = useCallback((files: File[]) => open(() => openLocalDiagram(files)), [open]);
  const openFolder = useCallback(
    (directory: LocalDirectory) => open(() => openRepoFolder(directory)),
    [open],
  );
  const pickFolder = useCallback(
    () =>
      open(async () => {
        const picker = (
          window as unknown as { showDirectoryPicker: () => Promise<DirectoryHandle> }
        ).showDirectoryPicker;
        return openRepoFolder(directoryFromHandle(await picker.call(window)));
      }),
    [open],
  );
  useEffect(() => {
    let depth = 0;
    const files = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (files(event)) {
        event.preventDefault();
        depth++;
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (files(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }
    };
    const leave = (event: DragEvent) => {
      if (files(event)) {
        depth = Math.max(0, depth - 1);
        if (!depth) setDragging(false);
      }
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const entries = Array.from(event.dataTransfer?.items ?? []).map((item) =>
        item.webkitGetAsEntry?.(),
      );
      const folder = entries.find((entry) => entry?.isDirectory);
      if (folder) void openFolder(directoryFromEntry(folder as FileSystemDirectoryEntry));
      else void openFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      attempt.current++;
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFiles, openFolder]);
  return { open: openFiles, pickFolder, error, dragging };
}
export function OpenLocalFileButton({ open }: { open: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        title="Open a diagram you built, with its schema file if it has one. Nothing is uploaded."
        onClick={() => input.current?.click()}
      >
        <FolderOpen aria-hidden="true" className="h-4 w-4" />
        Open file
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".yaml,.yml"
        hidden
        aria-label="Open diagram files"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) void open(files);
        }}
      />
    </>
  );
}

export function OpenLocalFolderButton({ open }: { open: () => Promise<void> }) {
  if (
    typeof window === 'undefined' ||
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !==
      'function'
  )
    return null;
  return (
    <Button
      variant="outline"
      size="sm"
      title="Open a repo folder, or a folder of repos, to see their Tarskia diagrams together. Nothing is uploaded."
      onClick={() => void open()}
    >
      Open folder
    </Button>
  );
}
