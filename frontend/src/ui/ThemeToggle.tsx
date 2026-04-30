import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { type ThemePreference, useTheme } from './useTheme';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const ActiveIcon = (OPTIONS.find((option) => option.value === theme) ?? OPTIONS[0]).Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          title="Theme"
        >
          <ActiveIcon size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = theme === value;
          return (
            <DropdownMenuItem
              key={value}
              onSelect={() => setTheme(value)}
              className={`flex items-center justify-between gap-3 ${
                active ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Icon size={13} aria-hidden="true" />
                {label}
              </span>
              {active ? <Check size={13} aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
