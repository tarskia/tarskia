import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=checked]:shadow-[0_0_0_1px_rgba(0,0,0,0.18)]',
        'data-[state=unchecked]:border-foreground/30 data-[state=unchecked]:bg-background/95 data-[state=unchecked]:text-transparent data-[state=unchecked]:shadow-[var(--inset-shadow-glow)]',
        'hover:data-[state=unchecked]:border-foreground/50',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
