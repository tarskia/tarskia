import type { CanvasNodeData, CanvasNodeProps } from '../../canvas-types';
import { GroupNodeView } from './GroupNodeView';

export function GroupNode({ id, data }: CanvasNodeProps<CanvasNodeData>) {
  return (
    <GroupNodeView id={id} view={data.view} bindings={data.bindings} controls={data.controls} />
  );
}
