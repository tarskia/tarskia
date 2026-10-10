import type { TokenUsageTotals } from '../token-usage';

export type ModelOutputFormat = 'json' | 'yaml';

export class ModelOutputParseError extends Error {
  readonly rawResponse: string;
  readonly threadId: string | null;
  readonly expectedFormat: ModelOutputFormat;
  readonly operation: string;
  readonly tokenUsage: TokenUsageTotals;

  constructor(params: {
    operation: string;
    expectedFormat: ModelOutputFormat;
    rawResponse: string;
    threadId: string | null;
    tokenUsage: TokenUsageTotals;
    cause: unknown;
  }) {
    const causeMessage =
      params.cause instanceof Error ? params.cause.message : String(params.cause);
    super(
      `${params.operation} did not return valid ${params.expectedFormat.toUpperCase()}: ${causeMessage}`,
      { cause: params.cause instanceof Error ? params.cause : undefined },
    );
    this.name = 'ModelOutputParseError';
    this.rawResponse = params.rawResponse;
    this.threadId = params.threadId;
    this.expectedFormat = params.expectedFormat;
    this.operation = params.operation;
    this.tokenUsage = params.tokenUsage;
  }
}

export function isModelOutputParseError(error: unknown): error is ModelOutputParseError {
  return error instanceof ModelOutputParseError;
}
