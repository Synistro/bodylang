import { ReactNode, useEffect, useRef, useState } from "react";

const LEAVE_MS = 130;

// Keeps the previous content on screen for a moment while the new content rises in beneath it.
// Both stay mounted under their own key, so nothing rebuilds except what actually changed.
export function Crossfade({ k, children }: { k: string; children: ReactNode }) {
  const previous = useRef({ k, node: children });
  const [leaving, setLeaving] = useState<{ k: string; node: ReactNode } | null>(null);
  const [changed, setChanged] = useState(false);

  if (previous.current.k !== k) {
    setLeaving(previous.current);
    setChanged(true);
  }
  previous.current = { k, node: children };

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  return (
    <div className="crossfade">
      {leaving && leaving.k !== k ? (
        <div key={leaving.k} className="crossfade-leaving" aria-hidden="true" inert>
          {leaving.node}
        </div>
      ) : null}
      <div key={k} className="crossfade-current" data-entering={changed || undefined}>
        {children}
      </div>
    </div>
  );
}
