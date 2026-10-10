import {
  parseSavedDiagramView,
  type SavedDiagramView,
  serializeSavedDiagramView,
} from '@tarskia/diagram-semantics';

export const MAX_SHARED_VIEW_LENGTH = 8000;
export const MAX_SHARED_VIEW_BYTES = 64 * 1024;

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Shared view exceeds size limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function encodeSharedView(saved: SavedDiagramView): Promise<string> {
  // Missing expansion flags already mean collapsed; preserve explicit highlight flags.
  // Group related prefixes, with a bare prefix after its descendants, for denser deflate output.
  const nodesById = Object.fromEntries(
    Object.entries(saved.view.nodesById ?? {})
      .sort(([a], [b]) => `${a}~`.localeCompare(`${b}~`))
      .flatMap(([id, flags]) => {
        const state = {
          ...(flags.expanded ? { expanded: true } : {}),
          ...(flags.highlighted !== undefined ? { highlighted: flags.highlighted } : {}),
        };
        return Object.keys(state).length ? [[id, state]] : [];
      }),
  );
  const validated = serializeSavedDiagramView({ ...saved, view: { ...saved.view, nodesById } });
  if (!validated.ok) throw new Error('Invalid shared view');
  const { diagram: _diagram, ...record } = JSON.parse(validated.value);
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (bytes.length > MAX_SHARED_VIEW_BYTES) throw new Error('Shared view exceeds size limit');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = await readBounded(stream, MAX_SHARED_VIEW_LENGTH);
  const encoded = btoa(String.fromCharCode(...compressed))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (encoded.length > MAX_SHARED_VIEW_LENGTH) throw new Error('Shared view exceeds size limit');
  return encoded;
}

export async function decodeSharedView(
  encoded: string,
  diagram: SavedDiagramView['diagram'],
): Promise<SavedDiagramView> {
  if (!encoded || encoded.length > MAX_SHARED_VIEW_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error('Invalid shared view encoding');
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const decoded = await readBounded(stream, MAX_SHARED_VIEW_BYTES);
  const record: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
  if (!record || typeof record !== 'object' || Array.isArray(record) || 'diagram' in record)
    throw new Error('Invalid shared view record');
  const parsed = parseSavedDiagramView({ ...record, diagram });
  if (!parsed.ok) throw new Error('Invalid shared view record');
  return parsed.value;
}

export async function createSharedViewUrl(
  saved: SavedDiagramView,
  currentUrl: string,
): Promise<string> {
  const url = new URL(currentUrl);
  url.pathname = `/gallery/${encodeURIComponent(saved.diagram.namespace)}/${encodeURIComponent(saved.diagram.slug)}`;
  url.hash = '';
  url.searchParams.set('view', await encodeSharedView(saved));
  return url.toString();
}
