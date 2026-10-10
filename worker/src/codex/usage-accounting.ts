import { AsyncLocalStorage } from 'node:async_hooks';
import type { Usage } from '@openai/codex-sdk';
import {
  addTokenUsageTotals,
  emptyTokenUsageTotals,
  type TokenUsageTotals,
  tokenUsageFromSdkUsage,
} from '../token-usage';

export interface UsageAccountingState {
  totals: TokenUsageTotals;
  lastUsageByThread: Record<string, Usage>;
  reportedTurns: number;
}

export const emptyUsageAccountingState = (): UsageAccountingState => ({
  totals: emptyTokenUsageTotals(),
  lastUsageByThread: {},
  reportedTurns: 0,
});

const fields = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
] as const;

/** Codex 0.162 JSONL emits thread totals, despite the SDK's per-turn type comments. */
export function cumulativeUsageDelta(current: Usage, previous?: Usage): Usage {
  return Object.fromEntries(
    fields.map((field) => [field, Math.max(0, (current[field] ?? 0) - (previous?.[field] ?? 0))]),
  ) as Usage;
}

export class UsageAccounting {
  private state: UsageAccountingState;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    initial = emptyUsageAccountingState(),
    private readonly persist?: (state: UsageAccountingState) => Promise<void>,
  ) {
    this.state = structuredClone(initial);
    this.state.totals = addTokenUsageTotals(initial.totals);
  }

  async beforeTurn(): Promise<void> {
    await this.writes;
  }

  snapshot(): UsageAccountingState {
    return structuredClone(this.state);
  }

  record(threadId: string | null, cumulative: Usage): Promise<Usage> {
    const record = this.writes.then(async () => {
      const previous = threadId ? this.state.lastUsageByThread[threadId] : undefined;
      const delta = cumulativeUsageDelta(cumulative, previous);
      const next = {
        totals: addTokenUsageTotals(this.state.totals, tokenUsageFromSdkUsage(delta)),
        lastUsageByThread: {
          ...this.state.lastUsageByThread,
          ...(threadId
            ? {
                [threadId]: Object.fromEntries(
                  fields.map((field) => [
                    field,
                    Math.max(cumulative[field] ?? 0, previous?.[field] ?? 0),
                  ]),
                ) as Usage,
              }
            : {}),
        },
        reportedTurns: this.state.reportedTurns + 1,
      };
      // Do not let a caller continue to parsing or another paid turn until durable.
      await this.persist?.(next);
      this.state = next;
      return delta;
    });
    this.writes = record;
    return record;
  }
}

const context = new AsyncLocalStorage<UsageAccounting>();
// Standalone adapters still use explicit cumulative semantics. Build jobs always
// install their own persisted tracker, so concurrent jobs never share baselines.
const standalone = new UsageAccounting();
export const currentUsageAccounting = () => context.getStore() ?? standalone;
export const withUsageAccounting = <T>(
  accounting: UsageAccounting,
  run: () => Promise<T>,
): Promise<T> => context.run(accounting, run);
