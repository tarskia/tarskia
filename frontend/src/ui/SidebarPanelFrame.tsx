import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

type SidebarPanelFrameProps = {
  title: string;
  actions?: ReactNode;
  headerContent?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function SidebarPanelFrame({
  title,
  actions,
  headerContent,
  children,
  className,
  contentClassName,
}: SidebarPanelFrameProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="pt-0.5 text-[13px] font-semibold text-muted-foreground">{title}</h3>
          {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
        </div>
        {headerContent ? <div className="mt-2">{headerContent}</div> : null}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-3 pb-3', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
