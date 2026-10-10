import { Link as LinkIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const DEFAULT_LABEL = 'Copy link to this view';
export function CopyViewLinkButton({ createLink }: { createLink: () => Promise<string> }) {
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = async () => {
    setBusy(true);
    let result: string;
    try {
      await navigator.clipboard.writeText(await createLink());
      result = 'Link copied';
    } catch {
      result = "Couldn't copy the link";
    }
    if (!active.current) return;
    setBusy(false);
    setLabel(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel(DEFAULT_LABEL), 2000);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={busy}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <LinkIcon size={16} aria-hidden="true" />
    </button>
  );
}
