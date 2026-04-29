import type { Diagnostic } from '../model/diagnostics';
import type { DiagramValidationOptions } from '../model/validate';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  diagnostics: Diagnostic[];
}

export type { DiagramValidationOptions };
