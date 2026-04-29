/**
 * Animator
 * - Stateless interpolation from a timed transition plan + progress (0..1).
 * - Produces concrete positions and visibility for the current frame.
 * - Does not decide timings; it only applies the plan.
 */
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export interface ZoomAnimationResult {
  positions: Record<string, { x: number; y: number }>;
  nodeVisibility: Map<string, number>;
  childVisibilityByParent: Map<string, number>;
  edgeVisibility: Map<string, number>;
}

export function computeZoomAnimation(params: {
  progress: number;
  plan: {
    basePositions: Record<string, { x: number; y: number }>;
    targetPositions: Record<string, { x: number; y: number }>;
    nodeTimings: Map<
      string,
      {
        moveX?: { start: number; end: number };
        moveY?: { start: number; end: number };
        fade?: { start: number; end: number };
        fadeMode?: 'in' | 'out';
      }
    >;
    childFadeByParent: Map<string, { window: { start: number; end: number }; mode: 'in' | 'out' }>;
    edgePlans?: Array<{
      id: string;
      hideAtStart?: boolean;
      fade?: { start: number; end: number };
      fadeMode?: 'in' | 'out';
    }>;
  };
}): ZoomAnimationResult {
  const { progress, plan } = params;
  const { basePositions, targetPositions, nodeTimings, childFadeByParent } = plan;

  const finalPositions: Record<string, { x: number; y: number }> = {
    ...basePositions,
    ...targetPositions,
  };
  const ids = new Set<string>([...Object.keys(basePositions), ...Object.keys(targetPositions)]);
  for (const id of ids) {
    const base = basePositions[id] ?? targetPositions[id] ?? { x: 0, y: 0 };
    const target = targetPositions[id] ?? base;
    const timing = nodeTimings.get(id);
    const moveX = timing?.moveX
      ? clamp((progress - timing.moveX.start) / (timing.moveX.end - timing.moveX.start), 0, 1)
      : base.x === target.x
        ? 1
        : progress;
    const moveY = timing?.moveY
      ? clamp((progress - timing.moveY.start) / (timing.moveY.end - timing.moveY.start), 0, 1)
      : base.y === target.y
        ? 1
        : progress;
    finalPositions[id] = {
      x: lerp(base.x, target.x, moveX),
      y: lerp(base.y, target.y, moveY),
    };
  }

  const nodeVisibility = new Map<string, number>();
  for (const [id, timing] of nodeTimings.entries()) {
    if (!timing.fade) continue;
    const fade = clamp(
      (progress - timing.fade.start) / (timing.fade.end - timing.fade.start),
      0,
      1,
    );
    const opacity = timing.fadeMode === 'out' ? 1 - fade : fade;
    nodeVisibility.set(id, opacity);
  }

  const childVisibilityByParent = new Map<string, number>();
  for (const [parentId, timing] of childFadeByParent.entries()) {
    const fade = clamp(
      (progress - timing.window.start) / (timing.window.end - timing.window.start),
      0,
      1,
    );
    const opacity = timing.mode === 'out' ? 1 - fade : fade;
    childVisibilityByParent.set(parentId, opacity);
  }

  const edgeVisibility = new Map<string, number>();
  for (const edge of plan.edgePlans ?? []) {
    if (edge.hideAtStart) {
      edgeVisibility.set(edge.id, 0);
      continue;
    }
    if (!edge.fade) continue;
    const fade = clamp((progress - edge.fade.start) / (edge.fade.end - edge.fade.start), 0, 1);
    const opacity = edge.fadeMode === 'out' ? 1 - fade : fade;
    edgeVisibility.set(edge.id, opacity);
  }

  return { positions: finalPositions, nodeVisibility, childVisibilityByParent, edgeVisibility };
}
