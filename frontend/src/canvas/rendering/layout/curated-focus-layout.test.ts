import { expect, test } from 'vitest';
import { galleryFiles, loadGallery } from '../../../test/curated-rendering';
import { canFocusSceneNode } from '../../../viewer-core/focus-view';

// Each case lays out every container in three view states; large galleries need more than 5s.
test.each(galleryFiles)('$file focuses every container with full-size, nonoverlapping cards', ({
  file,
}) => {
  const gallery = loadGallery(file);
  const ids = gallery.graph.entities.map((entity) => entity.id);
  const expanded = gallery.render(ids);
  const containers = [...expanded.scene.tree.byId.values()].filter(
    (node) => node.id !== expanded.scene.tree.rootId && node.hasChildren,
  );
  expect(containers.length).toBeGreaterThan(0);
  for (const container of containers) {
    const collapsed = gallery.render(ids.filter((id) => id !== container.id));
    for (const scene of [expanded.scene, collapsed.scene]) {
      expect(
        canFocusSceneNode({ sceneTree: scene.tree, entityId: container.id }),
        container.id,
      ).toBe(true);
      expect(scene.tree.byId.get(container.id)?.isListContainer).toBe(container.isListContainer);
    }
    const focused = gallery.render([], container.id);
    const cards = focused.presentation.nodes.filter((node) => !node.parentId);
    expect(cards.length, container.id).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.content.listMode, card.id).toBe(false);
      expect(card.rect.height, card.id).toBeGreaterThanOrEqual(48);
      expect(card.rect.height, card.id).toBeGreaterThanOrEqual(
        focused.scene.tree.byId.get(card.id)!.baseSize.height,
      );
    }
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i].rect;
        const b = cards[j].rect;
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `${container.id}: ${cards[i].id} overlaps ${cards[j].id}`,
        ).toBe(true);
      }
    }
  }
}, 20_000);
