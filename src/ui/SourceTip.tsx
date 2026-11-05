import { useEffect, useRef, useState } from "react";
import { ORIGIN_HEADING, Origin, OriginKind } from "../model/origin";

const SHOW_AFTER_MS = 280;
const VIEW_MARGIN_PX = 8;
const GAP_PX = 6;

// Marks anything on screen with where it came from. One tip reads these marks for the whole page.
export const sourced = (origin: Origin) => ({ "data-src": origin.detail, "data-src-kind": origin.kind });

interface Shown {
  kind: OriginKind;
  detail: string;
  box: DOMRect;
}

const isKind = (kind: string | undefined): kind is OriginKind => kind !== undefined && Object.hasOwn(ORIGIN_HEADING, kind);

function readMark(target: Element | null): { el: HTMLElement; kind: OriginKind; detail: string } | null {
  const el = target?.closest<HTMLElement>("[data-src]") ?? null;
  const kind = el?.dataset.srcKind;
  const detail = el?.dataset.src;
  if (!el || !isKind(kind) || detail === undefined) return null;
  return { el, kind, detail };
}

export function SourceTip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    let open = false;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      open = false;
      setShown(null);
    };
    const show = (mark: NonNullable<ReturnType<typeof readMark>>) => {
      open = true;
      setShown({ kind: mark.kind, detail: mark.detail, box: mark.el.getBoundingClientRect() });
    };
    const consider = (target: Element | null) => {
      const mark = readMark(target);
      if (!mark) {
        if (current) hide();
        return;
      }
      if (mark.el === current) {
        // The chart changes what it says about one element as the pointer moves between its rows.
        if (open) show(mark);
        return;
      }
      window.clearTimeout(timer);
      current = mark.el;
      // Once one tip is open, moving to the next number shouldn't make you wait again.
      if (open) show(mark);
      else timer = window.setTimeout(() => show(mark), SHOW_AFTER_MS);
    };
    const moved = (e: PointerEvent) => consider(e.target instanceof Element ? e.target : null);
    const focused = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return;
      const mark = readMark(e.target) ?? readMark(e.target.querySelector("[data-src]"));
      if (mark && e.target.matches(":focus-visible")) {
        current = mark.el;
        show(mark);
      }
    };
    document.addEventListener("pointermove", moved, { passive: true });
    document.addEventListener("pointerdown", hide, { passive: true });
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", moved);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", focused);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  // Above what it is about, unless that runs off the top, and always inside the window.
  useEffect(() => {
    const el = tip.current;
    if (!el || !shown) return;
    const { width, height } = el.getBoundingClientRect();
    const above = shown.box.top - height - GAP_PX;
    const top = above >= VIEW_MARGIN_PX ? above : shown.box.bottom + GAP_PX;
    const left = Math.max(VIEW_MARGIN_PX, Math.min(window.innerWidth - width - VIEW_MARGIN_PX, shown.box.left));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    el.style.opacity = "1";
  }, [shown]);

  if (!shown) return null;
  return (
    <div ref={tip} className="source-tip" role="tooltip" data-kind={shown.kind}>
      <b>{ORIGIN_HEADING[shown.kind]}</b>
      {shown.detail ? <span>{shown.detail}</span> : null}
    </div>
  );
}
