import { expect, test } from 'vitest';
import { galleryFiles, loadGallery } from '../../../test/curated-rendering';
import { edgeLabelRect, rectanglesIntersect, resolveEntityCards } from './edge-routing';

for (const { file } of galleryFiles)
  test(`routing boxes and default trunks: ${file}`, () => {
    const gallery = loadGallery(file);
    const failures: string[] = [];
    for (const expanded of [false, true]) {
      const { presentation } = gallery.render(
        expanded ? gallery.graph.entities.map((e) => e.id) : undefined,
      );
      const labeled = presentation.overlayEdges.filter((edge) => !edge.hideLabel);
      for (const [index, edge] of labeled.entries()) {
        const box = edgeLabelRect(edge);
        for (const other of labeled.slice(index + 1))
          if (rectanglesIntersect(box, edgeLabelRect(other)))
            failures.push(`${expanded}: labels ${edge.id} / ${other.id}`);
        for (const node of resolveEntityCards(presentation.nodes).filter(
          (n) => n.id !== edge.sourceId && n.id !== edge.targetId,
        )) {
          if (rectanglesIntersect(box, node.rect))
            failures.push(`${expanded}: label ${edge.id} inside ${node.id}`);
          const { sourcePoint: a, targetPoint: b, control1 } = edge.geometry;
          if (
            !expanded &&
            control1.x > node.rect.x &&
            control1.x < node.rect.x + node.rect.width &&
            Math.max(a.y, b.y) > node.rect.y &&
            Math.min(a.y, b.y) < node.rect.y + node.rect.height
          )
            failures.push(`trunk ${edge.id} inside ${node.id}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 20000);
