import type { GraphifyHints } from '../advanced/graphify-hints';

export const GRAPHIFY_HINTS_GUARDRAIL =
  'Use Graphify hints as repository evidence, not required diagram nodes. Prefer EXTRACTED relations over INFERRED relations. Map code-level nodes into architecture concepts only when they represent runtime boundaries, flow carriers, storage, protocol surfaces, or meaningful shared kernels.';

export function renderGraphifyHintsSection(graphifyHints?: GraphifyHints): string[] {
  if (!graphifyHints) {
    return [];
  }
  return [
    'Graphify deterministic code-structure hints:',
    GRAPHIFY_HINTS_GUARDRAIL,
    '',
    (graphifyHints.summaryMarkdown ?? '').trim() || '- No Graphify summary text available.',
    '',
  ];
}
