import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Explaining, getState, setUi, useStore } from "../store";
import { X } from "./icons";
import { explainEventSchema, readEvents } from "../wire";

const MOST_CHARS = 200;
// Only sentences and diagrams explain themselves. Names of rows and buttons are for clicking.
const DESCRIPTIONS =
  ".tour-say, .page-sentence, .page-headline, .reading-why, .reading-more, .feel-cause, .stop-say, .reply-line, .organ-lines, .acting-words, .item-note, .fix-note, .sources, .hint, .inset-art text";
const AROUND = "p, li, h1, .reading, .stop, .tour, figure, .tree-leaf, .day-row, .reply";
const AROUND_MOST_CHARS = 1000;
const HIGHLIGHT = "explain-term";
const GAP_PX = 8;
const EDGE_PX = 12;

interface Turn {
  role: "you" | "claude";
  text: string;
}

// The words selected in the text on screen, if they are worth explaining.
function selectedWords(): { explaining: Explaining; range: Range } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const term = selection.toString().trim().replace(/\s+/g, " ");
  if (!term || term.length > MOST_CHARS || !/[\p{L}\p{N}]/u.test(term)) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element?.closest(".sheet") || !element.closest(DESCRIPTIONS)) return null;
  const { top, bottom, left, width } = range.getBoundingClientRect();
  const around = (element.closest(AROUND)?.textContent ?? element.textContent ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, AROUND_MOST_CHARS);
  const page = document.querySelector(".page-name")?.textContent?.trim() ?? "";
  return { explaining: { term, around, page, top, bottom, center: left + width / 2 }, range };
}

// The selection fades once you click into the box, so the words stay marked some other way while you chat.
function markTerm(range: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
  else CSS.highlights.delete(HIGHLIGHT);
}

async function streamAnswer(
  explaining: Explaining,
  turns: Turn[],
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  // The numbers are for the moment on screen, which may be somewhere you scrubbed to.
  const { day, t } = getState();
  const { term, around, page } = explaining;
  const response = await fetch("/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ term, around, page, turns, now: Math.round(t), day }),
    signal,
  });
  if (!response.ok) throw new Error(`The explanation failed with ${response.status}.`);
  for await (const event of readEvents(response, explainEventSchema)) {
    if (event.type === "text") onText(event.text);
    if (event.type === "error") throw new Error(event.message);
  }
}

// Select words in any description and this opens right above them, with Haiku saying what they mean and
// room to ask more. It only talks: nothing here changes your day, and it is gone when you close it.
export function Explain() {
  const explaining = useStore((s) => s.explaining);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);

  // A finished selection opens it. Selecting again moves it, and a click elsewhere closes it.
  useEffect(() => {
    const released = () => {
      window.setTimeout(() => {
        const found = selectedWords();
        if (!found) return;
        markTerm(found.range);
        setUi({ explaining: found.explaining });
      }, 0);
    };
    const pressed = (e: PointerEvent) => {
      if (e.target instanceof Node && panel.current?.contains(e.target)) return;
      if (getState().explaining) setUi({ explaining: null });
    };
    // Letting go of a drag inside a button would otherwise press it.
    const clicked = (e: MouseEvent) => {
      if (selectedWords()) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener("pointerup", released);
    document.addEventListener("pointerdown", pressed);
    document.addEventListener("click", clicked, { capture: true });
    return () => {
      document.removeEventListener("pointerup", released);
      document.removeEventListener("pointerdown", pressed);
      document.removeEventListener("click", clicked, { capture: true });
    };
  }, []);

  const ask = (subject: Explaining, sofar: Turn[]) => {
    request.current?.abort();
    const stop = new AbortController();
    request.current = stop;
    setProblem(null);
    setWorking(true);
    setTurns([...sofar, { role: "claude", text: "" }]);
    streamAnswer(subject, sofar, stop.signal, (text) =>
      setTurns((current) => {
        const last = current[current.length - 1];
        return [...current.slice(0, -1), { ...last, text: last.text + text }];
      }),
    )
      .catch((e: unknown) => {
        if (!stop.signal.aborted) setProblem(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (request.current === stop) setWorking(false);
      });
  };

  useEffect(() => {
    if (explaining) {
      setDraft("");
      ask(explaining, []);
    } else {
      request.current?.abort();
      markTerm(null);
      setTurns([]);
    }
  }, [explaining]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns]);

  // Above the words, and below them if there is no room above. It grows away from them as the answer comes.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !explaining) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(EDGE_PX, Math.min(window.innerWidth - width - EDGE_PX, explaining.center - width / 2))}px`;
    if (explaining.top - height - GAP_PX >= EDGE_PX) {
      el.style.top = "auto";
      el.style.bottom = `${window.innerHeight - explaining.top + GAP_PX}px`;
    } else {
      el.style.bottom = "auto";
      el.style.top = `${explaining.bottom + GAP_PX}px`;
    }
  }, [explaining, turns, working]);

  if (!explaining) return null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || working) return;
    setDraft("");
    ask(explaining, [...turns, { role: "you", text }]);
  };

  return (
    <div ref={panel} className="explain" role="dialog" aria-label={`What ${explaining.term} means`}>
      <div className="explain-head">
        <b>{explaining.term}</b>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setUi({ explaining: null })}>
          <X />
        </button>
      </div>
      <div ref={log} className="explain-log" aria-live="polite">
        {turns.map((turn, i) =>
          turn.text ? (
            <p key={i} data-role={turn.role}>
              {turn.text}
            </p>
          ) : (
            <p key={i} className="explain-waiting" aria-label="Waiting for the answer">
              Thinking
            </p>
          ),
        )}
        {problem ? <p className="explain-problem">{problem}</p> : null}
      </div>
      <form onSubmit={send}>
        <input
          value={draft}
          placeholder={`Ask Claude about ${explaining.term}`}
          aria-label={`Ask Claude about ${explaining.term}`}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </div>
  );
}
