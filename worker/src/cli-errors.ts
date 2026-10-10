import type { Diagnostic } from './semantic';

export class UsageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UsageError';
  }
}
export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}
export class ValidationError extends Error {
  constructor(
    readonly diagnostics: Diagnostic[],
    options?: ErrorOptions,
  ) {
    super(diagnostics[0]?.message ?? 'validation failed', options);
    this.name = 'ValidationError';
  }
}
