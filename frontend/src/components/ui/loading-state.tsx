import { LoaderCircle } from 'lucide-react';

import { cn } from '../../lib/utils';

interface LoadingStateProps {
  label: string;
  hint?: string;
  className?: string;
  panelClassName?: string;
  fullscreen?: boolean;
}

export function LoadingState({
  label,
  hint,
  className,
  panelClassName,
  fullscreen = false,
}: LoadingStateProps) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'flex items-center justify-center text-foreground',
        fullscreen ? 'h-screen bg-background' : 'h-full w-full',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-[220px] items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 shadow-[var(--shadow-panel)]',
          panelClassName,
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{label}</div>
          {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      </div>
    </div>
  );
}
