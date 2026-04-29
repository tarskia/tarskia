import { useId } from 'react';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import type { AnimationSettings } from '../diagram/animation-settings';
import {
  getNodeVisualModeOption,
  NODE_VISUAL_MODE_OPTIONS,
  type NodeVisualMode,
} from '../node-visual-mode';
import { SidebarPanelFrame } from './SidebarPanelFrame';

type DevToolboxProps = {
  settings: AnimationSettings;
  onChange: (next: AnimationSettings) => void;
  onReset: () => void;
  skipTransitions: boolean;
  onToggleTransitions: () => void;
  showDebug: boolean;
  onToggleDebug: () => void;
  nodeVisualMode: NodeVisualMode;
  onNodeVisualModeChange: (mode: NodeVisualMode) => void;
  canReloadWorkerDiagram?: boolean;
  isReloadingWorkerDiagram?: boolean;
  onReloadWorkerDiagram?: () => void;
};

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

function SliderControl({ label, value, min, max, step, onChange }: SliderControlProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-foreground/90">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(step >= 1 ? 0 : 2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="w-full accent-accent"
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

export function DevToolbox({
  settings,
  onChange,
  onReset,
  skipTransitions,
  onToggleTransitions,
  showDebug,
  onToggleDebug,
  nodeVisualMode,
  onNodeVisualModeChange,
  canReloadWorkerDiagram = false,
  isReloadingWorkerDiagram = false,
  onReloadWorkerDiagram,
}: DevToolboxProps) {
  const nodeVisualModeSelectId = useId();
  const activeNodeVisualMode = getNodeVisualModeOption(nodeVisualMode);

  const setTimeline = (key: keyof AnimationSettings['timelineMs'], value: number) => {
    onChange({
      ...settings,
      timelineMs: {
        ...settings.timelineMs,
        [key]: value,
      },
    });
  };

  const setViewport = (key: keyof AnimationSettings['viewport'], value: number) => {
    onChange({
      ...settings,
      viewport: {
        ...settings.viewport,
        [key]: value,
      },
    });
  };

  return (
    <SidebarPanelFrame title="Dev Toolbox" contentClassName="px-3 pb-3">
      <div className="flex flex-col gap-3.5">
        {/* Controls section */}
        <Section>
          {canReloadWorkerDiagram && onReloadWorkerDiagram && (
            <Button
              variant="outline"
              onClick={onReloadWorkerDiagram}
              disabled={isReloadingWorkerDiagram}
            >
              {isReloadingWorkerDiagram
                ? 'Reloading worker diagram...'
                : 'Reload latest worker diagram'}
            </Button>
          )}
          <Button variant="outline" onClick={onToggleTransitions}>
            {skipTransitions ? 'Transitions: off' : 'Transitions: on'}
          </Button>
          <Button variant="outline" onClick={onToggleDebug}>
            {showDebug ? 'Debug: on' : 'Debug: off'}
          </Button>
          <label className="flex flex-col gap-1.5" htmlFor={nodeVisualModeSelectId}>
            <div className="flex items-center justify-between text-xs text-foreground/90">
              <span>Node visuals</span>
              <span className="text-muted-foreground">{activeNodeVisualMode.shortLabel}</span>
            </div>
            <Select
              id={nodeVisualModeSelectId}
              value={nodeVisualMode}
              className="bg-background"
              onChange={(event) => onNodeVisualModeChange(event.target.value as NodeVisualMode)}
            >
              {NODE_VISUAL_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="outline" onClick={onReset}>
            Reset animation settings
          </Button>
        </Section>

        {/* Timeline */}
        <Section title="Timeline (ms)">
          <SliderControl
            label="Move right"
            value={settings.timelineMs.right}
            min={80}
            max={800}
            step={5}
            onChange={(v) => setTimeline('right', v)}
          />
          <SliderControl
            label="Resize width"
            value={settings.timelineMs.width}
            min={80}
            max={800}
            step={5}
            onChange={(v) => setTimeline('width', v)}
          />
          <SliderControl
            label="Move down"
            value={settings.timelineMs.down}
            min={80}
            max={800}
            step={5}
            onChange={(v) => setTimeline('down', v)}
          />
          <SliderControl
            label="Resize height"
            value={settings.timelineMs.height}
            min={80}
            max={800}
            step={5}
            onChange={(v) => setTimeline('height', v)}
          />
          <SliderControl
            label="Children fade"
            value={settings.timelineMs.children}
            min={60}
            max={800}
            step={5}
            onChange={(v) => setTimeline('children', v)}
          />
          <SliderControl
            label="Pause"
            value={settings.timelineMs.pause}
            min={0}
            max={600}
            step={5}
            onChange={(v) => setTimeline('pause', v)}
          />
        </Section>

        {/* Multipliers */}
        <Section title="Multipliers">
          <SliderControl
            label="Fade-in duration multiplier"
            value={settings.fadeInMultiplier}
            min={0.2}
            max={2}
            step={0.02}
            onChange={(v) => onChange({ ...settings, fadeInMultiplier: v })}
          />
          <SliderControl
            label="Duration multiplier (higher = slower)"
            value={settings.transitionSpeedMultiplier}
            min={0.2}
            max={2}
            step={0.02}
            onChange={(v) => onChange({ ...settings, transitionSpeedMultiplier: v })}
          />
        </Section>

        {/* Viewport */}
        <Section title="Viewport">
          <SliderControl
            label="Expand padding (px)"
            value={settings.viewport.padding}
            min={0}
            max={240}
            step={2}
            onChange={(v) => setViewport('padding', v)}
          />
          <SliderControl
            label="Collapse padding (px)"
            value={settings.viewport.collapsePadding}
            min={0}
            max={240}
            step={2}
            onChange={(v) => setViewport('collapsePadding', v)}
          />
          <SliderControl
            label="Camera duration (ms)"
            value={settings.viewport.cameraDuration}
            min={0}
            max={2400}
            step={10}
            onChange={(v) => setViewport('cameraDuration', v)}
          />
          <SliderControl
            label="Fit duration (ms)"
            value={settings.viewport.fitDuration}
            min={0}
            max={1200}
            step={10}
            onChange={(v) => setViewport('fitDuration', v)}
          />
        </Section>
      </div>
    </SidebarPanelFrame>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2.5">
      {title && (
        <div className="text-[0.7rem] uppercase tracking-widest text-muted-foreground">{title}</div>
      )}
      {children}
    </div>
  );
}
