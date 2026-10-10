type Awaitable<T> = T | Promise<T>;
export type StageAcceptance = 'valid' | 'checkpoint' | 'advisory' | 'fallback';

/** Validation and effects remain stage-owned; this kernel owns retry/acceptance policy. */
export interface StageEvaluation<T> {
  valid: boolean;
  checkpointAccepted?: boolean;
  advisoryOnly?: boolean;
  fallbackRequired?: boolean;
  fallbackAvailable?: boolean;
  accept(reason: StageAcceptance): Awaitable<T>;
  repair?(): Awaitable<void>;
  exhausted?(): Awaitable<T>;
  /** Restore state, then evaluate again so checkpoint/validation ordering is unchanged. */
  restoreFallback?(): Awaitable<void>;
}
interface ValidatedStage<T> {
  evaluate(): Awaitable<StageEvaluation<T>>;
  maxRepairs: number;
  repairCount(): number;
  acceptAdvisoriesAtLimit?: boolean;
}
interface AttemptStage<T> {
  attempt(attempt: number): Awaitable<T>;
  maxAttempts: number;
  firstAttempt?: number;
  retryError?: (error: unknown) => boolean;
  beforeAttempt?: (attempt: number) => Awaitable<void>;
  afterRetryableError?: (error: unknown, attempt: number) => Awaitable<void>;
}

export async function runRepairableStage<T>(
  options: ValidatedStage<T> | AttemptStage<T>,
): Promise<T> {
  if ('attempt' in options) {
    for (let attempt = options.firstAttempt ?? 1; attempt <= options.maxAttempts; attempt += 1) {
      await options.beforeAttempt?.(attempt);
      try {
        return await options.attempt(attempt);
      } catch (error) {
        if (attempt >= options.maxAttempts || !options.retryError?.(error)) throw error;
        await options.afterRetryableError?.(error, attempt);
      }
    }
    // No current caller supplies an exhausted attempt range; retain an explicit failure.
    throw new Error('Repairable stage has no remaining attempts');
  }
  while (true) {
    const evaluation = await options.evaluate();
    const atLimit = options.repairCount() >= options.maxRepairs;
    if (evaluation.fallbackRequired) return evaluation.accept('fallback');
    if (evaluation.valid) return evaluation.accept('valid');
    if (evaluation.checkpointAccepted) return evaluation.accept('checkpoint');
    if (atLimit && options.acceptAdvisoriesAtLimit && evaluation.advisoryOnly)
      return evaluation.accept('advisory');
    if (atLimit) {
      if (evaluation.fallbackAvailable && evaluation.restoreFallback) {
        await evaluation.restoreFallback();
        continue;
      }
      if (evaluation.exhausted) return evaluation.exhausted();
      throw new Error('Repairable stage exhausted without a failure policy');
    }
    if (!evaluation.repair) throw new Error('Repairable stage has no repair operation');
    await evaluation.repair();
  }
}
