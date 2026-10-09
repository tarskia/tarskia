// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { buildBezierEdgeGeometry } from '../../rendering/presentation/geometry';
import { EdgeLabel } from './EdgeLabel';

test.each([
  ['pub', 'sub'],
  ['read', 'read'],
  ['read', undefined],
  [undefined, 'read'],
  [undefined, undefined],
])('both directions remain selectable for %s / %s', (a, b) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  const geometry = buildBezierEdgeGeometry({
    sourceRect: { x: 0, y: 0, width: 100, height: 40 },
    targetRect: { x: 300, y: 0, width: 100, height: 40 },
  });
  const label = [...new Set([a, b].filter(Boolean))].join(' / ');
  act(() =>
    root.render(
      <EdgeLabel
        edge={{
          id: 'merged',
          relationId: 'primary',
          label,
          directionalLabels: [
            { relationId: 'forward', sourceId: 'a', targetId: 'b', label: a },
            { relationId: 'reverse', sourceId: 'b', targetId: 'a', label: b },
          ],
          geometry,
          labelAnchor: geometry.labelAnchor,
          opacity: 1,
          matched: false,
        }}
        onSelect={select}
      />,
    ),
  );
  const buttons = host.querySelectorAll('button');
  expect(buttons).toHaveLength(2);
  expect(Array.from(buttons, (button) => button.dataset.relationId)).toEqual([
    'forward',
    'reverse',
  ]);
  expect(buttons[0].getAttribute('aria-label')).toContain('a → b');
  expect(buttons[1].getAttribute('aria-label')).toContain('b → a');
  act(() => buttons[0].click());
  act(() => buttons[1].click());
  expect(select.mock.calls).toEqual([['forward'], ['reverse']]);
  buttons[0].focus();
  expect(document.activeElement).toBe(buttons[0]);
  buttons[1].focus();
  expect(document.activeElement).toBe(buttons[1]);
  const separator = host.querySelector('.edge-label-separator');
  if (a && b && a !== b) {
    expect(separator?.textContent).toBe(' / ');
    act(() => separator?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(select).toHaveBeenCalledTimes(2);
  } else {
    expect(separator).toBeNull();
    expect(host.querySelector('.edge-label-shared-text')?.textContent).toBe(label || 'set');
  }
  act(() => root.unmount());
  host.remove();
});
