import { layoutGraph } from '../../layout/layout';
import type { ResolvedNodeRichContent } from '../visual/node-visuals';
import { DEFAULT_NODE_SIZE } from './defaults';

const GROUP_HEADER_BASE = 52;
const GROUP_PROP_LINE = 15;
const GROUP_PROP_GAP = 2;
const GROUP_META_GAP = 6;
// These values must track the real CSS dimensions in `styles.css`:
// - `.node-meta-bar` (height = 22px content + 2px border)
// Under-estimating causes bottom clipping when nodes are collapsed.
const GROUP_META_BAR_HEIGHT = 24;
// Reserve breathing room below the meta bar so child cards do not sit flush
// against the controls after expansion.
const GROUP_META_BOTTOM_GAP = 14;
const GROUP_META_TEXT_CHAR = 7;
const GROUP_META_MIN_TEXT = 48;
const GROUP_META_TEXT_PAD_X = 16; // text cell horizontal padding
const GROUP_META_STEP_WIDTH = 22; // step (+/-) cell width
const GROUP_META_MENU_WIDTH = 22; // menu trigger cell width
const GROUP_META_BORDER = 2;
const LIST_PADDING = 6;
const LIST_TYPE_LINE = 10;
const LIST_NAME_LINE = 14;
const LIST_PROP_LINE = 12;
const LIST_LINE_GAP = 2;
const LIST_PROP_GAP = 2;
const LIST_SECTION_GAP = 2;
const CONTENT_TEXT_CHAR = 8;
const CONTENT_TEXT_LINE = 17;
const CONTENT_TEXT_GAP = 8;
const CONTENT_HEADER_HEIGHT = 46;
const CONTENT_IMAGE_MIN = 120;
const CONTENT_IMAGE_MAX = 196;
const CONTENT_IMAGE_CAPTION = 22;
const CONTENT_LIST_GAP = 4;
const CONTENT_LIST_INDENT = 16;
const LEAF_SUBTITLE_HEIGHT = 14;
const LEAF_TITLE_HEIGHT = 18;
const LEAF_SECTION_GAP = 6;
const LEAF_PROP_LINE = 14;
const LEAF_PROP_GAP = 2;
const LEAF_HEADER_GAP = 4;
const LEAF_COUNT_HEIGHT = 14;

export const LIST_MAX_PROPS = 2;

export interface LocalNodeContentOccluder {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pushOccluder = (
  occluders: LocalNodeContentOccluder[],
  rect: LocalNodeContentOccluder,
  bounds: { width: number; height: number },
) => {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.height, rect.y + rect.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) {
    return;
  }
  occluders.push({ x, y, width, height });
};

const resolveListContentOccluders = (params: {
  size: { width: number; height: number };
  propCount: number;
  showType: boolean;
}) => {
  const width = Math.max(params.size.width - LIST_PADDING * 2, 0);
  if (width <= 0) {
    return [];
  }
  const occluders: LocalNodeContentOccluder[] = [];
  let cursorY = LIST_PADDING;
  if (params.showType) {
    pushOccluder(
      occluders,
      { x: LIST_PADDING, y: cursorY, width, height: LIST_TYPE_LINE },
      params.size,
    );
    cursorY += LIST_TYPE_LINE + LIST_LINE_GAP;
  }
  pushOccluder(
    occluders,
    { x: LIST_PADDING, y: cursorY, width, height: LIST_NAME_LINE },
    params.size,
  );
  cursorY += LIST_NAME_LINE;
  if (params.propCount > 0) {
    cursorY += LIST_SECTION_GAP;
    const propsHeight = params.propCount * LIST_PROP_LINE + (params.propCount - 1) * LIST_PROP_GAP;
    pushOccluder(
      occluders,
      { x: LIST_PADDING, y: cursorY, width, height: propsHeight },
      params.size,
    );
  }
  return occluders;
};

