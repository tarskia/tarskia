import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildSchemaVersionCatalog } from '../../../model/validation/schema-closure';
import { compileDiagramViewState } from '../../../semantic';
import { semanticBootstrap } from '../../../semantic/bootstrap';
import { buildDiagramSemanticRuntime } from '../../../semantic/runtime';
import { loadDiagramDocFromRaw } from '../../../viewer-core/loadDiagramDocFromRaw';
import { buildGraphModel } from '../graph/graph-model';
import { buildLayoutResult } from './layout-pipeline';

const curatedDirectory = new URL('../../../../../gallery/curated/', import.meta.url);
const manifest: { file: string; title: string }[] = JSON.parse(
  readFileSync(new URL('manifest.json', curatedDirectory), 'utf8'),
);
const schemaVersionCatalog = buildSchemaVersionCatalog(
  semanticBootstrap.builtInSchemaCatalogEntries,
);

test.each(manifest)('$file preserves compact-list container dimensions', ({ file, title }) => {
  const loaded = loadDiagramDocFromRaw({
    raw: readFileSync(new URL(file, curatedDirectory), 'utf8'),
    streamName: title,
    sourceLabel: file,
  });
  const runtime = buildDiagramSemanticRuntime({
    ...loaded,
    schemaVersionCatalog,
    fallbackSchema: semanticBootstrap.schemaModules[0],
  });
  const doc = {
    ...runtime.doc,
    view: {
      kind: 'semantic-diagram-view' as const,
      version: 2 as const,
      nodesById: Object.fromEntries(
        [...runtime.entityIndex.byId.keys()].map((id) => [id, { expanded: true }]),
      ),
    },
  };
  const layout = buildLayoutResult({
    graph: buildGraphModel(doc, runtime.schema),
    viewState: compileDiagramViewState({ doc, schema: runtime.schema }),
  });
  const lists = [...layout.tree.byId.values()].filter((node) => node.layoutMode === 'list');
  // Recorded before stretching rows: both container dimensions must remain unchanged.
  expect(Object.fromEntries(lists.map((node) => [node.id, node.size]))).toMatchSnapshot();
  for (const container of lists) {
    const widths = container.children.map((child) => child.size.width);
    expect(new Set(widths).size, `${file}: ${container.id} row widths ${widths.join(', ')}`).toBe(
      1,
    );
  }
});
