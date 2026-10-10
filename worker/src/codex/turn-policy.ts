import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReasoningEffort } from '../reasoning-effort';
import type { SemanticDocument } from '../semantic';
import { resolveTurnTimeoutMs } from './run-codex-prompt';

export class TurnBudgetExhaustedError extends Error {
  constructor(readonly turns: number) {
    super(`Stopped after ${turns} turns (--max-turns). Run the same command again to continue.`);
  }
}

export class TurnPolicy {
  turns = 0;
  partialDocument?: SemanticDocument;
  readonly timeoutMs: number;
  constructor(
    readonly maxTurns?: number,
    effort?: ReasoningEffort,
    timeoutMinutes?: number,
  ) {
    if (maxTurns !== undefined && (!Number.isSafeInteger(maxTurns) || maxTurns <= 0))
      throw new Error('maxTurns must be a positive integer');
    if (timeoutMinutes !== undefined && (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 0))
      throw new Error('turnTimeoutMinutes must be a non-negative number');
    this.timeoutMs = resolveTurnTimeoutMs(effort, timeoutMinutes);
  }
  beforeTurn() {
    if (this.maxTurns !== undefined && this.turns >= this.maxTurns)
      throw new TurnBudgetExhaustedError(this.turns);
    this.turns += 1;
  }
}
const context = new AsyncLocalStorage<TurnPolicy>();
export const currentTurnPolicy = () => context.getStore();
export const withTurnPolicy = <T>(policy: TurnPolicy, run: () => Promise<T>) =>
  context.run(policy, run);
export function retainPartialDocument(document: SemanticDocument) {
  const policy = context.getStore();
  if (policy) policy.partialDocument = document;
}
export function findTurnBudgetError(error: unknown): TurnBudgetExhaustedError | undefined {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof TurnBudgetExhaustedError) return error;
    seen.add(error);
    error = error.cause;
  }
}
