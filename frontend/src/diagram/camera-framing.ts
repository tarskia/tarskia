import type { DiagramCamera, ViewportState } from '@tarskia/diagram-semantics';
import type { CanvasSize } from './canvas-size';
import type { DiagramCameraRect } from './motion-types';

export interface CameraAnchorBox {
  id: string;
  parentId?: string;
  rect: DiagramCameraRect;
}

/** The caller measures the actual canvas, which already excludes any inspector. */
export function captureDiagramCamera(params: {
  viewport: ViewportState;
  canvasSize: CanvasSize;
  nodes: readonly CameraAnchorBox[];
  scopeRootId?: string;
  scopeRootBounds?: DiagramCameraRect | null;
}): DiagramCamera | undefined {
  const { viewport, canvasSize, nodes, scopeRootId, scopeRootBounds } = params;
  if (
    ![canvasSize.width, canvasSize.height, viewport.x, viewport.y, viewport.zoom].every(
      Number.isFinite,
    ) ||
    canvasSize.width <= 0 ||
    canvasSize.height <= 0 ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom <= 0
  )
    return undefined;
  const rect = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: canvasSize.width / viewport.zoom,
    height: canvasSize.height / viewport.zoom,
  };
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = (node: CameraAnchorBox) => {
    const visited = new Set<string>();
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    return visited.size;
  };
  const containing = nodes.filter(
    ({ rect: box }) =>
      centre.x >= box.x &&
      centre.x <= box.x + box.width &&
      centre.y >= box.y &&
      centre.y <= box.y + box.height,
  );
  containing.sort(
    (a, b) =>
      depth(b) - depth(a) ||
      a.rect.width * a.rect.height - b.rect.width * b.rect.height ||
      a.id.localeCompare(b.id),
  );
  const anchor =
    containing[0] ??
    (scopeRootId
      ? (byId.get(scopeRootId) ??
        (scopeRootBounds ? { id: scopeRootId, rect: scopeRootBounds } : undefined))
      : undefined);
  return anchor
    ? {
        anchorId: anchor.id,
        rect: { ...rect, x: rect.x - anchor.rect.x, y: rect.y - anchor.rect.y },
      }
    : { rect };
}

/** Fit the entire saved rectangle, centred and with no additional padding. */
export function restoreDiagramCamera(params: {
  camera: DiagramCamera;
  canvasSize: CanvasSize | null;
  sceneBounds: DiagramCameraRect | null;
  scopeRootId?: string;
  getNodeBounds: (id: string) => DiagramCameraRect | null;
  minZoom: number;
  maxZoom: number;
}): ViewportState | null {
  const { camera, canvasSize, sceneBounds, scopeRootId, getNodeBounds, minZoom, maxZoom } = params;
  if (!canvasSize || canvasSize.width <= 0 || canvasSize.height <= 0) return null;
  const scope = scopeRootId ? (getNodeBounds(scopeRootId) ?? sceneBounds) : null;
  const anchor = camera.anchorId
    ? (getNodeBounds(camera.anchorId) ?? (camera.anchorId === scopeRootId ? scope : null))
    : null;
  const rect = camera.anchorId
    ? anchor
      ? { ...camera.rect, x: anchor.x + camera.rect.x, y: anchor.y + camera.rect.y }
      : (scope ?? sceneBounds)
    : camera.rect;
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const zoom = Math.min(
    maxZoom,
    Math.max(minZoom, Math.min(canvasSize.width / rect.width, canvasSize.height / rect.height)),
  );
  return {
    x: canvasSize.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: canvasSize.height / 2 - (rect.y + rect.height / 2) * zoom,
    zoom,
  };
}
