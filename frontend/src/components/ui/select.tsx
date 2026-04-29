import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'w-full rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export type { SelectProps };
export { Select };
