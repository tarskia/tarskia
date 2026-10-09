import type { CanvasNodeData, CanvasNodeProps } from '../../canvas-types';
import { EntityNodeView } from './EntityNodeView';

export function EntityNode({ id, data }: CanvasNodeProps<CanvasNodeData>) {
  return <EntityNodeView id={id} view={data.view} />;
}
