export interface FocusShellDescriptor {
  id: string;
  depth: number;
  displayName: string;
  typeLabel: string;
  hue?: number;
  isRoot?: boolean;
}

export function collapseFocusShellDescriptors(
  shells: FocusShellDescriptor[],
): FocusShellDescriptor[] {
  if (shells.length <= 2) {
    return shells;
  }
  const [outer] = shells;
  const inner = shells[shells.length - 1];
  if (!outer || !inner) {
    return shells;
  }
  return [
    { ...outer, depth: 0, isRoot: true },
    { ...inner, depth: 1, isRoot: false },
  ];
}
