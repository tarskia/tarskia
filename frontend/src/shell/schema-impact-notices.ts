import { type Diagnostic, diagnosticsToMessages } from '../semantic';

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? singular : plural;

export const buildDiagramImpactNoticeLines = (
  diagnostics: Diagnostic[],
  summaryLine: string,
): string[] => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length === 0) {
    return [];
  }
  const messages = diagnosticsToMessages(errors);
  const lines = [summaryLine];
  if (messages[0]) {
    lines.push(messages[0]);
  }
  if (errors.length > 1) {
    lines.push(`${errors.length - 1} more ${pluralize(errors.length - 1, 'issue')}.`);
  }
  return lines;
};
