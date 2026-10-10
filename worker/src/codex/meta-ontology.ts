import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const metaOntologyPath = fileURLToPath(new URL('./diagram-meta-ontology.md', import.meta.url));

export function loadDiagramMetaOntology(): string {
  try {
    return readFileSync(metaOntologyPath, 'utf8').trim();
  } catch (cause) {
    throw new Error(`Unable to load bundled diagram meta-ontology at ${metaOntologyPath}.`, {
      cause,
    });
  }
}
