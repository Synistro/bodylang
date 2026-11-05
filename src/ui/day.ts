import { z } from "zod";
import { carryOver, clockAt, DayDoc, firstDay, parseDayDoc } from "../model/day";
import { dayDocOf, getState, restoreDay, setClock, setUi, subscribe } from "../store";
import { WALL } from "../wall";
import { followBuilds } from "./Build";
import { playOpening } from "./opening";

const lookSchema = z.object({ theme: z.enum(["plate", "xray"]), layers: z.object({ skin: z.boolean(), vessels: z.boolean() }) });

const TICK_MS = 5000;
const SAVE_AFTER_MS = 300;
// Tells this page's own saves apart from another page's.
const WRITER = crypto.randomUUID();

export const DEMO = new URLSearchParams(location.search).has("demo");

async function readNewest(): Promise<DayDoc | null> {
  const response = await fetch("/api/day", { cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await response.text());
  return parseDayDoc(await response.json());
}

let saved: DayDoc | null = null;
let timer = 0;

const sameDay = (a: DayDoc, b: DayDoc | null) => b !== null && a.date === b.date && a.body === b.body && a.intakes === b.intakes && a.activities === b.activities && a.substances === b.substances && a.events === b.events && a.cycle === b.cycle && a.assumptions === b.assumptions;

async function write(doc: DayDoc) {
  try {
    const response = await fetch("/api/day", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writer: WRITER, doc }) });
    if (!response.ok) throw new Error(await response.text());
    if (getState().dayProblem) setUi({ dayProblem: null });
  } catch {
    setUi({ dayProblem: "Your day isn't being saved. Is the dev server running?" });
  }
}

// Saves whenever your day changes. A copy being explored is never your day, so it never gets here.
function saveWhenChanged() {
  const doc = dayDocOf(getState());
  if (!doc || sameDay(doc, saved)) return;
  saved = doc;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (saved) void write(saved);
  }, SAVE_AFTER_MS);
}

function put(doc: DayDoc, minute: number) {
  restoreDay(doc, minute);
  saved = dayDocOf(getState());
}

async function load() {
  const clock = clockAt(new Date());
  const newest = await readNewest();
  const doc = newest ? carryOver(newest, clock.date) : firstDay(clock.date, getState().body.body);
  put(doc, clock.minute);
  // A new date starts a new file. The wallpaper only ever reads.
  if (!WALL && (!newest || newest.date !== doc.date)) void write(doc);
}

// The clock is real: now follows it, and past the rollover yesterday becomes what carried over.
function tick(wanted: { reload: boolean }) {
  const s = getState();
  if (s.asking || !s.date) return;
  if (wanted.reload) {
    wanted.reload = false;
    void load().catch(problem);
    return;
  }
  const clock = clockAt(new Date());
  if (clock.date === s.date) {
    setClock(clock.minute);
    return;
  }
  const doc = dayDocOf(s);
  if (!doc) return;
  const next = carryOver(doc, clock.date);
  put(next, clock.minute);
  if (!WALL) void write(next);
}

const problem = (e: unknown) => setUi({ dayProblem: `Your day could not be read, so nothing is being saved. ${e instanceof Error ? e.message : String(e)}` });

const LOOK_KEY = "bodylang.look";

// How you like the figure drawn belongs to this browser. Losing it costs nothing, so a browser that
// won't store it just starts from the default.
function rememberLook() {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) {
      const look = lookSchema.parse(JSON.parse(raw));
      setUi({ theme: look.theme, layers: look.layers });
    }
    let last = "";
    subscribe(() => {
      const { theme, layers } = getState();
      const now = JSON.stringify({ theme, layers });
      if (now === last) return;
      last = now;
      try {
        localStorage.setItem(LOOK_KEY, now);
      } catch {
        // Nothing to do: the look simply won't be remembered.
      }
    });
  } catch {
    // The same: blocked storage, or something unreadable in it.
  }
}

export function startDay() {
  rememberLook();
  followBuilds();
  if (DEMO) {
    playOpening();
    return;
  }
  const wanted = { reload: false };
  void load()
    .then(() => {
      if (!WALL) subscribe(saveWhenChanged);
      window.setInterval(() => tick(wanted), TICK_MS);
      document.addEventListener("visibilitychange", () => tick(wanted));
      // Another page saved. Pick it up as soon as this one isn't in the middle of exploring.
      import.meta.hot?.on("bodylang:day", ({ writer }: { writer: string }) => {
        if (writer === WRITER) return;
        wanted.reload = true;
        tick(wanted);
      });
    })
    .catch(problem);
}
