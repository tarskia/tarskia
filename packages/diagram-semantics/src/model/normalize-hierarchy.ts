import { type Diagnostic, diagramDiagnostic } from './diagnostics';
import type { Entity, SemanticDocument } from './types';

/** Normalize legacy parent references without changing the caller's document. */
export function normalizeDocumentHierarchy<T extends Pick<SemanticDocument, 'entities'>>(
  doc: T,
): {
  doc: T;
  diagnostics: Diagnostic[];
} {
  const entries: { entity: Entity; parentId?: string }[] = [];
  const byId = new Map<string, (typeof entries)[number]>();
  const diagnostics: Diagnostic[] = [];
  const visit = (entity: Entity, nestedParent?: string) => {
    const { parent, children, ...fields } = entity;
    const entry = {
      entity: { ...fields, ...(children ? { children: [] as Entity[] } : {}) },
      parentId: nestedParent ?? parent,
    };
    entries.push(entry);
    if (!byId.has(entity.id)) byId.set(entity.id, entry);
    for (const child of children ?? []) visit(child, entity.id);
  };
  for (const entity of doc.entities) visit(entity);
  const reject = (entry: (typeof entries)[number], code: string, message: string) => {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'error',
        code,
        entityId: entry.entity.id,
        targetId: entry.parentId,
        message,
      }),
    );
    entry.parentId = undefined;
  };
  for (const entry of entries) {
    if (entry.parentId === undefined) continue;
    if (entry.parentId === entry.entity.id) {
      reject(
        entry,
        'diagram.document.self_parent',
        `Entity ${entry.entity.id} cannot be its own parent`,
      );
    } else if (!byId.has(entry.parentId)) {
      reject(
        entry,
        'diagram.document.parent_not_found',
        `Entity ${entry.entity.id} references missing parent ${entry.parentId}`,
      );
    }
  }
  // A node has at most one parent. Detach every member of each cycle, not just
  // whichever member happened to be visited first; all remain visible roots.
  const completed = new Set<string>();
  for (const entry of entries) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = entry.entity.id;
    while (current !== undefined && !completed.has(current)) {
      const cycleStart = positions.get(current);
      if (cycleStart !== undefined) {
        for (const id of path.slice(cycleStart)) {
          const cyclic = byId.get(id);
          if (cyclic)
            reject(
              cyclic,
              'diagram.document.parent_cycle',
              `Entity ${id} participates in a parent cycle`,
            );
        }
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = byId.get(current)?.parentId;
    }
    for (const id of path) completed.add(id);
  }
  const entities: Entity[] = [];
  for (const entry of entries) {
    const parent = entry.parentId !== undefined ? byId.get(entry.parentId)?.entity : undefined;
    if (parent) {
      parent.children ??= [];
      parent.children.push(entry.entity);
    } else entities.push(entry.entity);
  }
  return { doc: { ...doc, entities }, diagnostics };
}
