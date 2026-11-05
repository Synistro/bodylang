import { ReactNode, useRef } from "react";

// Replaces the content in one step, so two pages are never on screen together, and lets the new one
// settle. The first page to appear has nothing to replace, so it just appears.
export function Swap({ k, children }: { k: string; children: ReactNode }) {
  const shown = useRef(k);
  const swapped = useRef(false);
  if (shown.current !== k) {
    shown.current = k;
    swapped.current = true;
  }
  return (
    <div key={k} className="swap" data-entering={swapped.current || undefined}>
      {children}
    </div>
  );
}
