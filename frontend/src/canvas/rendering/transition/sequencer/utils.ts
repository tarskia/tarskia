import type { LayoutTree } from '../../layout/tree-traverser';
import { ANIMATION_CONSTANTS, type AnimationSettings } from '../animation-constants';

export const DEFAULT_TIMELINE_MS = ANIMATION_CONSTANTS.timelineMs;

export const toAbsolutePositions = (tree: LayoutTree) => {
  const positions: Record<string, { x: number; y: number }> = {};
  const queue: Array<{ node: typeof tree.root; abs: { x: number; y: number } }> = [];
  for (const child of tree.root.children) {
    const pos = child.position ?? { x: 0, y: 0 };
    positions[child.id] = pos;
    queue.push({ node: child, abs: pos });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { node, abs } = current;
    for (const child of node.children) {
      const rel = child.position ?? { x: 0, y: 0 };
      const next = { x: abs.x + rel.x, y: abs.y + rel.y };
      positions[child.id] = next;
      queue.push({ node: child, abs: next });
    }
  }
  return positions;
};

export const buildDepthMap = (tree: LayoutTree) => {
  const depths = new Map<string, number>();
  const queue: Array<{ node: typeof tree.root; depth: number }> = [];
  for (const child of tree.root.children) {
    queue.push({ node: child, depth: 0 });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { node, depth } = current;
    depths.set(node.id, depth);
    for (const child of node.children) {
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return depths;
};

export const buildSegmentOrder = (direction: 'in' | 'out') => {
  if (direction === 'out') {
    // Collapse: fade contents, shrink containers, then move dependents into
    // the vacated space. Doing move-before-resize causes temporary overlap.
    return ['fade', 'shrink', 'move', 'grow'] as const;
  }
  return ['shrink', 'move', 'grow', 'fade'] as const;
};

export const getInterSegmentPause = (
  direction: 'in' | 'out',
  timelineMs: AnimationSettings['timelineMs'] = DEFAULT_TIMELINE_MS,
) => (direction === 'in' ? 0 : timelineMs.pause);

export const durationForSegment = (
  segment: string,
  direction: 'in' | 'out',
  fadeIn: number,
  timelineMs: AnimationSettings['timelineMs'] = DEFAULT_TIMELINE_MS,
) => {
  switch (segment) {
    case 'move':
      return Math.max(timelineMs.right, timelineMs.down);
    case 'shrink':
    case 'grow':
      return Math.max(timelineMs.width, timelineMs.height);
    case 'fade':
      return direction === 'in' ? timelineMs.children * fadeIn : timelineMs.children;
    default:
      return 0;
  }
};

export const buildSegmentWindows = (
  direction: 'in' | 'out',
  depthIndex: number,
  depthDuration: number,
  totalDuration: number,
  fadeIn: number,
  timelineMs: AnimationSettings['timelineMs'] = DEFAULT_TIMELINE_MS,
): Record<string, { start: number; end: number }> => {
  const sequence = buildSegmentOrder(direction);
  const interSegmentPause = getInterSegmentPause(direction, timelineMs);
  const baseOffset = depthIndex * depthDuration;
  let cursor = baseOffset;
  const windows: Record<string, { start: number; end: number }> = {};
  sequence.forEach((segment, index) => {
    const duration = durationForSegment(segment, direction, fadeIn, timelineMs);
    const start = cursor;
    const end = cursor + duration;
    windows[segment] = {
      start: start / totalDuration,
      end: end / totalDuration,
    };
    cursor = end;
    if (index < sequence.length - 1) {
      cursor += interSegmentPause;
    }
  });
  return windows;
};
