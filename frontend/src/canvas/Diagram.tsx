import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';

export type DiagramProps = DiagramCanvasProps;

export default function Diagram(props: DiagramProps) {
  return <DiagramCanvas {...props} />;
}
