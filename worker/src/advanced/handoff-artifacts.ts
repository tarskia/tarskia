import path from 'node:path';

export interface HandoffArtifactOptions {
  includeAreaPlan?: boolean;
  includeBackbone?: boolean;
  includeAcceptedBackbone?: boolean;
  includeCandidateFinalGraph?: boolean;
}

interface HandoffArtifactDefinition {
  label: string;
  relativePath: string;
  include?: keyof HandoffArtifactOptions;
  defaultIncluded?: boolean;
}

type HandoffStage =
  | 'pre-refinement'
  | 'backbone-review'
  | 'node-refinement'
  | 'wave1-review'
  | 'graph-collation'
  | 'final-review';

const HANDOFF_ARTIFACTS: Record<HandoffStage, readonly HandoffArtifactDefinition[]> = {
  'pre-refinement': [
    { label: 'Repo census', relativePath: 'analysis/repo-census.json' },
    {
      label: 'Concept plan',
      relativePath: 'analysis/area-plan.json',
      include: 'includeAreaPlan',
      defaultIncluded: false,
    },
    {
      label: 'Level-0 backbone',
      relativePath: 'analysis/level0-backbone.yaml',
      include: 'includeBackbone',
      defaultIncluded: false,
    },
    { label: 'Prompt contract', relativePath: 'prompt-contract.md' },
    { label: 'Schema catalog', relativePath: 'schema-catalog.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Meta ontology', relativePath: 'meta-ontology.md' },
  ],
  'backbone-review': [
    { label: 'Repo census', relativePath: 'analysis/repo-census.json' },
    { label: 'Concept plan', relativePath: 'analysis/area-plan.json' },
    {
      label: 'Accepted level-0 backbone',
      relativePath: 'analysis/level0-backbone.yaml',
      include: 'includeAcceptedBackbone',
      defaultIncluded: true,
    },
    { label: 'Schema set', relativePath: 'analysis/schema-set.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Flow analysis', relativePath: 'analysis/flow-analysis.json' },
    { label: 'Flow build state', relativePath: 'analysis/flow-build-state.json' },
    { label: 'Prompt contract', relativePath: 'prompt-contract.md' },
    { label: 'Schema catalog', relativePath: 'schema-catalog.json' },
    { label: 'Meta ontology', relativePath: 'meta-ontology.md' },
  ],
  'node-refinement': [
    { label: 'Node-refinement state', relativePath: 'analysis/node-refinement-state.json' },
    { label: 'Level-0 backbone', relativePath: 'analysis/level0-backbone.yaml' },
    { label: 'Schema set', relativePath: 'analysis/schema-set.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Prompt contract', relativePath: 'prompt-contract.md' },
    {
      label: 'Validation context',
      relativePath: 'analysis/node-refinement.validation-context.json',
    },
  ],
  'wave1-review': [
    { label: 'Wave-1 partial document', relativePath: 'analysis/wave1-document.yaml' },
    { label: 'Wave-1 summary', relativePath: 'analysis/wave1-summary.json' },
    { label: 'Reviewed level-0 backbone', relativePath: 'analysis/level0-backbone.yaml' },
    { label: 'Node-refinement state', relativePath: 'analysis/node-refinement-state.json' },
    { label: 'Schema set', relativePath: 'analysis/schema-set.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Flow build-state', relativePath: 'analysis/flow-build-state.json' },
  ],
  'graph-collation': [
    {
      label: 'Assembled refined document',
      relativePath: 'analysis/assembled-refined-document.yaml',
    },
    { label: 'Node-refinement state', relativePath: 'analysis/node-refinement-state.json' },
    { label: 'Level-0 backbone', relativePath: 'analysis/level0-backbone.yaml' },
    { label: 'Schema set', relativePath: 'analysis/schema-set.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Current final graph', relativePath: 'analysis/final-graph.yaml' },
    { label: 'Prompt contract', relativePath: 'prompt-contract.md' },
  ],
  'final-review': [
    {
      label: 'Candidate final graph',
      relativePath: 'analysis/final-graph.yaml',
      include: 'includeCandidateFinalGraph',
      defaultIncluded: true,
    },
    {
      label: 'Assembled refined document',
      relativePath: 'analysis/assembled-refined-document.yaml',
    },
    { label: 'Level-0 backbone', relativePath: 'analysis/level0-backbone.yaml' },
    { label: 'Schema set', relativePath: 'analysis/schema-set.json' },
    { label: 'Schema flow catalogue', relativePath: 'analysis/schema-flow-catalog.json' },
    { label: 'Final-review summary', relativePath: 'analysis/final-review.summary.json' },
    { label: 'Prompt contract', relativePath: 'prompt-contract.md' },
  ],
};

export function resolveHandoffArtifacts(
  stage: HandoffStage,
  workspaceOutputDir: string,
  options: HandoffArtifactOptions = {},
): Array<{ label: string; path: string }> {
  return HANDOFF_ARTIFACTS[stage]
    .filter(
      (artifact) =>
        artifact.include === undefined ||
        (artifact.defaultIncluded
          ? options[artifact.include] !== false
          : Boolean(options[artifact.include])),
    )
    .map((artifact) => ({
      label: artifact.label,
      path: path.join(workspaceOutputDir, artifact.relativePath),
    }));
}
