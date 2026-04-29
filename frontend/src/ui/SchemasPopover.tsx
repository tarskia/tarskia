import { Database } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import type { SchemaOptionView } from '../shell/view-models';
import { PopoverCheckbox } from './PopoverCheckbox';

interface SchemasPopoverProps {
  availableSchemas: SchemaOptionView[];
  onToggleSchema: (schemaRef: string) => void;
}

export function SchemasPopover({ availableSchemas, onToggleSchema }: SchemasPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="border border-foreground/12 bg-surface text-foreground shadow-[var(--inset-shadow-glow)] hover:border-accent/28 hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-accent/40 data-[state=open]:bg-accent/18 data-[state=open]:text-accent data-[state=open]:shadow-[var(--inset-shadow-glow),var(--shadow-popover)]"
        >
          <Database size={14} />
          Schemas
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="min-w-[360px] max-h-[320px] overflow-auto"
      >
        {availableSchemas.map((schema) => (
          <PopoverCheckbox
            key={schema.id}
            checked={schema.selected}
            disabled={
              schema.disabled || Boolean(schema.blockedReason) || Boolean(schema.inUseReason)
            }
            title={schema.statusTitle || undefined}
            onChange={() => onToggleSchema(schema.id)}
          >
            <span className="flex-1" title={schema.disabledReason}>
              {schema.label}
            </span>
            {schema.ownerLabel && (
              <span className="text-muted-foreground" title={schema.ownerLabel}>
                {schema.ownerLabel}
              </span>
            )}
            {schema.inUseReason && (
              <span
                className="whitespace-nowrap rounded-full border border-warning/35 px-1.5 py-px text-[11px] text-warning"
                title={schema.inUseReason}
              >
                in use
              </span>
            )}
            {schema.version && (
              <span className="whitespace-nowrap text-muted-foreground">v{schema.version}</span>
            )}
          </PopoverCheckbox>
        ))}
      </PopoverContent>
    </Popover>
  );
}
