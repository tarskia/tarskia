// @vitest-environment happy-dom
import { act, Profiler, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { loadGallery } from '../test/curated-rendering';
import type { CanvasCamera } from './camera';
import type { CanvasNodeProps } from './canvas-types';
import { DiagramCanvas } from './DiagramCanvas';
import { buildCanvasRenderState } from './node-presentation';

let nodeCommits = 0;
let edgeCommits = 0;
vi.mock('./DiagramRenderer', async () => {
  const actual = await vi.importActual<typeof import('./DiagramRenderer')>('./DiagramRenderer');
  const { Profiler } = await import('react');
  return {
    DiagramRenderer: (props: React.ComponentProps<typeof actual.DiagramRenderer>) => (
      <Profiler id="edges" onRender={() => edgeCommits++}>
        <div>
          <actual.DiagramRenderer {...props} />
          <svg aria-hidden="true">
            <path data-relation-id="test-relation" />
          </svg>
          <button type="button" data-relation-id="label-relation">
            Label
          </button>
          <button type="button" data-relation-id="disabled-relation" disabled>
            Disabled
          </button>
        </div>
      </Profiler>
    ),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const bindings = {
  onZoomTrigger: () => false,
  onExpandDetails: () => {},
  onCollapseDetails: () => {},
  onExpandChildGroups: () => {},
  onCollapseChildGroups: () => {},
  onEdgeLabelClick: () => {},
};
const gallery = loadGallery('n8n.yaml');
const { nodes, overlayEdges } = buildCanvasRenderState({
  presentation: gallery.render().presentation,
  bindings,
});
const TestNode = ({ data }: CanvasNodeProps) => (
  <Profiler id="node" onRender={() => nodeCommits++}>
    <span>{data.view.content.label}</span>
  </Profiler>
);
const nodeTypes = { entityNode: TestNode, groupNode: TestNode };

it('moves the shared world synchronously without a node or edge React commit during pan', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let camera: CanvasCamera | undefined;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const ref = useRef<HTMLDivElement | null>(null);
    const [, setPhase] = useState('idle');
    const measure = useCallback((element: HTMLDivElement | null) => {
      if (element) {
        Object.defineProperty(element, 'clientWidth', { value: 1000, configurable: true });
        Object.defineProperty(element, 'clientHeight', { value: 700, configurable: true });
      }
    }, []);
    return (
      <DiagramCanvas
        canvasRef={ref}
        onCanvasElementChange={measure}
        nodeVisualMode="outline"
        nodes={nodes}
        overlayEdges={overlayEdges}
        nodeTypes={nodeTypes}
        onNodeClick={() => {}}
        onInit={(value) => {
          camera = value;
        }}
        onPaneClick={() => {}}
        onMove={() => setPhase('gesture')}
        onMoveEnd={() => setPhase('idle')}
        minZoom={0.05}
        maxZoom={2}
        showDebug={false}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  const host = container.querySelector<HTMLElement>('.canvas-host')!;
  const beforeNodes = nodeCommits,
    beforeEdges = edgeCommits;
  await act(async () => {
    host.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        view: window,
      }),
    );
    for (let i = 1; i <= 12; i++)
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: 100 + i * 4,
          clientY: 100 + i * 2,
          view: window,
        }),
      );
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        clientX: 148,
        clientY: 124,
        view: window,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(camera?.getViewport()).toEqual({ x: 48, y: 24, zoom: 1 });
  expect(container.querySelector<HTMLElement>('.canvas-world')?.style.transform).toBe(
    'translate(48px, 24px) scale(1)',
  );
  expect(nodeCommits - beforeNodes).toBe(0);
  expect(edgeCommits - beforeEdges).toBe(0);
  await act(async () => root.unmount());
});

it('uses delegated Tab, Enter, Space, Escape and relation selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const select = vi.fn(),
    clear = vi.fn(),
    relation = vi.fn(),
    label = vi.fn();
  await act(async () =>
    root.render(
      <DiagramCanvas
        canvasRef={{ current: null }}
        nodeVisualMode="outline"
        nodes={nodes}
        overlayEdges={overlayEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => select(node.id)}
        onInit={() => {}}
        onPaneClick={clear}
        overlayInteractionBindings={{ onSelectEdge: relation, onEdgeLabelClick: label }}
        onMove={() => {}}
        onMoveEnd={() => {}}
        minZoom={0.05}
        maxZoom={2}
        showDebug={false}
      />,
    ),
  );
  const elements = [...container.querySelectorAll<HTMLElement>('.canvas-node.selectable')];
  elements[0].focus();
  await act(async () =>
    elements[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(elements[1]);
  expect(elements.filter((element) => element.tabIndex === 0)).toHaveLength(1);
  for (const key of ['Enter', ' '])
    await act(async () =>
      elements[1].dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      ),
    );
  expect(select.mock.calls.map((call) => call[0])).toEqual([nodes[1].id, nodes[1].id]);
  await act(async () =>
    elements[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(clear).toHaveBeenCalledWith(true);
  // Union records remain mounted while entering/exiting; roving focus skips invisible frames.
  elements[2].style.display = 'none';
  elements[3].style.opacity = '0';
  elements[4].style.pointerEvents = 'none';
  await act(async () =>
    elements[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(elements[5]);
  await act(async () =>
    elements[5].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(elements[1]);
  await act(async () =>
    container
      .querySelector('[data-relation-id="test-relation"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  expect(relation).toHaveBeenCalledWith('test-relation');
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-relation-id="label-relation"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-relation-id="disabled-relation"]')?.click();
  });
  expect(label.mock.calls).toEqual([['label-relation']]);
  await act(async () => root.unmount());
});
