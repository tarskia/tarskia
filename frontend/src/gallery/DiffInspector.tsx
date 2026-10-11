import type {
  SemanticDiagramEntityDiff,
  SemanticDiagramRelationDiff,
  SemanticDocument,
} from '@tarskia/diagram-semantics';

export function DiffInspector({
  entry,
  before,
}: {
  entry?: SemanticDiagramEntityDiff | SemanticDiagramRelationDiff;
  before: SemanticDocument;
}) {
  if (!entry || entry.change === 'unchanged') return null;
  const names = new Map<string, string>();
  const visit = (entities: SemanticDocument['entities']) => {
    for (const entity of entities) {
      names.set(entity.id, entity.name ?? entity.id);
      visit(entity.children ?? []);
    }
  };
  visit(before.entities);
  const format = (value: unknown) =>
    value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
  const snapshot = (side: 'before' | 'after', field: string) =>
    (entry[side] as unknown as Record<string, unknown> | undefined)?.[field];
  return (
    <section className="border-b border-border p-5 text-sm overflow-auto">
      {entry.change === 'added' ? (
        <p>Added</p>
      ) : entry.change === 'removed' ? (
        <p>Removed</p>
      ) : (
        <>
          {entry.changedFields.includes('parent' as never) ? (
            <p className="mb-3">
              Moved from{' '}
              {names.get(String(snapshot('before', 'parent'))) ??
                (snapshot('before', 'parent') as string) ??
                'root'}
            </p>
          ) : null}
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Field</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {entry.changedFields
                .filter((field) => field !== 'parent')
                .map((field) => (
                  <tr key={field}>
                    <th className="align-top pr-2 font-normal">{field}</th>
                    <td className="align-top break-all pr-2">
                      {format(snapshot('before', field))}
                    </td>
                    <td className="align-top break-all">{format(snapshot('after', field))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
