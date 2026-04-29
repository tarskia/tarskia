import { useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaDraftHighlight } from './types';

interface SchemaTextareaProps {
  value: string;
  onChange: (next: string) => void;
  highlights: SchemaDraftHighlight[];
  errorHighlight?: { startLine: number; endLine: number } | null;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function SchemaTextarea({
  value,
  onChange,
  highlights,
  errorHighlight,
  textareaRef: externalRef,
}: SchemaTextareaProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = externalRef ?? internalRef;
  const [scrollTop, setScrollTop] = useState(0);
  const [metrics, setMetrics] = useState({ lineHeight: 18, paddingTop: 12 });

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const computed = window.getComputedStyle(textarea);
    const fontSize = Number.parseFloat(computed.fontSize) || 14;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.4;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    setMetrics({ lineHeight, paddingTop });
  }, [ref]);

  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, lineNumber) => lineNumber + 1),
    [lineCount],
  );

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden rounded-md border border-border">
      {/* Line numbers gutter */}
      <div
        className="shrink-0 select-none text-right pr-2 pl-2 pt-3 bg-[rgba(8,10,16,0.92)] text-muted-foreground font-mono text-xs leading-[1.4] border-r border-border overflow-hidden"
        aria-hidden="true"
        style={{ paddingTop: metrics.paddingTop }}
      >
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {lineNumbers.map((lineNumber) => (
            <div key={`line-${lineNumber}`} className="h-[1.4em]">
              {lineNumber}
            </div>
          ))}
        </div>
      </div>

      {/* Error highlight */}
      {errorHighlight ? (
        <div
          aria-hidden="true"
          className="absolute left-10 right-3 rounded-sm bg-warning/12 shadow-[inset_3px_0_0_hsl(30_100%_65%/0.55)] pointer-events-none z-[1]"
          style={{
            top:
              metrics.paddingTop + (errorHighlight.startLine - 1) * metrics.lineHeight - scrollTop,
            height: (errorHighlight.endLine - errorHighlight.startLine + 1) * metrics.lineHeight,
          }}
        />
      ) : null}

      {/* Inserted highlights */}
      {highlights.map((highlight) => (
        <div
          key={`${highlight.startLine}-${highlight.endLine}`}
          aria-hidden="true"
          className="absolute left-10 right-3 rounded-sm bg-success/12 shadow-[inset_3px_0_0_hsl(153_50%_62%/0.58)] pointer-events-none z-[1]"
          style={{
            top: metrics.paddingTop + (highlight.startLine - 1) * metrics.lineHeight - scrollTop,
            height: (highlight.endLine - highlight.startLine + 1) * metrics.lineHeight,
          }}
        />
      ))}

      {/* Textarea */}
      <textarea
        ref={ref}
        className="flex-1 min-h-0 w-full resize-none p-3 bg-[rgba(8,10,16,0.85)] text-foreground font-mono text-xs leading-[1.4] outline-none border-0 relative z-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        spellCheck={false}
      />
    </div>
  );
}
