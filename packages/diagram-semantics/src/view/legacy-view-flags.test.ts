import { describe, expect, it } from 'vitest';
import type { DiagramView } from '../model/types';
import { parseDocument, serializeDocument } from '../util/serialization';
import { normalizeDiagramViewNodesById } from './normalize-diagram-view';

describe('legacy view flags', () => {
  const legacyNodes = {
    off: { highlighted: false },
    obsolete: { hidden: true },
    expanded: { hidden: true, expanded: true },
    highlighted: { hidden: true, highlighted: true },
    combined: { hidden: false, expanded: true, highlighted: true },
    unhighlighted: { hidden: true, expanded: true, highlighted: false },
  };
  const expected = {
    expanded: { expanded: true },
    highlighted: { highlighted: true },
    combined: { expanded: true, highlighted: true },
    unhighlighted: { expanded: true, highlighted: false },
  };
  it('strips legacy hidden keys even alongside supported node flags', () => {
    expect(normalizeDiagramViewNodesById(legacyNodes as DiagramView['nodesById'])).toEqual(
      expected,
    );
  });
  it('loads legacy documents and preserves highlighted through serialization', () => {
    const doc = parseDocument(
      JSON.stringify({
        version: '1',
        schemaRefs: [],
        entities: [],
        relations: [],
        view: { kind: 'semantic-diagram-view', version: 2, nodesById: legacyNodes },
      }),
    );
    expect(doc.view?.nodesById).toEqual({ ...expected, off: { highlighted: false } });
    const serialized = serializeDocument(doc);
    expect(serialized).not.toContain('hidden:');
    expect(parseDocument(serialized).view?.nodesById).toEqual({
      ...expected,
      off: { highlighted: false },
    });
  });
});
