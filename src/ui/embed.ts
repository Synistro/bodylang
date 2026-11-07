import { useSyncExternalStore } from "react";
import { clockAt, dayContentSchema, firstDay } from "../model/day";
import { dispatch, enterAsk, getState, leaveAsk, restoreDay, setBody, setUi } from "../store";
import { embedMessageSchema, Example } from "../wire";
import { replayOf } from "./replay";
import { parseAction, tell } from "./tell";

// The app inside another page, such as the landing page at site/. It shows the day that page hands it and lets a
// visitor pick from its example questions, whose recorded answers replay. It saves nothing, calls no LLM and
// takes no typing, so it costs nothing to show to anyone.
export const EMBED = new URLSearchParams(location.search).has("embed");
if (EMBED) document.documentElement.dataset.embed = "";

let examples: Example[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useExamples = () => useSyncExternalStore(subscribe, () => examples);

const bodyPatch = dayContentSchema.shape.body.partial();

export function askExample({ text, depth, body, events }: Example) {
  leaveAsk();
  setUi({ mode: "ask", depth, exchanges: [] });
  enterAsk();
  if (body !== undefined) setBody(bodyPatch.parse(body));
  void tell(text, replayOf(events));
}

function show(now: number, actions: { name: string; args: unknown }[]) {
  leaveAsk();
  const { date } = clockAt(new Date());
  restoreDay(firstDay(date, getState().day.body), now);
  for (const action of actions) dispatch(parseAction(action.name, action.args));
  setUi({ t: now, exchanges: [], mode: "ask" });
}

export function listenToHost() {
  window.addEventListener("message", (e: MessageEvent) => {
    // Other scripts on the page post messages too. Only ours are checked, and one that doesn't fit is a bug to see.
    if (e.origin !== location.origin || e.data?.type !== "bodylang:show") return;
    const message = embedMessageSchema.parse(e.data);
    show(message.now, message.actions);
    examples = message.examples;
    for (const listener of listeners) listener();
  });
  window.parent.postMessage({ type: "bodylang:ready" }, location.origin);
}