const resolveLeafContentOccluders = (params: {
  size: { width: number; height: number };
  padding: number;
  badgeCount: number;
  hasSummary: boolean;
  hasLabel: boolean;
  richContent?: ResolvedNodeRichContent;
}) => {
  const width = Math.max(params.size.width - params.padding * 2, 0);
  if (width <= 0) {
    return [];
  }
  const occluders: LocalNodeContentOccluder[] = [];
  let cursorY = params.padding;

  if (params.richContent) {
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: CONTENT_HEADER_HEIGHT },
      params.size,
    );
    cursorY += CONTENT_HEADER_HEIGHT;
    const summaryAllowance = params.hasSummary ? LEAF_SECTION_GAP + LEAF_COUNT_HEIGHT : 0;
    const bodyHeight = Math.max(
      params.size.height - params.padding - cursorY - summaryAllowance,
      0,
    );
    if (bodyHeight > 0) {
      pushOccluder(
        occluders,
        { x: params.padding, y: cursorY, width, height: bodyHeight },
        params.size,
      );
      cursorY += bodyHeight;
    }
    if (params.hasSummary) {
      cursorY += LEAF_SECTION_GAP;
      pushOccluder(
        occluders,
        { x: params.padding, y: cursorY, width, height: LEAF_COUNT_HEIGHT },
        params.size,
      );
    }
    return occluders;
  }

  pushOccluder(
    occluders,
    { x: params.padding, y: cursorY, width, height: LEAF_SUBTITLE_HEIGHT },
    params.size,
  );
  cursorY += LEAF_SUBTITLE_HEIGHT;
  if (params.hasLabel) {
    cursorY += LEAF_HEADER_GAP;
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: LEAF_TITLE_HEIGHT },
      params.size,
    );
    cursorY += LEAF_TITLE_HEIGHT;
  }
  if (params.badgeCount > 0) {
    cursorY += LEAF_SECTION_GAP;
    const propsHeight =
      params.badgeCount * LEAF_PROP_LINE + (params.badgeCount - 1) * LEAF_PROP_GAP;
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: propsHeight },
      params.size,
    );
    cursorY += propsHeight;
  }
  if (params.hasSummary) {
    cursorY += LEAF_SECTION_GAP;
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: LEAF_COUNT_HEIGHT },
      params.size,
    );
  }
  return occluders;
};

const resolveGroupContentOccluders = (params: {
  size: { width: number; height: number };
  padding: number;
  badgeCount: number;
  showZoomControls: boolean;
  showDetailControls: boolean;
  showChildGroupControls: boolean;
  hasSummary: boolean;
}) => {
  const width = Math.max(params.size.width - params.padding * 2, 0);
  if (width <= 0) {
    return [];
  }
  const occluders: LocalNodeContentOccluder[] = [];
  let cursorY = params.padding;
  pushOccluder(
    occluders,
    { x: params.padding, y: cursorY, width, height: GROUP_HEADER_BASE },
    params.size,
  );
  cursorY += GROUP_HEADER_BASE;

  if (params.badgeCount > 0) {
    cursorY += GROUP_META_GAP;
    const propsHeight =
      params.badgeCount * GROUP_PROP_LINE + (params.badgeCount - 1) * GROUP_PROP_GAP;
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: propsHeight },
      params.size,
    );
    cursorY += propsHeight;
  }

  if (
    params.hasSummary ||
    params.showZoomControls ||
    params.showDetailControls ||
    params.showChildGroupControls
  ) {
    cursorY += GROUP_META_GAP;
    pushOccluder(
      occluders,
      { x: params.padding, y: cursorY, width, height: GROUP_META_BAR_HEIGHT },
      params.size,
    );
  }

  return occluders;
};

export function resolveNodeContentOccluders(params: {
  size: { width: number; height: number };
  isGroup: boolean;
  focusShell?: boolean;
  listMode?: boolean;
  listShowType?: boolean;
  padding: number;
  badgeCount: number;
  showZoomControls: boolean;
  showDetailControls: boolean;
  showChildGroupControls: boolean;
  hasSummary: boolean;
  hasLabel: boolean;
  listPropCount: number;
  richContent?: ResolvedNodeRichContent;
}): LocalNodeContentOccluder[] {
  if (params.focusShell || params.size.width <= 0 || params.size.height <= 0) {
    return [];
  }
  if (params.listMode) {
    return resolveListContentOccluders({
      size: params.size,
      propCount: params.listPropCount,
      showType: params.listShowType !== false,
    });
  }
  if (params.isGroup) {
    return resolveGroupContentOccluders({
      size: params.size,
      padding: params.padding,
      badgeCount: params.badgeCount,
      showZoomControls: params.showZoomControls,
      showDetailControls: params.showDetailControls,
      showChildGroupControls: params.showChildGroupControls,
      hasSummary: params.hasSummary,
    });
  }
  return resolveLeafContentOccluders({
    size: params.size,
    padding: params.padding,
    badgeCount: params.badgeCount,
    hasSummary: params.hasSummary,
    hasLabel: params.hasLabel,
    richContent: params.richContent,
  });
}

