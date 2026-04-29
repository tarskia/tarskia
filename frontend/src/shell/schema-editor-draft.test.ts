import { describe, expect, it } from 'vitest';

import {
  buildDefaultEditorSchemaDraftText,
  buildSchemaDraftFromEditorText,
  loadStoredEditorSchemaDraftText,
  toEditorSchemaDraftText,
} from './schema-editor-draft';

describe('schema editor draft boundary', () => {
  it('hides managed header fields and raw schema refs from the editor text', () => {
    const editorText = toEditorSchemaDraftText(
      `
owner: user
name: feature
version: "1.0"
use:
  - schema: core/web-app@0.3
    alias: web
types: []
relations: []
`.trim(),
    );

    expect(editorText).not.toContain('owner: user\nname: feature');
    expect(editorText).not.toContain('version: "1.0"');
    expect(editorText).toContain('schema: web-app');
    expect(editorText).not.toContain('schema: core/web-app@0.3');
  });

  it('preserves existing hidden dependency versions when rematerializing editor text', () => {
    const raw = buildSchemaDraftFromEditorText({
      editorText: `
use:
  - schema: web-app
    alias: web
types: []
relations: []
`.trim(),
      identity: { owner: 'user', name: 'feature' },
      version: '1.0',
      previousRaw: `
owner: user
name: feature
version: "1.0"
use:
  - schema: core/web-app@0.3
    alias: web
types: []
relations: []
`.trim(),
    });

    expect(raw).toContain('schema: core/web-app@0.3');
  });

  it('pins new editor imports from the provided fallback version map', () => {
    const raw = buildSchemaDraftFromEditorText({
      editorText: `
use:
  - schema: kubernetes
    alias: k8s
types: []
relations: []
`.trim(),
      identity: { owner: 'user', name: 'feature' },
      version: '1.0',
      fallbackVersionsBySchemaId: new Map([['core/kubernetes', '0.3']]),
    });

    expect(raw).toContain('schema: core/kubernetes@0.3');
  });

  it('builds a default editor draft without exposing raw schema prefixes', () => {
    const editorText = buildDefaultEditorSchemaDraftText([
      'core/web-app@0.3',
      'core/data-model@0.3',
    ]);

    expect(editorText).toContain('schema: web-app');
    expect(editorText).toContain('schema: data-model');
    expect(editorText).not.toContain('core/web-app@0.3');
  });

  it('falls back cleanly when stored draft text is the poisoned undefined sentinel', () => {
    const text = loadStoredEditorSchemaDraftText(
      'undefined',
      `
owner: user
name: draft
version: "1.0"
types: []
relations: []
`.trim(),
    );

    expect(text).toBe('types: []\nrelations: []');
  });
});
