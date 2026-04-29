import type { ReactNode } from 'react';
import type { ResolvedNodeRichContent } from '../../rendering/visual/node-visuals';

const withStableKeys = <T,>(items: T[], getBaseKey: (item: T) => string) => {
  const counts = new Map<string, number>();

  return items.map((item) => {
    const baseKey = getBaseKey(item);
    const duplicateCount = counts.get(baseKey) ?? 0;
    counts.set(baseKey, duplicateCount + 1);

    return {
      key: duplicateCount === 0 ? baseKey : `${baseKey}:${duplicateCount}`,
      value: item,
    };
  });
};

const renderInlineMarkdown = (text: string): ReactNode[] => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return withStableKeys(parts, (part) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return `code:${part.slice(1, -1)}`;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return `strong:${part.slice(2, -2)}`;
    }
    return `text:${part}`;
  }).map(({ key, value: part }) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="node-rich-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return <span key={key}>{part}</span>;
  });
};

const renderMarkdownBlocks = (markdown: string) => {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'heading'; text: string }
  > = [];
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

  return withStableKeys(blocks, (block) => {
    if (block.kind === 'list') {
      return `list:${block.items.join('|')}`;
    }
    return `${block.kind}:${block.text}`;
  }).map(({ key, value: block }) => {
    if (block.kind === 'heading') {
      return (
        <div key={key} className="node-rich-heading">
          {renderInlineMarkdown(block.text)}
        </div>
      );
    }
    if (block.kind === 'list') {
      return (
        <ul key={key} className="node-rich-list">
          {withStableKeys(block.items, (item) => `item:${item}`).map(({ key, value: item }) => (
            <li key={key}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={key} className="node-rich-paragraph">
        {renderInlineMarkdown(block.text)}
      </p>
    );
  });
};

interface RichNodeContentProps {
  content: ResolvedNodeRichContent;
  fallbackAlt?: string;
}

export function RichNodeContent({ content, fallbackAlt }: RichNodeContentProps) {
  if (content.kind === 'markdown') {
    return (
      <div className="node-rich node-rich-markdown">{renderMarkdownBlocks(content.markdown)}</div>
    );
  }

  return (
    <div className="node-rich node-rich-image">
      <div className="node-rich-image-frame">
        <img src={content.src} alt={content.alt ?? fallbackAlt ?? ''} loading="lazy" />
      </div>
      {content.caption ? <div className="node-rich-caption">{content.caption}</div> : null}
    </div>
  );
}
