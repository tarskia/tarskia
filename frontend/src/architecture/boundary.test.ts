import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const srcRoot = path.join(projectRoot, 'src');

const normalizePath = (value: string) => value.split(path.sep).join('/');

const collectFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return [fullPath];
  });

describe('architecture boundaries', () => {
  it('keeps UI, shell, and top-level canvas/diagram files off model internals', () => {
    const scopedFiles = [
      ...collectFiles(path.join(srcRoot, 'ui')),
      ...collectFiles(path.join(srcRoot, 'shell')),
      path.join(srcRoot, 'canvas', 'DiagramCanvas.tsx'),
      path.join(srcRoot, 'canvas', 'useCanvasSurfaceController.tsx'),
      path.join(srcRoot, 'diagram', 'useDiagramEngine.ts'),
      path.join(srcRoot, 'diagram', 'useDiagramSurface.ts'),
    ];

    const offenders = scopedFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const problems: string[] = [];
      if (/(?:\.\.\/)+model\//.test(source)) {
        problems.push('imports model internals');
      }
      if (/(?:\.\.\/)+util\/serialization/.test(source)) {
        problems.push('imports util/serialization directly');
      }
      return problems.length > 0
        ? [`${normalizePath(path.relative(projectRoot, file))}: ${problems.join(', ')}`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps bundled built-in starter/schema loading inside semantic bootstrap boundaries', () => {
    const builtInRawImportPattern =
      /data\/starters\/starter\.yaml\?raw|schemas\/[^'"]+\.yaml\?raw|import\.meta\.glob\(\s*['"][^'"]*schemas\/\*\.yaml['"][\s\S]*?query:\s*['"]\?raw['"]/;
    const galleryGlobPattern = /galleryassets\/curated\/\*\.yaml['"][\s\S]*?query:\s*['"]\?raw['"]/;

    const offenders = collectFiles(srcRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      if (galleryGlobPattern.test(source)) {
        return [`${normalizePath(path.relative(projectRoot, file))}: imports all gallery YAML`];
      }
      if (!builtInRawImportPattern.test(source)) {
        return [];
      }
      const relativePath = normalizePath(path.relative(projectRoot, file));
      return relativePath === 'src/semantic/bootstrap.ts' ||
        relativePath === 'src/semantic/bundled-diagrams.ts'
        ? []
        : [relativePath];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps semantic bootstrap off the runtime bundled-schema validation path', () => {
    const bootstrapPath = path.join(srcRoot, 'semantic', 'bootstrap.ts');
    const source = readFileSync(bootstrapPath, 'utf8');

    expect(source).not.toMatch(/parseAndValidateSchemaModule/);
  });

  it('keeps generic tree helpers in semantic tree rather than canvas', () => {
    const legacyCanonicalTreePath = path.join(
      srcRoot,
      'canvas',
      'rendering',
      'tree',
      'canonical-tree.ts',
    );
    expect(existsSync(legacyCanonicalTreePath)).toBe(false);

    const offenders = collectFiles(path.join(srcRoot, 'canvas')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      if (!/rendering\/tree\/(?:tree|canonical-tree)/.test(source)) {
        return [];
      }
      return [normalizePath(path.relative(projectRoot, file))];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps semantic-view compilation out of canvas layout files', () => {
    const layoutFiles = collectFiles(path.join(srcRoot, 'canvas', 'rendering', 'layout'));
    const semanticViewCompilerPattern =
      /\b(?:compileDiagramViewTree|buildRevealedEntityTree|buildEntityTree|collectSingleChildChainDown)\b/;

    const offenders = layoutFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      if (!semanticViewCompilerPattern.test(source)) {
        return [];
      }
      return [normalizePath(path.relative(projectRoot, file))];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps presentation input at the scene boundary instead of reopening graph model access', () => {
    const presentationPath = path.join(
      srcRoot,
      'canvas',
      'rendering',
      'presentation',
      'presentation.ts',
    );
    const source = readFileSync(presentationPath, 'utf8');

    expect(source).not.toMatch(/graph-model|GraphModel/);
    expect(source).not.toMatch(/\bgraph:/);
  });

  it('keeps document layout state out of the layout engine input contract', () => {
    const layoutPipelinePath = path.join(
      srcRoot,
      'canvas',
      'rendering',
      'layout',
      'layout-pipeline.ts',
    );
    const source = readFileSync(layoutPipelinePath, 'utf8');

    expect(source).not.toMatch(/DocumentLayout/);
    expect(source).not.toMatch(/\blayout\?:/);
  });

  it('keeps raw graph/document structure out of rendering modules after view compilation', () => {
    const renderingRoot = path.join(srcRoot, 'canvas', 'rendering');
    const allowedFiles = new Set([
      normalizePath(
        path.relative(projectRoot, path.join(renderingRoot, 'graph', 'graph-model.ts')),
      ),
    ]);
    const forbiddenPatterns = [
      /graph\.entities\b/,
      /graph\.entityMap\b/,
      /graph\.childrenByParent\b/,
      /graph\.parentById\b/,
      /graph\.topLevelIds\b/,
      /graph\.topLevelEntities\b/,
      /graph\.doc\.relations\b/,
      /\bdoc\.relations\b/,
    ];

    const offenders = collectFiles(renderingRoot).flatMap((file) => {
      const relativePath = normalizePath(path.relative(projectRoot, file));
      if (allowedFiles.has(relativePath)) {
        return [];
      }
      const source = readFileSync(file, 'utf8');
      const matches = forbiddenPatterns.filter((pattern) => pattern.test(source)).map(String);
      return matches.length > 0 ? [`${relativePath}: ${matches.join(', ')}`] : [];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps raw viewport adapter calls out of shell, surface, and transition orchestration', () => {
    const scopedFiles = [
      path.join(srcRoot, 'shell', 'useAppShellController.tsx'),
      path.join(srcRoot, 'shell', 'useShellDiagramActions.ts'),
      path.join(srcRoot, 'canvas', 'useCanvasSurfaceController.tsx'),
      path.join(srcRoot, 'canvas', 'useCanvasTransitionController.ts'),
    ];
    const forbiddenPatterns = [
      /scheduleFitView\b/,
      /scheduleFitViewToNodes\b/,
      /setCameraViewport\b/,
      /consumePendingFitView\b/,
    ];

    const offenders = scopedFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const matches = forbiddenPatterns.filter((pattern) => pattern.test(source)).map(String);
      return matches.length > 0
        ? [`${normalizePath(path.relative(projectRoot, file))}: ${matches.join(', ')}`]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
