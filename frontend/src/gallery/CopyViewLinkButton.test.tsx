// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyViewLinkButton } from './CopyViewLinkButton';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([
  true,
  false,
])('copies only on click and resets its feedback after two seconds (success=%s)', async (success) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const writeText = vi.fn();
  if (success) writeText.mockResolvedValue(undefined);
  else writeText.mockRejectedValue(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const createLink = vi
    .fn()
    .mockResolvedValue('https://example.com/gallery/tarskia/n8n?view=encoded');
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<CopyViewLinkButton createLink={createLink} />));
  const button = host.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Copy link to this view');
  expect(createLink).not.toHaveBeenCalled();
  await act(async () => button.click());
  expect(writeText).toHaveBeenCalledWith('https://example.com/gallery/tarskia/n8n?view=encoded');
  expect(button.title).toBe(success ? 'Link copied' : "Couldn't copy the link");
  await act(async () => vi.advanceTimersByTime(1999));
  expect(button.title).not.toBe('Copy link to this view');
  await act(async () => vi.advanceTimersByTime(1));
  expect(button.title).toBe('Copy link to this view');
  await act(async () => root.unmount());
});
