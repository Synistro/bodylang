import { FormEvent, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "skullet/react";
import { ReplyLine } from "../model/narrate";
import { CLAUDE_WORDS, Origin, SENTENCE_ORIGIN } from "../model/origin";
import { applyWhatIf, clearWhatIf, Exchange, goToStep, Mode, setMode, useStore } from "../store";
import { organHover, useScrollFade } from "./hooks";
import { ArrowUp, X } from "./icons";
import { showOrgan } from "./navigation";
import { sourced } from "./SourceTip";
import { tell } from "./tell";

const SAMPLE_REPLY: ReplyLine[] = [{ text: "Working out what happened and running it through the model." }, { text: "The answer appears here, in a line or two." }, { text: "And what you may feel." }];
const WHAT_IF_PEAK_WINDOW_MINUTES = 360;
const WHAT_IF_MIN_PEAK_CHANGE = 0.05;
const MG_DL_PER_MMOL = 18.016;

const NUMBER_ORIGIN: Origin = { kind: "model", detail: "This number is one the model returned to Claude." };
const ADDED_ORIGIN: Origin = { kind: "claude", detail: "The model never returned this number. Claude worked it out or added it from its own knowledge." };
const SAID_NUMBER = /(?<![\w.:,])(\d{1,2}:\d{2}|\d+(?:\.\d+)?%?)(?![\w:]|\.\d)/g;

// Claude's words, with each number marked by whether the model really returned it. Without a check,
// as in the scripted demo, the whole line just counts as the app's own.
export function CheckedWords({ text, unverified }: { text: string; unverified?: string[] }) {
  if (!unverified) return <span {...sourced(SENTENCE_ORIGIN)}>{text}</span>;
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(SAID_NUMBER)) {
    pieces.push(text.slice(at, match.index));
    pieces.push(
      <span key={match.index} className="said-number" {...sourced(unverified.includes(match[0]) ? ADDED_ORIGIN : NUMBER_ORIGIN)}>
        {match[0]}
      </span>,
    );
    at = match.index + match[0].length;
  }
  pieces.push(text.slice(at));
  return <span {...sourced(CLAUDE_WORDS)}>{pieces}</span>;
}

function Reply({ lines }: { lines: ReplyLine[] }) {
  return (
    <div className="reply">
      {lines.map((l) => (
        <button type="button" key={l.text} className="reply-line" data-linked={l.organ ? true : undefined} onClick={() => l.organ && showOrgan(l.organ)} {...organHover(l.organ ?? null)}>
          <CheckedWords text={l.text} unverified={l.unverified} />
        </button>
      ))}
    </div>
  );
}

