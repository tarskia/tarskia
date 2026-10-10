import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { type Diagnostic, getSchemaModuleRef } from '../../semantic';
import { resolveHandoffArtifacts } from '../handoff-artifacts';
import {
  BACKBONE_REVIEW_HANDOFF_ARTIFACT,
  buildHandoffArtifact,
  formatSchemaActivations,
  PRE_REFINEMENT_HANDOFF_ARTIFACT,
  SCHEMA_SELECTION_VALIDATION_CONTEXT_ARTIFACT,
  SCHEMA_SELECTION_VALIDATION_HELPER_ARTIFACT,
} from './shared';
import type { setupThreads } from './thread-setup';

export async function prepareStageArtifacts(context: Awaited<ReturnType<typeof setupThreads>>) {
  const { options, buildValidationHelperScript, schemaRegistry } = context;
  const schemaSelectionValidationCommand = `node out/${SCHEMA_SELECTION_VALIDATION_HELPER_ARTIFACT}`;
  const writeSchemaSelectionValidationArtifacts = async (context: {
    rootSchemaRefs: Array<{ schema: string; layer: number }>;
    activeSchemaRefs: Array<{ schema: string; layer: number }>;
    candidateSchemaRefs: Array<{
      schemaRef: string;
      suggestedLayer: number;
      rationale: string;
      evidence: Array<{ path: string; reason: string }>;
    }>;
  }) => {
    await writeWorkspaceArtifact(
      options.workspace,
      SCHEMA_SELECTION_VALIDATION_HELPER_ARTIFACT,
      buildValidationHelperScript(
        'validate-schema-selection',
        SCHEMA_SELECTION_VALIDATION_CONTEXT_ARTIFACT,
      ),
    );
    await writeWorkspaceJsonArtifact(
      options.workspace,
      SCHEMA_SELECTION_VALIDATION_CONTEXT_ARTIFACT,
      {
        version: 1,
        rootSchemaRefs: context.rootSchemaRefs,
        activeSchemaRefs: context.activeSchemaRefs,
        candidateSchemaRefs: context.candidateSchemaRefs,
      },
    );
    return schemaSelectionValidationCommand;
  };
  const prepareAreaPlanSchemaValidationCommand = async () =>
    writeSchemaSelectionValidationArtifacts({
      rootSchemaRefs: [],
      activeSchemaRefs: [],
      candidateSchemaRefs: Array.from(schemaRegistry.modulesById.values())
        .map((module) => getSchemaModuleRef(module, true))
        .sort((left, right) => left.localeCompare(right))
        .map((schemaRef) => ({
          schemaRef,
          suggestedLayer: 0,
          rationale: 'Available schema module in the copied schema repository',
          evidence: [
            {
              path: 'schema-repo',
              reason: 'Schema is present in the worker schema repository',
            },
          ],
        })),
    });

  const writePreRefinementHandoff = async (params: {
    summary: string;
    activeSchemaRefs: Array<{ schema: string; layer: number }>;
    includeAreaPlan?: boolean;
    includeBackbone?: boolean;
  }) =>
    writeWorkspaceArtifact(
      options.workspace,
      PRE_REFINEMENT_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Pre-Refinement Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary: params.summary,
        artifactPaths: resolveHandoffArtifacts(
          'pre-refinement',
          options.workspace.workspaceOutputDir,
          params,
        ),
        extraSections: [
          {
            heading: 'Active Schema Activations',
            body: formatSchemaActivations(params.activeSchemaRefs),
          },
        ],
      }),
    );

  const writeBackboneReviewHandoff = async (params: {
    summary: string;
    activeSchemaRefs: Array<{ schema: string; layer: number }>;
    includeAcceptedBackbone?: boolean;
    diagnostics?: Diagnostic[];
  }) =>
    writeWorkspaceArtifact(
      options.workspace,
      BACKBONE_REVIEW_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Backbone Review Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary: params.summary,
        artifactPaths: resolveHandoffArtifacts(
          'backbone-review',
          options.workspace.workspaceOutputDir,
          params,
        ),
        extraSections: [
          {
            heading: 'Active Schema Activations',
            body: formatSchemaActivations(params.activeSchemaRefs),
          },
          ...((params.diagnostics ?? []).length > 0
            ? [
                {
                  heading: 'Current Validation Diagnostics',
                  body: (params.diagnostics ?? [])
                    .map(
                      (diagnostic) =>
                        `- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
                    )
                    .join('\n'),
                },
              ]
            : []),
        ],
      }),
    );

  return {
    ...context,
    prepareAreaPlanSchemaValidationCommand,
    writeSchemaSelectionValidationArtifacts,
    writePreRefinementHandoff,
    writeBackboneReviewHandoff,
  };
}
