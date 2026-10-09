import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches),
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reducedMotion;
}
