import { describe, expect, it } from 'vitest';

import { collapseFocusShellDescriptors, type FocusShellDescriptor } from './focus-shells';

function createShell(id: string, depth: number): FocusShellDescriptor {
  return {
    id,
    depth,
    displayName: id,
    typeLabel: `Type ${depth}`,
    hue: 24,
    isRoot: depth === 0,
  };
}

describe('collapseFocusShellDescriptors', () => {
  it('keeps a single shell unchanged', () => {
    const shells = [createShell('ordersdb', 0)];

    expect(collapseFocusShellDescriptors(shells)).toEqual(shells);
  });

  it('keeps two shells unchanged', () => {
    const shells = [createShell('ordersdb', 0), createShell('table-group', 1)];

    expect(collapseFocusShellDescriptors(shells)).toEqual(shells);
  });

  it('collapses longer chains to the outer and deepest shells', () => {
    const shells = [
      createShell('ordersdb', 0),
      createShell('database', 1),
      createShell('table-group', 2),
      createShell('core-tables', 3),
    ];

    expect(collapseFocusShellDescriptors(shells)).toEqual([
      {
        ...shells[0],
        depth: 0,
        isRoot: true,
      },
      {
        ...shells[3],
        depth: 1,
        isRoot: false,
      },
    ]);
  });
});
