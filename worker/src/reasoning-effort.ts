import type { ModelReasoningEffort } from '@openai/codex-sdk';

export type ReasoningEffort = ModelReasoningEffort;

// Exhaustive so an SDK upgrade cannot silently leave new efforts unavailable.
const reasoningEfforts: Record<ModelReasoningEffort, true> = {
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  ultra: true,
  persistent: true,
};

export const REASONING_EFFORTS = Object.keys(reasoningEfforts) as ReasoningEffort[];

export function resolveReasoningEffort(value?: string): ReasoningEffort {
  if (value === undefined) return 'medium';
  const normalized = value.trim();
  if (REASONING_EFFORTS.some((effort) => effort === normalized)) {
    return normalized as ReasoningEffort;
  }
  throw new Error(
    `Invalid reasoning effort '${value}'. Expected one of: ${REASONING_EFFORTS.join(', ')}.`,
  );
}