const estimateMetaBarWidth = (
  summaryLabel: string | undefined,
  hasSteps: boolean,
  hasMenu: boolean,
) => {
  const label = summaryLabel ?? 'Details';
  const textCellWidth =
    Math.max(GROUP_META_MIN_TEXT, label.length * GROUP_META_TEXT_CHAR) + GROUP_META_TEXT_PAD_X;
  const stepsWidth = hasSteps ? GROUP_META_STEP_WIDTH * 2 : 0;
  const menuWidth = hasMenu ? GROUP_META_MENU_WIDTH : 0;
  return textCellWidth + stepsWidth + menuWidth + GROUP_META_BORDER;
};

const groupHeaderHeight = (badgeCount: number) => {
  const count = Math.min(5, badgeCount);
  const propsHeight =
    count > 0 ? count * GROUP_PROP_LINE + (count - 1) * GROUP_PROP_GAP + GROUP_META_GAP : 0;
  const controlsHeight = GROUP_META_GAP + GROUP_META_BAR_HEIGHT;
  return GROUP_HEADER_BASE + controlsHeight + propsHeight + GROUP_META_BOTTOM_GAP;
};

export type LayoutSpec = {
  padding: number;
  headerHeight: number;
  direction?: 'LR' | 'TB';
  nodeSep?: number;
  rankSep?: number;
  layoutMode?: 'graph' | 'list';
  listGap?: number;
};

export function getGroupHeaderHeight(
  badgeCount: number,
  // Retained for call-site compat; the merged meta bar is one row regardless.
  _controlRows: number | boolean = false,
): number {
  return groupHeaderHeight(badgeCount);
}

export function getGroupMinWidth(summaryLabel: string | undefined, padding: number): number {
  return estimateMetaBarWidth(summaryLabel, true, false) + padding * 2;
}

export function getGroupMinWidthWithControls(
  summaryLabel: string | undefined,
  padding: number,
  controls: { detailControls: boolean; childGroupControls: boolean },
): number {
  const hasMenu = controls.detailControls || controls.childGroupControls;
  return estimateMetaBarWidth(summaryLabel, true, hasMenu) + padding * 2;
}

export function getLeafMinHeight(params: {
  badgeCount: number;
  hasCount: boolean;
  padding: number;
}): number {
  const badgeLines = Math.min(5, params.badgeCount);
  const propsHeight = badgeLines > 0 ? badgeLines * 14 + (badgeLines - 1) * 2 + 4 : 0;
  const countHeight = params.hasCount ? 14 : 0;
  const sectionCount = 2 + (badgeLines > 0 ? 1 : 0) + (countHeight > 0 ? 1 : 0);
  const gaps = sectionCount > 1 ? (sectionCount - 1) * 6 : 0;
  const contentHeight = 18 + 14 + propsHeight + countHeight + gaps;
  return contentHeight + params.padding * 2;
}

