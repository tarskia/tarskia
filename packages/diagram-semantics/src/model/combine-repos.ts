import { type Diagnostic, diagramDiagnostic } from './diagnostics';
import {
  compileSourceGraph,
  createMapSourceGraphResolver,
  NAMESPACE_SEGMENT_PATTERN,
} from './source-graph';
import type { Entity, Relation, SemanticDocument } from './types';

export interface RepoDiagramFiles {
  name: string;
  diagramPath: string;
  schemaPaths: string[];
}

/** Paths are relative to the opened folder; directory markers may identify empty .tarskia folders. */
export function pickRepoDiagramFiles(paths: string[]): RepoDiagramFiles[] {
  const normalized = [
    ...new Set(paths.map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))),
  ];
  const ownRepo = normalized.some((file) => file === '.tarskia' || file.startsWith('.tarskia/'));
  const pattern = ownRepo ? /^\.tarskia\/[^/]+\.yaml$/ : /^[^/]+\/\.tarskia\/[^/]+\.yaml$/;
  const files = normalized.filter((file) => pattern.test(file)).sort();
  return files
    .filter((file) => !file.endsWith('.schema.yaml'))
    .map((diagramPath) => {
      const directory = diagramPath.slice(0, diagramPath.lastIndexOf('/') + 1);
      return {
        name: diagramPath.slice(directory.length, -5),
        diagramPath,
        schemaPaths: files.filter(
          (file) => file.startsWith(directory) && file.endsWith('.schema.yaml'),
        ),
      };
    });
}

export function combineRepoDiagrams(params: {
  name: string;
  diagrams: { name: string; raw: string }[];
}): { doc?: SemanticDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const report = (
    code: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
    entityId?: string,
  ) => {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'resolution',
        severity,
        code: `diagram.combine.${code}`,
        message,
        entityId,
      }),
    );
  };
  const names = new Set<string>();
  for (const { name } of params.diagrams) {
    if (!NAMESPACE_SEGMENT_PATTERN.test(name))
      report('invalid_name', `Invalid repo diagram name: ${name}`);
    if (names.has(name)) report('duplicate_name', `Duplicate repo diagram name: ${name}`);
    names.add(name);
  }
  if (diagnostics.length) return { diagnostics };
  const compiled = compileSourceGraph({
    sourceLabel: params.name,
    source: {
      version: '1',
      metadata: { name: params.name },
      schemaRefs: [],
      entities: [],
      relations: [],
      imports: params.diagrams.map(({ name }) => ({ slug: name, namespace: name })),
    },
    resolver: createMapSourceGraphResolver(
      Object.fromEntries(params.diagrams.map(({ name, raw }) => [name, raw])),
    ),
  });
  diagnostics.push(...compiled.diagnostics);
  if (!compiled.result) return { diagnostics };
  const doc = compiled.result.doc;
  const entities = new Map<string, Entity>();
  const visit = (items: Entity[]) =>
    items.forEach((entity) => {
      entities.set(entity.id, entity);
      visit(entity.children ?? []);
    });
  visit(doc.entities);
  const parents = new Set([...entities.values()].map((entity) => entity.parent));
  const resolved = new Map<string, string>();
  const resolving = new Set<string>();
  const resolve = (id: string): string => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (resolving.has(id)) {
      report('represents_cycle', `Cross-repo represents cycle at ${id}`, 'error', id);
      return id;
    }
    resolving.add(id);
    const entity = entities.get(id)!;
    let target = id;
    if (entity.represents !== undefined) {
      if (
        typeof entity.represents !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*\/[^/\s]+$/.test(entity.represents)
      ) {
        report('invalid_represents', `Entity ${id} represents must be <name>/<id>`, 'error', id);
      } else if (entity.children?.length || parents.has(id)) {
        report(
          'represents_has_children',
          `Entity ${id} with represents cannot have children`,
          'error',
          id,
        );
      } else if (entities.has(entity.represents)) {
        target = resolve(entity.represents);
      } else if (names.has(entity.represents.split('/')[0])) {
        report(
          'represents_target_missing',
          `Entity ${id} represents missing target ${entity.represents}`,
          'warning',
          id,
        );
      }
    }
    resolving.delete(id);
    resolved.set(id, target);
    return target;
  };
  for (const id of entities.keys()) resolve(id);
  if (diagnostics.some((item) => item.severity === 'error')) return { diagnostics };
  const prune = (items: Entity[]): Entity[] =>
    items
      .filter((entity) => resolved.get(entity.id) === entity.id)
      .map((entity) => ({
        ...entity,
        ...(entity.children ? { children: prune(entity.children) } : {}),
      }));
  const groups = new Map<string, { repo: string; relation: Relation }[]>();
  for (const relation of doc.relations) {
    const redirected = {
      ...relation,
      from: resolved.get(relation.from) ?? relation.from,
      to: resolved.get(relation.to) ?? relation.to,
    };
    if (redirected.from === redirected.to && relation.from !== relation.to) continue;
    const key = JSON.stringify([redirected.from, redirected.to, redirected.type]);
    const group = groups.get(key) ?? [];
    group.push({ repo: relation.id.split('/')[0], relation: redirected });
    groups.set(key, group);
  }
  const relations: Relation[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map(({ repo }) => repo)).size === 1) {
      relations.push(...group.map(({ relation }) => relation));
      continue;
    }
    const owner = group[0].relation.from.split('/')[0];
    const chosen = group.find(({ repo }) => repo === owner) ?? group[0];
    const locations = group.flatMap(({ relation }) => relation.provenance?.locations ?? []);
    const uniqueLocations = [
      ...new Map(locations.map((location) => [JSON.stringify(location), location])).values(),
    ];
    relations.push({
      ...chosen.relation,
      ...(uniqueLocations.length
        ? { provenance: { ...chosen.relation.provenance, locations: uniqueLocations } }
        : {}),
    });
  }
  return { doc: { ...doc, entities: prune(doc.entities), relations }, diagnostics };
}
