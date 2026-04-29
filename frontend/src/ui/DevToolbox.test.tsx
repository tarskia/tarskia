import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnimationSettings } from '../diagram/animation-settings';
import { DevToolbox } from './DevToolbox';

const defaultSettings: AnimationSettings = {
  timelineMs: {
    right: 220,
    width: 220,
    down: 220,
    height: 220,
    children: 180,
    pause: 80,
  },
  fadeInMultiplier: 1,
  transitionSpeedMultiplier: 1,
  viewport: {
    padding: 48,
    collapsePadding: 24,
    cameraDuration: 260,
    fitDuration: 260,
  },
};

describe('DevToolbox', () => {
  it('renders all node visual mode options', () => {
    const html = renderToStaticMarkup(
      <DevToolbox
        settings={defaultSettings}
        onChange={vi.fn()}
        onReset={vi.fn()}
        skipTransitions={false}
        onToggleTransitions={vi.fn()}
        showDebug={false}
        onToggleDebug={vi.fn()}
        nodeVisualMode="outline"
        onNodeVisualModeChange={vi.fn()}
      />,
    );

    expect(html).toContain('Node visuals');
    expect(html).toContain('Default');
    expect(html).toContain('Outline only');
    expect(html).toContain('Blueprint');
  });

  it('hides the worker reload button when unavailable', () => {
    const html = renderToStaticMarkup(
      <DevToolbox
        settings={defaultSettings}
        onChange={vi.fn()}
        onReset={vi.fn()}
        skipTransitions={false}
        onToggleTransitions={vi.fn()}
        showDebug={false}
        onToggleDebug={vi.fn()}
        nodeVisualMode="default"
        onNodeVisualModeChange={vi.fn()}
      />,
    );

    expect(html).not.toContain('Reload latest worker diagram');
  });

  it('renders the worker reload button in dev mode', () => {
    const html = renderToStaticMarkup(
      <DevToolbox
        settings={defaultSettings}
        onChange={vi.fn()}
        onReset={vi.fn()}
        skipTransitions={false}
        onToggleTransitions={vi.fn()}
        showDebug={false}
        onToggleDebug={vi.fn()}
        nodeVisualMode="default"
        onNodeVisualModeChange={vi.fn()}
        canReloadWorkerDiagram
        isReloadingWorkerDiagram
        onReloadWorkerDiagram={vi.fn()}
      />,
    );

    expect(html).toContain('Reloading worker diagram...');
  });
});