const estimateWrappedLineCount = (text: string, width: number) => {
  const normalized = text
    .replace(/[*_`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 0;
  const charsPerLine = Math.max(18, Math.floor(width / CONTENT_TEXT_CHAR));
  return Math.max(1, Math.ceil(normalized.length / charsPerLine));
};

type MarkdownLayoutBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'heading'; text: string };

const parseMarkdownLayoutBlocks = (markdown: string): MarkdownLayoutBlock[] => {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownLayoutBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push({ kind: 'list', items: list });
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph();
      list.push(trimmed.slice(2).trim());
      continue;
    }
    if (trimmed.startsWith('#')) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: trimmed.replace(/^#+\s*/, '') });
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
};

export function getLeafContentMinHeight(params: {
  content: ResolvedNodeRichContent;
  padding: number;
  width: number;
}): number {
  const bodyWidth = Math.max(160, params.width - params.padding * 2);
  if (params.content.kind === 'markdown') {
    const blocks = parseMarkdownLayoutBlocks(params.content.markdown);
    const blockHeight = blocks.reduce((total, block) => {
      if (block.kind === 'heading') {
        return total + estimateWrappedLineCount(block.text, bodyWidth) * 15;
      }
      if (block.kind === 'list') {
        const listWidth = Math.max(140, bodyWidth - CONTENT_LIST_INDENT);
        return (
          total +
          block.items.reduce(
            (itemTotal, item) =>
              itemTotal + estimateWrappedLineCount(item, listWidth) * CONTENT_TEXT_LINE,
            0,
          ) +
          Math.max(0, block.items.length - 1) * CONTENT_LIST_GAP
        );
      }
      return total + estimateWrappedLineCount(block.text, bodyWidth) * CONTENT_TEXT_LINE;
    }, 0);
    const blockGapHeight = Math.max(0, blocks.length - 1) * CONTENT_TEXT_GAP;
    return params.padding * 2 + CONTENT_HEADER_HEIGHT + Math.max(blockHeight + blockGapHeight, 48);
  }

  const imageHeight = Math.max(
    CONTENT_IMAGE_MIN,
    Math.min(CONTENT_IMAGE_MAX, Math.round(bodyWidth * 0.56)),
  );
  const captionHeight = params.content.caption ? CONTENT_IMAGE_CAPTION : 0;
  return params.padding * 2 + CONTENT_HEADER_HEIGHT + imageHeight + captionHeight + 8;
}

export function getListItemHeight(params: { propCount: number; showType: boolean }): number {
  const props = Math.max(0, params.propCount);
  const typeBlock = params.showType ? LIST_TYPE_LINE + LIST_LINE_GAP : 0;
  const propBlock =
    props > 0 ? LIST_SECTION_GAP + props * LIST_PROP_LINE + (props - 1) * LIST_PROP_GAP : 0;
  return LIST_PADDING * 2 + typeBlock + LIST_NAME_LINE + propBlock;
}

const computeBounds = (
  positions: Record<string, { x: number; y: number }>,
  sizes: Record<string, { width: number; height: number }>,
) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [id, pos] of Object.entries(positions)) {
    const size = sizes[id] ?? DEFAULT_NODE_SIZE;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + size.width);
    maxY = Math.max(maxY, pos.y + size.height);
  }
  if (minX === Number.POSITIVE_INFINITY) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
};

const normalizePositions = (
  positions: Record<string, { x: number; y: number }>,
  bounds: { minX: number; minY: number },
) => {
  const normalized: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    normalized[id] = { x: pos.x - bounds.minX, y: pos.y - bounds.minY };
  }
  return normalized;
};

export function renderComponentLayout(
  children: Record<string, { width: number; height: number }>,
  edges: { source: string; target: string }[],
  spec: LayoutSpec,
): {
  requiredSize: { width: number; height: number };
  positions: Record<string, { x: number; y: number }>;
  computedPositions: Record<string, { x: number; y: number }>;
} {
  const childIds = Object.keys(children);
  if (childIds.length === 0) {
    return {
      requiredSize: { width: 0, height: 0 },
      positions: {},
      computedPositions: {},
    };
  }

  if (spec.layoutMode === 'list') {
    const positions: Record<string, { x: number; y: number }> = {};
    const gap = spec.listGap ?? 8;
    let cursorY = spec.headerHeight + spec.padding;
    let maxWidth = 0;
    for (const id of childIds) {
      const size = children[id];
      if (!size) continue;
      positions[id] = { x: spec.padding, y: cursorY };
      cursorY += size.height + gap;
      maxWidth = Math.max(maxWidth, size.width);
    }
    if (childIds.length > 0) {
      cursorY -= gap;
    }
    return {
      requiredSize: {
        width: maxWidth + spec.padding * 2,
        height: cursorY + spec.padding,
      },
      positions,
      computedPositions: positions,
    };
  }

  const layout = layoutGraph(
    childIds.map((id) => ({ id, ...children[id] })),
    edges,
    {
      direction: spec.direction,
      nodeSep: spec.nodeSep,
      rankSep: spec.rankSep,
    },
  );
  const bounds = computeBounds(layout, children);
  const normalized = normalizePositions(layout, bounds);
  const computedPositions: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(normalized)) {
    computedPositions[id] = {
      x: spec.padding + pos.x,
      y: spec.headerHeight + spec.padding + pos.y,
    };
  }

  const positions: Record<string, { x: number; y: number }> = {
    ...computedPositions,
  };

  const normalizedPositions: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    normalizedPositions[id] = {
      x: pos.x - spec.padding,
      y: pos.y - spec.headerHeight - spec.padding,
    };
  }
  const finalBounds = computeBounds(normalizedPositions, children);
  return {
    requiredSize: {
      width: finalBounds.width + spec.padding * 2,
      height: finalBounds.height + spec.padding * 2 + spec.headerHeight,
    },
    positions,
    computedPositions,
  };
}
