export type SchemaCompatibilityBump = 'none' | 'minor' | 'major';
export type SchemaCompatibilityChangeSeverity = 'breaking' | 'nonBreaking';
export type SchemaCompatibilityChangeSubject =
  | 'schema'
  | 'tag'
  | 'trait'
  | 'type'
  | 'relation'
  | 'property';
export type SchemaCompatibilityChangeOperation = 'add' | 'remove' | 'change' | 'narrow' | 'widen';

export interface SchemaCompatibilityChange {
  severity: SchemaCompatibilityChangeSeverity;
  subject: SchemaCompatibilityChangeSubject;
  operation: SchemaCompatibilityChangeOperation;
  targetId: string;
  displayId: string;
  message: string;
  priority: number;
}

export interface SchemaCompatibilityAssessment {
  backwardCompatible: boolean;
  recommendedBump: SchemaCompatibilityBump;
  hasChanges: boolean;
  breakingChanges: string[];
  nonBreakingChanges: string[];
  changes: SchemaCompatibilityChange[];
  briefSummary: string[];
}
