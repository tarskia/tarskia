import { writeWorkspaceArtifact } from '../../artifacts';
import { buildDiagramPromptPackage } from '../../codex/prompt-package';
import { runTimedStep } from '../../logger';
import { loadSchemaRegistry } from '../../semantic';
import { buildDiagramSynthesisContract } from '../../semantic/diagram-synthesis-contract';
import type { runCensus } from './census';

export async function preparePromptContext(context: Awaited<ReturnType<typeof runCensus>>) {
  const { options, timings, emitProgress } = context;
  await emitProgress({
    activeStage: 'advanced/prompt-contract-preparation',
  });
  const { schemaRegistry, promptPackage } = await runTimedStep(
    {
      logger: options.logger,
      label: 'advanced prompt contract preparation',
      timings,
      detail: (result) => `${result.schemaRegistry.modulesById.size} schema modules`,
    },
    async () => {
      const loadedSchemaRegistry = await loadSchemaRegistry(options.workspace.schemaRepoPath);
      const builtPromptPackage = buildDiagramPromptPackage(
        buildDiagramSynthesisContract(loadedSchemaRegistry),
      );
      await writeWorkspaceArtifact(
        options.workspace,
        'meta-ontology.md',
        builtPromptPackage.metaOntologyMarkdown,
      );
      await writeWorkspaceArtifact(
        options.workspace,
        'prompt-contract.md',
        builtPromptPackage.renderedContract,
      );
      await writeWorkspaceArtifact(
        options.workspace,
        'schema-catalog.json',
        builtPromptPackage.schemaCatalogJson,
      );
      return {
        schemaRegistry: loadedSchemaRegistry,
        promptPackage: builtPromptPackage,
      };
    },
  );

  return { ...context, schemaRegistry, promptPackage };
}
