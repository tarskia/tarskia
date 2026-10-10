import type {
  DiagramSynthesisContract,
  SchemaCatalogEntry,
  SchemaCatalogPropertyEntry,
} from '../semantic/diagram-synthesis-contract';
import { loadDiagramMetaOntology } from './meta-ontology';

export interface DiagramPromptPackage {
  contract: DiagramSynthesisContract;
  renderedContract: string;
  metaOntologyMarkdown: string;
  schemaCatalogJson: string;
}

export function renderSharedDiagramPromptGuidance(promptPackage: DiagramPromptPackage): string {
  return [
    'Diagram meta-ontology:',
    promptPackage.metaOntologyMarkdown,
    '',
    promptPackage.renderedContract,
  ].join('\n');
}

function renderPropertyCatalogEntry(
  property: SchemaCatalogPropertyEntry,
  indent: string,
): string[] {
  const details = [
    property.type,
    property.values?.length ? `values=${property.values.join(', ')}` : null,
    property.allowOther ? 'allowOther=true' : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('; ');

  const lines = [
    `${indent}- ${property.id}${property.label ? ` (${property.label})` : ''}${details ? ` [${details}]` : ''}${property.description?.trim() ? `: ${property.description.trim()}` : ''}`,
  ];

  if (property.properties?.length) {
    lines.push(`${indent}  properties:`);
    for (const child of property.properties) {
      lines.push(...renderPropertyCatalogEntry(child, `${indent}    `));
    }
  }

  return lines;
}

function renderSchemaCatalogEntry(entry: SchemaCatalogEntry): string {
  const lines = [
    `- ${entry.schemaRef}`,
    `  description: ${entry.description?.trim() || '(none)'}`,
    `  imports: ${entry.imports.length > 0 ? entry.imports.join(', ') : '(none)'}`,
  ];

  lines.push(`  types:${entry.types.length === 0 ? ' (none)' : ''}`);
  for (const type of entry.types) {
    const description = type.description?.trim();
    lines.push(
      `    - ${type.id}${type.label ? ` (${type.label})` : ''}${type.analysis?.topLevelBias ? `; analysis.topLevelBias=${type.analysis.topLevelBias}` : ''}${description ? `: ${description}` : ''}`,
    );
    if (type.properties?.length) {
      lines.push('      properties:');
      for (const property of type.properties) {
        lines.push(...renderPropertyCatalogEntry(property, '        '));
      }
    }
  }

  lines.push(`  relations:${entry.relations.length === 0 ? ' (none)' : ''}`);
  for (const relation of entry.relations) {
    lines.push(
      `    - ${relation.id}${relation.label ? ` (${relation.label})` : ''}; directed=${relation.directed}`,
    );
    if (relation.properties?.length) {
      lines.push('      properties:');
      for (const property of relation.properties) {
        lines.push(...renderPropertyCatalogEntry(property, '        '));
      }
    }
  }

  lines.push(`  tags:${entry.tags.length === 0 ? ' (none)' : ''}`);
  for (const tag of entry.tags) {
    lines.push(`    - ${tag.id}${tag.label ? ` (${tag.label})` : ''}`);
  }

  lines.push(`  updates:${entry.updates.length === 0 ? ' (none)' : ''}`);
  for (const update of entry.updates) {
    const parts = [
      update.setEntries.length > 0 ? `set=${update.setEntries.join(', ')}` : null,
      update.addPaths.length > 0 ? `add=${update.addPaths.join(', ')}` : null,
      update.removePaths.length > 0 ? `remove=${update.removePaths.join(', ')}` : null,
    ].filter((part): part is string => Boolean(part));
    lines.push(`    - ${update.selector}${parts.length > 0 ? `; ${parts.join('; ')}` : ''}`);
  }

  return lines.join('\n');
}

export function renderSchemaSelectionGuidance(promptPackage: DiagramPromptPackage): string {
  return [
    'Schema selection catalog:',
    ...promptPackage.contract.schemaCatalog.map((entry) => renderSchemaCatalogEntry(entry)),
  ].join('\n');
}

export function buildDiagramPromptPackage(
  contract: DiagramSynthesisContract,
): DiagramPromptPackage {
  const metaOntologyMarkdown = loadDiagramMetaOntology();
  const schemaCatalogJson = JSON.stringify(contract.schemaCatalog, null, 2);
  const renderedContract = [
    'Validation-backed contract:',
    `- Required top-level keys: ${contract.validationRules.requiredTopLevelKeys.join(', ')}`,
    `- Optional top-level keys: ${contract.validationRules.optionalTopLevelKeys.join(', ')}`,
    `- Preferred containment encoding: ${contract.validationRules.preferredContainmentEncoding}`,
    `- Accepted containment encodings: ${contract.validationRules.acceptedContainmentEncodings.join(', ')}`,
    `- Relation direction rule: ${contract.validationRules.relationDirectionRule}`,
    `- schemaRefs required: ${contract.validationRules.schemaRefsRequired}`,
    `- Explicit entity and relation ids preferred: ${contract.validationRules.explicitIdsPreferred}`,
    `- Worker injects a single primary git input: ${contract.validationRules.workerInjectsPrimaryGitInput}`,
    `- Worker-generated entities require provenance: ${contract.validationRules.workerRequiresEntityProvenance}`,
    `- Worker-generated relations require provenance: ${contract.validationRules.workerRequiresRelationProvenance}`,
    `- Provenance location fields: ${contract.validationRules.provenanceLocationFields.join(', ')}`,
    '- Provenance YAML shape: provenance.locations[] entries; do not use provenance.input/provenance.paths shorthand.',
    `- Provenance input rule: ${contract.validationRules.provenanceLocationInputRule}`,
    `- Line numbers required in provenance: ${contract.validationRules.lineNumbersRequiredInProvenance}`,
    '',
    'Worker modeling guidance (not validation law):',
    `- Omit view by default: ${contract.promptPolicies.omitViewByDefault}`,
    `- Prefer fewer stronger boundaries: ${contract.promptPolicies.preferFewerStrongerBoundaries}`,
    `- Avoid helpers, functions, and classes as diagram nodes: ${contract.promptPolicies.avoidHelpersFunctionsClasses}`,
    `- Avoid duplicating external IO at the code layer: ${contract.promptPolicies.avoidDuplicatingExternalIoAtCodeLayer}`,
    `- ${contract.promptPolicies.serviceVsModuleRule}`,
    `- ${contract.promptPolicies.runtimeOverToolingRule}`,
    '',
    'Operational guidance:',
    '- If this task asks for semantic document YAML and provides a local validation command, run it on your candidate output before signing off.',
    '- Do not sign off on semantic document YAML while hard validation diagnostics remain.',
    '',
    'Critical modeling guardrails:',
    ...contract.promptPolicies.modelingGuardrails.map((rule) => `- ${rule}`),
    '',
    'Schema catalog index (inspect raw schema YAML for full details before drafting):',
    ...contract.schemaCatalog.map((entry) => renderSchemaCatalogEntry(entry)),
    '',
    'Canonical example YAML:',
    '```yaml',
    contract.canonicalExampleYaml.trim(),
    '```',
  ].join('\n');

  return {
    contract,
    renderedContract,
    metaOntologyMarkdown,
    schemaCatalogJson,
  };
}
