import { useId } from 'react';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { NODE_VISUAL_MODE_OPTIONS, type NodeVisualMode } from '../node-visual-mode';
import { SidebarPanelFrame } from './SidebarPanelFrame';

interface SettingsPanelProps {
  nodeVisualMode: NodeVisualMode;
  onNodeVisualModeChange: (mode: NodeVisualMode) => void;
}

export function SettingsPanel({ nodeVisualMode, onNodeVisualModeChange }: SettingsPanelProps) {
  return (
    <SidebarPanelFrame title="Settings" contentClassName="space-y-4 px-3 pb-3">
      <section className="space-y-3">
        <div className="rounded-md border border-border bg-background">
          <div className="border-b border-border px-3 py-2.5">
            <h4 className="text-sm font-medium text-foreground">Canvas display</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              View controls live here so the canvas toolbar can stay focused on navigation.
            </p>
          </div>
          <RadioGroup
            value={nodeVisualMode}
            onValueChange={(value) => onNodeVisualModeChange(value as NodeVisualMode)}
            className="flex flex-col gap-0 p-2"
          >
            {NODE_VISUAL_MODE_OPTIONS.map((option) => (
              <VisualModeOption
                key={option.value}
                label={option.label}
                description={option.description}
                value={option.value}
              />
            ))}
          </RadioGroup>
        </div>
      </section>
    </SidebarPanelFrame>
  );
}

function VisualModeOption({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: NodeVisualMode;
}) {
  const itemId = useId();

  return (
    <label
      htmlFor={itemId}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2.5 py-2 transition-colors hover:bg-surface-hover has-[[data-state=checked]]:border-accent/25 has-[[data-state=checked]]:bg-accent/10"
    >
      <RadioGroupItem id={itemId} value={value} className="mt-0.5" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
