import { type ReactNode, useId } from 'react';
import { Checkbox } from '../components/ui/checkbox';

interface PopoverCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: () => void;
  children: ReactNode;
}

export function PopoverCheckbox({
  checked,
  disabled = false,
  title,
  onChange,
  children,
}: PopoverCheckboxProps) {
  const checkboxId = useId();
  const checkboxClassName = disabled
    ? checked
      ? 'border-accent/35 bg-accent/24 text-accent-foreground/90 shadow-none'
      : 'border-border bg-muted/70 text-transparent shadow-none'
    : undefined;

  return (
    <label
      className={`group flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors ${
        disabled ? 'cursor-not-allowed opacity-72' : 'cursor-pointer hover:bg-surface-hover'
      }`}
      htmlFor={checkboxId}
      title={title}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        className={checkboxClassName}
        onCheckedChange={() => onChange()}
      />
      {children}
    </label>
  );
}
