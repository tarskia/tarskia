import type { NodeProps } from 'reactflow';
import type { ReactFlowHostNodeData } from '../../host/reactflow/types';
import { EntityNodeView } from './EntityNodeView';

export function EntityNode({ id, data }: NodeProps<ReactFlowHostNodeData>) {
  return <EntityNodeView id={id} view={data.view} />;
}
