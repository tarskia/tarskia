import type { CSSProperties } from 'react';

interface CanvasFocusShellOverlayProps {
  shells: Array<{
    id: string;
    depth: number;
    displayName: string;
    typeLabel: string;
    hue?: number;
    isRoot?: boolean;
    frame: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  }>;
  onSelectShell?: (id: string) => void;
}

const formatShellBoundaryLabel = (shell: CanvasFocusShellOverlayProps['shells'][number]): string =>
  shell.displayName === shell.typeLabel
    ? shell.displayName
    : `${shell.displayName}: ${shell.typeLabel}`;

export function CanvasFocusShellOverlay({ shells, onSelectShell }: CanvasFocusShellOverlayProps) {
  if (shells.length === 0) {
    return null;
  }

  return (
    <div className="canvas-focus-shell-overlay">
      {shells.map((shell) => (
        <div
          key={shell.id}
          className={`canvas-focus-shell${shell.isRoot ? ' canvas-focus-shell--root' : ''}`}
          style={
            {
              ['--focus-shell-hue' as string]: String(shell.hue ?? 210),
              left: shell.frame.left,
              top: shell.frame.top,
              right: shell.frame.right,
              bottom: shell.frame.bottom,
            } as CSSProperties
          }
        >
          <button
            type="button"
            className={`canvas-focus-shell-boundary${shell.isRoot ? ' canvas-focus-shell-boundary--root' : ''}`}
            style={{ left: 16 }}
            onClick={() => onSelectShell?.(shell.id)}
          >
            <span className="canvas-focus-shell-boundary-label">
              {formatShellBoundaryLabel(shell)}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
