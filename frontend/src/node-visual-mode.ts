export const NODE_VISUAL_MODE_OPTIONS = [
  {
    value: 'default',
    label: 'Default',
    shortLabel: 'Default',
    description: 'Fill nodes with their regular backgrounds.',
  },
  {
    value: 'outline',
    label: 'Outline only',
    shortLabel: 'Outline',
    description: 'Keep the normal canvas and show node color through the outline only.',
  },
  {
    value: 'transparent',
    label: 'Blueprint',
    shortLabel: 'Blueprint',
    description: 'Swap in the blueprint canvas and line-drawing palette.',
  },
] as const;

export type NodeVisualMode = (typeof NODE_VISUAL_MODE_OPTIONS)[number]['value'];

export const isNodeVisualMode = (value: string | null | undefined): value is NodeVisualMode =>
  value === 'default' || value === 'outline' || value === 'transparent';

export const getNodeVisualModeOption = (mode: NodeVisualMode) =>
  NODE_VISUAL_MODE_OPTIONS.find((option) => option.value === mode) ?? NODE_VISUAL_MODE_OPTIONS[0];
