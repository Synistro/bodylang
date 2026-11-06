import { ORIGIN_HEADING, Origin, OriginKind } from "../model/origin";

// Marks anything on screen with where it came from. Nothing shows this until you ask, through Sources
// at the foot of the page, so it never gets in the way of what you are pointing at.
export const sourced = (origin: Origin) => ({ "data-src": origin.detail, "data-src-kind": origin.kind });

export interface SourceEntry {
  heading: string;
  detail: string;
}

const isKind = (kind: string | undefined): kind is OriginKind =>
  kind !== undefined && Object.hasOwn(ORIGIN_HEADING, kind);

// Where what you can see right now came from, each source once. Anything folded away behind the current
// view doesn't count, and neither do your own measurements in the header.
export function sourcesOnScreen(): SourceEntry[] {
  const seen = new Map<string, SourceEntry>();
  for (const el of document.querySelectorAll<HTMLElement>(".sheet [data-src]")) {
    if (el.closest("[inert], .header")) continue;
    const { srcKind: kind, src: detail } = el.dataset;
    if (isKind(kind) && detail) seen.set(`${kind}|${detail}`, { heading: ORIGIN_HEADING[kind], detail });
  }
  return [...seen.values()];
}
