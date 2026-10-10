import type { NodeRefinementTask } from './types';

type EdgeTask = Pick<NodeRefinementTask, 'inboundEdges' | 'outboundEdges'>;

export function buildNodeRefinementEdgeHandles(task: EdgeTask): Record<string, string> {
  return Object.fromEntries([
    ...task.inboundEdges.map((edge, index) => [`in-${index + 1}`, edge.id]),
    ...task.outboundEdges.map((edge, index) => [`out-${index + 1}`, edge.id]),
  ]);
}

export function taskWithEdgeHandles(task: NodeRefinementTask): NodeRefinementTask {
  return {
    ...task,
    inboundEdges: task.inboundEdges.map((edge, index) => ({ ...edge, id: `in-${index + 1}` })),
    outboundEdges: task.outboundEdges.map((edge, index) => ({ ...edge, id: `out-${index + 1}` })),
  };
}

// Translate IDs in diagnostic prose, nested details, and previous results in one pass.
export function formatWithEdgeHandles(value: unknown, task: EdgeTask): string {
  const handlesById = new Map<string, string>();
  for (const [handle, id] of Object.entries(buildNodeRefinementEdgeHandles(task))) {
    if (!handlesById.has(id)) handlesById.set(id, handle);
  }
  if (handlesById.size === 0) return JSON.stringify(value, null, 2);
  const pattern = [...handlesById.keys()]
    .sort((left, right) => right.length - left.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // IDs may include path/punctuation separators; do not rewrite a substring of another ID.
  const references = new RegExp(
    `(?<![\\p{L}\\p{N}_./:@%-])(?:${pattern})(?![\\p{L}\\p{N}_./:@%-])`,
    'gu',
  );
  const translate = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return handlesById.get(item) ?? item.replace(references, (id) => handlesById.get(id)!);
    }
    if (Array.isArray(item)) return item.map(translate);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [key, translate(entry)]),
      );
    }
    return item;
  };
  return JSON.stringify(translate(value), null, 2);
}
