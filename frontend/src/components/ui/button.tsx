import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-accent-foreground hover:brightness-110 active:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        outline:
          'border border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        accent: 'border border-accent/25 text-accent hover:bg-accent/8 dark:hover:bg-accent/12',
        destructive: 'text-destructive hover:bg-destructive/10',
      },
      size: {
        default: 'px-2.5 py-1.5',
        sm: 'px-2 py-1',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7 rounded-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export type { ButtonProps };
export { Button, buttonVariants };
