import type { NodeProps } from 'reactflow';
import type { ReactFlowHostNodeData } from '../../host/reactflow/types';
import { GroupNodeView } from './GroupNodeView';

export function GroupNode({ id, data }: NodeProps<ReactFlowHostNodeData>) {
  return (
    <GroupNodeView id={id} view={data.view} bindings={data.bindings} controls={data.controls} />
  );
}
