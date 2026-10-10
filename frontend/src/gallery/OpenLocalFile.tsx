import { FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '../components/ui/button';
import type { PublicGalleryShellContext } from '../PublicGalleryShell';
import { openLocalDiagram } from './local-diagram';

export function useLocalFileOpening() {
  const { setLocalDiagram } = useOutletContext<PublicGalleryShellContext>() ?? {};
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const attempt = useRef(0);
  const open = useCallback(
    async (files: File[]) => {
      const current = ++attempt.current;
      setError(undefined);
      try {
        const diagram = await openLocalDiagram(files);
        if (current !== attempt.current) return;
        setLocalDiagram?.(diagram);
        navigate('/gallery/open');
      } catch (error) {
        if (current === attempt.current)
          setError(error instanceof Error ? error.message : 'Unable to open files.');
      }
    },
    [navigate, setLocalDiagram],
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
      void open(Array.from(event.dataTransfer?.files ?? []));
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
  }, [open]);
  return { open, error, dragging };
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