// Text over the message box: up to three short lines. What was said only shows while Claude works on it.
function ExchangeBlock({ exchange, onDismiss }: { exchange: Exchange; onDismiss: () => void }) {
  const [showTrace, setShowTrace] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const working = exchange.status === "working";
  useScrollFade(scroller);
  return (
    <article className="exchange">
      <div ref={scroller} className="exchange-body">
        {working ? <p className="said">{exchange.text}</p> : null}
        {exchange.status === "error" ? (
          <p className="reply-error">{exchange.error}</p>
        ) : (
          <Skeleton data={working ? null : exchange.reply} sample={SAMPLE_REPLY} label="Waiting for the answer">
            {(lines) => <Reply lines={lines} />}
          </Skeleton>
        )}
        <WalkAgain />
        {exchange.trace.length ? (
          <div className="worked">
            <button type="button" className="worked-toggle" aria-expanded={showTrace} onClick={() => setShowTrace(!showTrace)}>
              How I worked this out
            </button>
            {showTrace ? (
              <ol className="trace" aria-label="What the body did">
                {exchange.trace.map((line, i) => (
                  <li key={`${i}${line}`}>{line}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
      <button type="button" className="icon-button" aria-label="Dismiss this answer" onClick={onDismiss}>
        <X />
      </button>
    </article>
  );
}

// An explanation closed before its end can be opened again.
function WalkAgain() {
  const closedGuide = useStore((s) => s.asking !== null && s.asking.guide !== null && !s.asking.guideOpen);
  if (!closedGuide) return null;
  return (
    <button type="button" className="worked-toggle walk-again" onClick={() => goToStep(0)}>
      Walk me through it
    </button>
  );
}

const NUMBER_ORIGIN_WHAT_IF: Origin = { kind: "model", detail: "Claude suggested this alternative, and the model computed the difference." };

// An alternative Claude offered, in words, at the foot of what it said.
function WhatIfOffer() {
  const tr = useStore((s) => s.trajectory);
  const whatIf = useStore((s) => s.whatIf);
  const meta = useStore((s) => s.body.whatIf);
  const now = useStore((s) => s.body.now);
  if (!whatIf || !meta) return null;
  const peak = (series: Float32Array) => {
    let best = 0;
    const end = Math.min(series.length, Math.floor(now) + WHAT_IF_PEAK_WINDOW_MINUTES);
    for (let t = Math.floor(now); t < end; t++) best = Math.max(best, series[t]);
    return best;
  };
  const drop = (peak(tr.series.glucose) - peak(whatIf.series.glucose)) / MG_DL_PER_MMOL;
  const effect = Math.abs(drop) >= WHAT_IF_MIN_PEAK_CHANGE ? `, and your sugar peak is ${Math.abs(drop).toFixed(1)} ${drop > 0 ? "lower" : "higher"}.` : ".";
  return (
    <div className="what-if">
      <p {...sourced(NUMBER_ORIGIN_WHAT_IF)}>
        {meta.label}
        {effect}
      </p>
      <div className="what-if-actions">
        <button type="button" className="link" onClick={applyWhatIf}>
          Apply
        </button>
        <button type="button" className="link" onClick={clearWhatIf}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function Answer() {
  const exchanges = useStore((s) => s.exchanges);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const session = useStore((s) => s.asking?.id ?? null);
  const last = exchanges[exchanges.length - 1];
  // What was asked ends with the session it was asked in.
  const shown = last && !last.scripted && dismissed !== last.id && (last.session === null || last.session === session) ? last : null;
  return (
    <section className="answer" aria-label="Latest answer">
      {shown ? <ExchangeBlock key={shown.id} exchange={shown} onDismiss={() => setDismissed(shown.id)} /> : null}
      <WhatIfOffer />
    </section>
  );
}

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "tell", label: "Tell", hint: "Something happened. It goes into your day." },
  { mode: "ask", label: "Ask", hint: "What would happen, or how something works. Nothing is saved." },
];

const PLACEHOLDER: Record<Mode, string> = { tell: "Tell your body what happened", ask: "What if I ate this? How does insulin work?" };

export function Composer() {
  const working = useStore((s) => s.exchanges.some((e) => e.status === "working"));
  const mode = useStore((s) => s.mode);
  const asking = useStore((s) => s.asking !== null);
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || working) return;
    setText("");
    void tell(trimmed);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const placeholder = mode === "ask" && asking ? "Ask a follow-up" : PLACEHOLDER[mode];
  return (
    <form className="composer" data-mode={mode} onSubmit={submit}>
      <textarea
        ref={field}
        id="tell"
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            setMode(mode === "tell" ? "ask" : "tell");
          }
        }}
      />
      <div className="composer-foot">
        <div className="mode-switch" role="radiogroup" aria-label="What this message is">
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} title={m.hint} onClick={() => setMode(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
        <button type="submit" className="send" aria-label={working ? "Working" : "Send"} data-shown={working || text.trim() !== "" || undefined} data-working={working || undefined} disabled={working || !text.trim()}>
          <ArrowUp weight="bold" />
        </button>
      </div>
    </form>
  );
}
