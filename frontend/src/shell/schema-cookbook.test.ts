import { describe, expect, it } from 'vitest';

import { getSchemaModuleRef } from '../model/schema-ref';
import {
  assessSchemaValidation,
  buildSchemaVersionCatalog,
  parseAndValidateSchemaModule,
} from '../model/validation';
import baseRaw from '../schemas/base.yaml?raw';
import codeRaw from '../schemas/code.yaml?raw';
import dataModelRaw from '../schemas/data-model.yaml?raw';
import frontendRaw from '../schemas/frontend.yaml?raw';
import kubernetesRaw from '../schemas/kubernetes.yaml?raw';
import softwareRaw from '../schemas/software.yaml?raw';
import webAppRaw from '../schemas/web-app.yaml?raw';
import {
  mergeSchemaCookbookRecipeIntoDraft,
  schemaCookbookRecipes,
  shouldAutoOpenSchemaCookbook,
} from './schema-cookbook';
import {
  buildDefaultEditorSchemaDraftText,
  buildSchemaDraftFromEditorText,
} from './schema-editor-draft';

const fallbackVersions = new Map<string, string>([
  ['core/base', '0.1'],
  ['core/software', '0.1'],
  ['core/web-app', '0.3'],
  ['core/code', '0.1'],
  ['core/frontend', '0.3'],
  ['core/data-model', '0.3'],
  ['core/kubernetes', '0.3'],
]);

const catalog = buildSchemaVersionCatalog(
  [baseRaw, softwareRaw, webAppRaw, codeRaw, frontendRaw, dataModelRaw, kubernetesRaw].map(
    (raw) => {
      const parsed = parseAndValidateSchemaModule(raw);
      if (!parsed.ok || !parsed.value) {
        throw new Error('Expected built-in schema fixture to validate.');
      }
      return {
        schemaId: getSchemaModuleRef(parsed.value),
        version: parsed.value.version,
        raw,
        module: parsed.value,
      };
    },
  ),
);

const recipeById = (id: string) => {
  const recipe = schemaCookbookRecipes.find((entry) => entry.id === id);
  if (!recipe) {
    throw new Error(`Missing cookbook recipe ${id}`);
  }
  return recipe;
};

const toRaw = (editorText: string) =>
  buildSchemaDraftFromEditorText({
    editorText,
    identity: { owner: 'user', name: 'draft' },
    version: '1.0',
    fallbackVersionsBySchemaId: fallbackVersions,
  });

describe('schema cookbook recipes', () => {
  it('keeps every cookbook recipe as a valid schema module', () => {
    for (const recipe of schemaCookbookRecipes) {
      const parsed = parseAndValidateSchemaModule(recipe.moduleYaml);
      expect(parsed.ok, recipe.id).toBe(true);
    }
  });

  it('keeps every cookbook recipe grounded in the current built-in schema catalog', () => {
    for (const recipe of schemaCookbookRecipes) {
      const assessment = assessSchemaValidation({
        raw: recipe.moduleYaml,
        versionCatalog: catalog,
      });
      expect(assessment.ok, recipe.id).toBe(true);
    }
  });

  it('auto-opens the cookbook only for users without published schemas', () => {
    expect(shouldAutoOpenSchemaCookbook(0)).toBe(true);
    expect(shouldAutoOpenSchemaCookbook(1)).toBe(false);
  });
});

describe('mergeSchemaCookbookRecipeIntoDraft', () => {
  it('inserts a recipe cleanly into the starter draft', () => {
    const starter = buildDefaultEditorSchemaDraftText([]);
    const result = mergeSchemaCookbookRecipeIntoDraft({
      draftText: starter,
      recipe: recipeById('add-tag'),
    });

    expect(result.nextDraftText).toContain('schema: web-app');
    expect(result.nextDraftText).toContain('- id: private');
    expect(result.insertedItems.some((item) => item.kind === 'tag' && item.key === 'private')).toBe(
      true,
    );
    expect(result.insertedRanges.length).toBeGreaterThan(0);
    expect(parseAndValidateSchemaModule(toRaw(result.nextDraftText)).ok).toBe(true);
  });

  it('reuses an existing import alias and rewrites inserted selectors to match it', () => {
    const draftText =
      'use:\n  - schema: web-app\n    alias: app\ntags: []\ntraits: []\ntypes: []\nrelations: []\nupdate: {}\nremove: {}\n';
    const result = mergeSchemaCookbookRecipeIntoDraft({
      draftText,
      recipe: recipeById('update-imported-type'),
    });

    expect(result.nextDraftText).toContain('schema: web-app');
    expect(result.nextDraftText).toContain('alias: app');
    expect(result.nextDraftText).not.toContain('alias: web');
    expect(result.nextDraftText).toContain('app.types.api-endpoint:');
  });

  it('skips duplicate local ids as conflicts', () => {
    const draftText =
      'use:\n  - schema: web-app\n    alias: web\ntags: []\ntraits: []\ntypes:\n  - id: background-worker\n    label: Existing Worker\nrelations: []\nupdate: {}\nremove: {}\n';
    const result = mergeSchemaCookbookRecipeIntoDraft({
      draftText,
      recipe: recipeById('add-type'),
    });

    expect(result.insertedItems.some((item) => item.kind === 'type')).toBe(false);
    expect(
      result.skippedItems.some(
        (item) =>
          item.kind === 'type' && item.key === 'background-worker' && item.reason === 'conflict',
      ),
    ).toBe(true);
    expect(result.messageLines).toContain(
      'Skipped type background-worker because it already exists in the draft.',
    );
  });

  it('skips duplicate update selectors as conflicts', () => {
    const draftText =
      'use:\n  - schema: web-app\n    alias: web\ntags: []\ntraits: []\ntypes: []\nrelations: []\nupdate:\n  web.types.api-endpoint:\n    set:\n      label: Existing Label\nremove: {}\n';
    const result = mergeSchemaCookbookRecipeIntoDraft({
      draftText,
      recipe: recipeById('update-imported-type'),
    });

    expect(
      result.skippedItems.some(
        (item) =>
          item.kind === 'update' &&
          item.key === 'web.types.api-endpoint' &&
          item.reason === 'conflict',
      ),
    ).toBe(true);
    expect(result.messageLines).toContain(
      'Skipped update web.types.api-endpoint because it already exists in the draft.',
    );
  });

  it('partially inserts remove entries and skips exact duplicates as already present', () => {
    const draftText =
      'use:\n  - schema: software\n    alias: sw\n  - schema: web-app\n    alias: web\ntags: []\ntraits: []\ntypes: []\nrelations: []\nupdate: {}\nremove:\n  sw.relations:\n    - read-writes\n';
    const result = mergeSchemaCookbookRecipeIntoDraft({
      draftText,
      recipe: recipeById('remove-deprecated-elements'),
    });

    expect(
      result.skippedItems.some(
        (item) =>
          item.kind === 'remove' &&
          item.label === 'sw.relations → read-writes' &&
          item.reason === 'already_present',
      ),
    ).toBe(true);
    expect(
      result.insertedItems.some(
        (item) => item.kind === 'remove' && item.key === 'web.types.topic.properties',
      ),
    ).toBe(true);
    expect(result.messageLines).toContain(
      'Skipped remove sw.relations → read-writes because it is already present.',
    );
  });

  it('rejects invalid current draft text instead of attempting a text splice', () => {
    expect(() =>
      mergeSchemaCookbookRecipeIntoDraft({
        draftText: 'types: [',
        recipe: recipeById('add-tag'),
      }),
    ).toThrow('Cannot insert cookbook content into an invalid draft.');
  });
});
