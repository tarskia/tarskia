import { load } from 'js-yaml';
import { expect, it, vi } from 'vitest';
import { getLocalGalleryDiagram } from './local-gallery';

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>();
  return { ...actual, load: vi.fn(actual.load) };
});

it('delivers raw local content even when optional metadata cannot be parsed', async () => {
  vi.mocked(load).mockImplementationOnce(() => {
    throw new Error('Malformed YAML');
  });
  const response = await getLocalGalleryDiagram('tarskia', 'n8n');
  expect(response.status).toBe(200);
  if (response.status === 200) expect(response.data.raw).toContain('browser-editor-shell');
});
