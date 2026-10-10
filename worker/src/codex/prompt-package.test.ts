import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaRepoFixture } from '../schema-repo-fixture';
import { loadSchemaRegistry } from '../semantic';
import { buildDiagramSynthesisContract } from '../semantic/diagram-synthesis-contract';
import { buildDiagramPromptPackage } from './prompt-package';

const fixturePath = (...segments: string[]) =>
  segments[0] === 'schema-repo'
    ? path.join(schemaRepoFixture(), ...segments.slice(1))
    : path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

describe('buildDiagramPromptPackage', () => {
  it('renders a compact contract and schema catalog without dumping source code', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const promptPackage = buildDiagramPromptPackage(buildDiagramSynthesisContract(registry));

    expect(promptPackage.renderedContract).toContain('Validation-backed contract:');
    expect(promptPackage.metaOntologyMarkdown).toContain('# Tarskia Diagram Meta-Ontology');
    expect(promptPackage.metaOntologyMarkdown).toContain('## Flow First');
    expect(promptPackage.renderedContract).toContain(
      'Worker modeling guidance (not validation law):',
    );
    expect(promptPackage.renderedContract).toContain('Operational guidance:');
    expect(promptPackage.renderedContract).toContain(
      'If this task asks for semantic document YAML and provides a local validation command, run it on your candidate output before signing off.',
    );
    expect(promptPackage.renderedContract).toContain(
      'Do not sign off on semantic document YAML while hard validation diagnostics remain.',
    );
    expect(promptPackage.renderedContract).toContain('Critical modeling guardrails:');
    expect(promptPackage.renderedContract).toContain('Schema catalog index');
    expect(promptPackage.renderedContract).toContain('description:');
    expect(promptPackage.renderedContract).toContain('Canonical example YAML:');
    expect(promptPackage.renderedContract).toContain('core/code@0.1');
    expect(promptPackage.renderedContract).toContain('core/code.types.module');
    expect(promptPackage.renderedContract).toContain('analysis.topLevelBias=avoid');
    expect(promptPackage.renderedContract).toContain(
      'core/frontend.types.frontend (Frontend); analysis.topLevelBias=prefer: Aggregate boundary for one or more related browser or client application surfaces',
    );
    expect(promptPackage.renderedContract).toContain('properties:');
    expect(promptPackage.renderedContract).toContain(
      'language [enum; values=typescript, javascript, python, go, rust, java, csharp; allowOther=true]: Primary implementation language for this module or subtree when known.',
    );
    expect(promptPackage.renderedContract).toContain(
      'Do not invent schema type ids to match repo concepts.',
    );
    expect(promptPackage.renderedContract).toContain(
      'for mixed groups, set props.mode to mixed and omit props.groupType',
    );
    expect(promptPackage.renderedContract).toContain('do not invent core/web-app.types.frontend');
    expect(promptPackage.renderedContract).toContain('schema: core/code@0.1');
    expect(promptPackage.renderedContract).toContain('layer: 1');
    expect(promptPackage.renderedContract).not.toContain('role: workflow');
    expect(promptPackage.renderedContract).toContain(
      'Worker-generated entities require provenance: true',
    );
    expect(promptPackage.renderedContract).toContain('Line numbers required in provenance: false');
    expect(promptPackage.renderedContract).toContain(
      'At every level, prefer shipped runtime architecture over build tooling, tests, local dev helpers, packaging/install scaffolding, and dev-only endpoints.',
    );
    expect(promptPackage.renderedContract).toContain(
      'bootstrap, package, service-unit, installer, and postinstall code as supporting evidence',
    );
    expect(promptPackage.renderedContract).toContain(
      'If the schema catalog includes a gallery-owned repo-specific schema',
    );
    expect(promptPackage.renderedContract).not.toContain('function validateDocument');
    expect(promptPackage.schemaCatalogJson).toContain('"schemaRef": "core/code@0.1"');
    expect(promptPackage.schemaCatalogJson).toContain(
      '"description": "Aggregate boundary for one or more related browser or client application surfaces',
    );
    expect(promptPackage.schemaCatalogJson).toContain('"setEntries": [');
  });

  it('renders a deterministic contract block', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const promptPackage = buildDiagramPromptPackage(buildDiagramSynthesisContract(registry));
    const stableContractBlock = promptPackage.renderedContract.split('\n').slice(0, 12).join('\n');

    expect(stableContractBlock).toMatchInlineSnapshot(`
      "Validation-backed contract:
      - Required top-level keys: version, schemaRefs, entities, relations
      - Optional top-level keys: inputs, metadata, view
      - Preferred containment encoding: children
      - Accepted containment encodings: children
      - Relation direction rule: directed-by-default
      - schemaRefs required: true
      - Explicit entity and relation ids preferred: true
      - Worker injects a single primary git input: true
      - Worker-generated entities require provenance: true
      - Worker-generated relations require provenance: true
      - Provenance location fields: path, symbol?, note?, input?"
    `);
  });
});
