export type DiagnosticDomain = 'schema' | 'diagram';
export type DiagnosticPhase = 'parse' | 'shape' | 'semantic' | 'resolution' | 'document';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticDetails = Record<string, unknown>;

export interface RelationAnalysisDiagnosticDetails extends DiagnosticDetails {
  relationAnalysis: {
    fromRef: string;
    fromType: string;
    toRef: string;
    toType: string;
    selectedType: string;
    validRelationTypes: string[];
    requiresEndpointChange: boolean;
  };
}

export interface Diagnostic {
  domain: DiagnosticDomain;
  phase: DiagnosticPhase;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  hint?: string;
  moduleId?: string;
  selector?: string;
  targetId?: string;
  entityId?: string;
  relationId?: string;
  details?: DiagnosticDetails;
  source?: {
    keyword?: string;
    schemaPath?: string;
    instancePath?: string;
  };
}

const PHASE_ORDER: DiagnosticPhase[] = ['parse', 'shape', 'semantic', 'resolution', 'document'];
const SEVERITY_ORDER: DiagnosticSeverity[] = ['error', 'warning', 'info'];
const DOMAIN_ORDER: DiagnosticDomain[] = ['schema', 'diagram'];

const phaseRank = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));
const severityRank = new Map(SEVERITY_ORDER.map((severity, index) => [severity, index]));
const domainRank = new Map(DOMAIN_ORDER.map((domain, index) => [domain, index]));

export const diagnosticsToMessages = (diagnostics: Diagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.message);

export const diagnosticFingerprint = (diagnostic: Diagnostic) =>
  [
    diagnostic.domain,
    diagnostic.phase,
    diagnostic.severity,
    diagnostic.code,
    diagnostic.path ?? '',
    diagnostic.moduleId ?? '',
    diagnostic.selector ?? '',
    diagnostic.targetId ?? '',
    diagnostic.entityId ?? '',
    diagnostic.relationId ?? '',
    diagnostic.message,
  ].join('|');

const compareText = (left?: string, right?: string) => (left ?? '').localeCompare(right ?? '');

export const compareDiagnostics = (left: Diagnostic, right: Diagnostic) => {
  const phaseDelta =
    (phaseRank.get(left.phase) ?? Number.MAX_SAFE_INTEGER) -
    (phaseRank.get(right.phase) ?? Number.MAX_SAFE_INTEGER);
  if (phaseDelta !== 0) return phaseDelta;

  const severityDelta =
    (severityRank.get(left.severity) ?? Number.MAX_SAFE_INTEGER) -
    (severityRank.get(right.severity) ?? Number.MAX_SAFE_INTEGER);
  if (severityDelta !== 0) return severityDelta;

  const domainDelta =
    (domainRank.get(left.domain) ?? Number.MAX_SAFE_INTEGER) -
    (domainRank.get(right.domain) ?? Number.MAX_SAFE_INTEGER);
  if (domainDelta !== 0) return domainDelta;

  const codeDelta = compareText(left.code, right.code);
  if (codeDelta !== 0) return codeDelta;

  const pathDelta = compareText(left.path, right.path);
  if (pathDelta !== 0) return pathDelta;

  const idDelta = compareText(left.moduleId ?? left.entityId, right.moduleId ?? right.entityId);
  if (idDelta !== 0) return idDelta;

  return compareText(left.message, right.message);
};

export const sortDiagnostics = (diagnostics: Diagnostic[]) =>
  [...diagnostics].sort(compareDiagnostics);

export interface DiagnosticGroup {
  phase: DiagnosticPhase;
  severity: DiagnosticSeverity;
  diagnostics: Diagnostic[];
}

export const groupDiagnostics = (diagnostics: Diagnostic[]): DiagnosticGroup[] => {
  const groups: DiagnosticGroup[] = [];
  for (const diagnostic of sortDiagnostics(diagnostics)) {
    const last = groups[groups.length - 1];
    if (last && last.phase === diagnostic.phase && last.severity === diagnostic.severity) {
      last.diagnostics.push(diagnostic);
      continue;
    }
    groups.push({
      phase: diagnostic.phase,
      severity: diagnostic.severity,
      diagnostics: [diagnostic],
    });
  }
  return groups;
};

type SchemaDiagnosticInput = Omit<Diagnostic, 'domain'>;
type DiagramDiagnosticInput = Omit<Diagnostic, 'domain'>;

export const schemaDiagnostic = (input: SchemaDiagnosticInput): Diagnostic => ({
  domain: 'schema',
  ...input,
});

export const diagramDiagnostic = (input: DiagramDiagnosticInput): Diagnostic => ({
  domain: 'diagram',
  ...input,
});
