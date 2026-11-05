import { ACCENT_SYSTEM, LookTheme, SYSTEM_HUE } from "../look";
import { DAY_SPAN, fitWindow, Lane, Moment, Span } from "../model/lanes";
import { LANES } from "../model/params";
import { formatClock } from "../model/state";
import { DayView, lanesOf, runsOverDays, viewStops } from "./dayView";

interface Range {
  from: number;
  to: number;
}

interface Shown {
  lane: Lane;
  age: number; // seconds on screen, for drawing itself in
  row: HTMLElement | null;
  value: HTMLElement | null;
  said: string;
}

interface Anchor {
  at: number;
  label: string | null;
}

export interface DayChartEvents {
  scrub: (minute: number) => void;
  pointAtLane: (lane: Lane | null) => void;
  fixMoment: (moment: Moment, x: number) => void;
  goToStop: (index: number) => void;
}

interface MomentHit {
  moment: Moment;
  left: number;
  right: number;
}

// The chart's rows, in rem. The column of names beside it uses the same numbers.
export const DAY_TOP_REM = 2;
export const DAY_HOURS_REM = 1.6;
export const DAY_ROW_REM = 1.68;
const DAY_ROWS_REM = 8.4;

// With nothing moving and nothing ahead, only the time is left.
export const dayRowsRem = (kind: DayView["kind"]) => (kind === "quiet" ? 0 : DAY_ROWS_REM);

const NOTHING = 0.006; // of a lane, below which an amount has run out
const FONT_UI = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';
const TEXT_REM = 1.1;
const TEXT_GAP_REM = 0.6;
const PILL_HEIGHT_REM = 1.6;
const PILL_PAD_REM = 0.5;
const ALPHA = { fillPast: 0.3, fillFuture: 0.1, band: 0.1, lineFuture: 0.8, quiet: 0.42 };
const LANE_MARGIN_PX = 3;
const FUTURE_DASH = [3, 3];
const GHOST_NOTE = "Grey is your day";
const SNAP_PX = { lanes: 7, top: 22 };
const NEAREST_LANE_PX = 14;
const STOP_GAP_PX = 10;
const CURSOR_TICK_PX = 4;
const ITEM_TICK_PX = 6;
const TICK_REACH_PX = 7;
const STILL_CLICK_PX = 4;
const CORRECTABLE_DOTS = [1, 2];
const MOTION = { viewPerSecond: 9, drawInSeconds: 0.45 };
const LEAST_SPAN_MIN = 120;
const VIEW_MARGIN_MIN = 10;
const WHEEL = { zoomPerPixel: 0.01 };
const HOUR_STEPS = [
  { step: 1, leastPxPerHour: 44 },
  { step: 2, leastPxPerHour: 22 },
  { step: 4, leastPxPerHour: 0 },
];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

const momentsOf = (subject: DayView): Moment[] => (subject.kind === "story" ? [] : subject.moments);

function dayWord(day: number) {
  if (day === 0) return "Today";
  if (day === 1) return "Tomorrow";
  if (day === -1) return "Yesterday";
  return day > 0 ? `In ${day} days` : `${-day} days ago`;
}

const valueAt = (values: Float32Array, span: Span, minute: number) => {
  const at = Math.max(0, Math.min(values.length - 1, (minute - span.from) / span.stepMin));
  const low = Math.floor(at);
  const high = Math.min(values.length - 1, low + 1);
  return values[low] + (values[high] - values[low]) * (at - low);
};

// Draws the day and owns everything that moves in it, so playing or scrubbing never renders React.
// Nothing is drawn unless something changed.
export class DayChart {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private rem = 10;
  private subject: DayView = { kind: "quiet", span: DAY_SPAN, moments: [] };
  private shown: Shown[] = [];
  private anchors: Anchor[] = [];
  private now: number = LANES.from;
  private t: number = LANES.from;
  private fit: Range = DAY_SPAN;
  private view: Range = { from: DAY_SPAN.from, to: DAY_SPAN.to };
  private manual: Range | null = null;
  private wholeDay = false;
  private pointedId: string | null = null;
  private pointer: { x: number; y: number; free: boolean } | null = null;
  private dragging = false;
  private momentHits: MomentHit[] = [];
  private stopXs: number[] = [];
  private pointedStop: number | null = null;
  private pressedMoment: { moment: Moment; x: number } | null = null;
  private theme: LookTheme = "xray";
  private colors = { ink: "#d0cec6", ink2: "#a19e97", ink3: "#8a8782", line: "rgba(208,206,198,.09)", surface: "#1d1b1a" };
  private colorsStale = true;
  private dirty = true;
  private settled = false;
  private readonly resized: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rows: HTMLElement,
    private readonly events: DayChartEvents,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas for the day chart");
    this.ctx = ctx;
    canvas.addEventListener("pointermove", this.moved);
    canvas.addEventListener("pointerleave", this.left);
    canvas.addEventListener("pointerdown", this.pressed);
    canvas.addEventListener("pointerup", this.released);
    canvas.addEventListener("pointercancel", this.released);
    canvas.addEventListener("dblclick", this.resetView);
    canvas.addEventListener("wheel", this.wheeled, { passive: false });
    this.resized = new ResizeObserver(this.measure);
    if (canvas.parentElement) this.resized.observe(canvas.parentElement);
    this.measure();
  }

  dispose() {
    this.resized.disconnect();
    this.canvas.removeEventListener("pointermove", this.moved);
    this.canvas.removeEventListener("pointerleave", this.left);
    this.canvas.removeEventListener("pointerdown", this.pressed);
    this.canvas.removeEventListener("pointerup", this.released);
    this.canvas.removeEventListener("pointercancel", this.released);
    this.canvas.removeEventListener("dblclick", this.resetView);
    this.canvas.removeEventListener("wheel", this.wheeled);
  }

  setData(subject: DayView, now: number) {
    const lanes = lanesOf(subject);
    const before = new Map(this.shown.map((s) => [s.lane.id, s]));
    const allNew = !lanes.some((lane) => before.has(lane.id));
    const swapped = subject.kind !== this.subject.kind;
    this.subject = subject;
    this.shown = lanes.map((lane) => {
      const kept = before.get(lane.id);
      if (kept) return { ...kept, lane, said: "" };
      return { lane, age: 0, row: null, value: null, said: "" };
    });
    for (const s of this.shown) {
      s.row = this.rows.querySelector<HTMLElement>(`[data-lane="${s.lane.id}"]`);
      s.value = s.row?.querySelector<HTMLElement>(".day-value") ?? null;
    }
    // A new subject starts framed by its own story, whatever you had panned to before.
    if (allNew || swapped) this.manual = null;
    this.now = now;
    this.anchors = viewStops(subject, now);
    this.pointedStop = null;
    if (swapped) {
      this.canvas.title = "";
      this.measure();
      this.view = { ...this.goal() };
    } else this.fit = this.framed();
    this.settled = false;
    this.dirty = true;
  }

  private get span(): Span {
    return this.subject.span;
  }

  // What this subject frames by itself. On today's chart that is the model's framing, stretched just enough
  // for the words at the end of each row to fit after it.
  private framed(): Range {
    const { subject, now } = this;
    if (subject.kind === "recovery" || subject.kind === "story") return subject.span;
    if (subject.kind === "next") {
      const last = subject.items[subject.items.length - 1]?.at ?? now;
      return { from: Math.max(LANES.from, now - LANES.fit.marginMin), to: Math.min(LANES.to, Math.max(last + LANES.fit.marginMin, now + LANES.fit.aheadMin)) };
    }
    const lanes = this.shown.map((s) => s.lane);
    const fit = fitWindow(lanes, now);
    if (!this.width) return fit;
    const c = this.ctx;
    c.font = this.font();
    let to = fit.to;
    for (const lane of lanes) {
      // Only words at the end of a bar need room after them. Any others can sit before their point.
      if (!lane.mark?.over || lane.mark.at <= fit.from) continue;
      const room = c.measureText(lane.mark.text).width + 2 * TEXT_GAP_REM * this.rem + 4;
      if (room < this.width) to = Math.max(to, fit.from + ((lane.mark.at - fit.from) * this.width) / (this.width - room));
    }
    return { from: fit.from, to: Math.min(LANES.to, to) };
  }

  setTheme(theme: LookTheme) {
    this.theme = theme;
    this.colorsStale = true;
    this.dirty = true;
  }

  setPointedLane(id: string | null) {
    if (id === this.pointedId) return;
    this.pointedId = id;
    this.dirty = true;
    // A curve you point at can be named further down the list.
    const row = this.shown.find((s) => s.lane.id === id)?.row;
    if (!row) return;
    if (row.offsetTop < this.rows.scrollTop) this.rows.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > this.rows.scrollTop + this.rows.clientHeight) this.rows.scrollTop = row.offsetTop + row.offsetHeight - this.rows.clientHeight;
  }

  setWholeDay(whole: boolean) {
    this.wholeDay = whole;
    this.manual = null;
    this.settled = false;
  }

  // What is on screen, which is where play starts over from.
  shownRange(): Range {
    return { ...this.goal() };
  }

  frame(dt: number, t: number) {
    if (t !== this.t) {
      this.t = t;
      this.settled = false;
      this.dirty = true;
    }
    if (!this.settled) this.ease(Math.min(dt, 0.05));
    if (!this.dirty) return;
    this.dirty = false;
    if (this.colorsStale) this.readColors();
    this.draw();
    this.writeRows();
  }

  private readColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    this.colors = { ink: read("--ink"), ink2: read("--ink-2"), ink3: read("--ink-3"), line: read("--line"), surface: read("--surface") };
    this.colorsStale = false;
  }

  private readonly measure = () => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio;
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    this.width = parent.clientWidth;
    this.height = parent.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.fit = this.framed();
    this.settled = false;
    this.dirty = true;
  };

  private topHeight = () => DAY_TOP_REM * this.rem;
  private rowsHeight = () => dayRowsRem(this.subject.kind) * this.rem;
  private x = (minute: number) => ((minute - this.view.from) / (this.view.to - this.view.from)) * this.width;
  private minuteAt = (x: number) => this.view.from + (x / (this.width || 1)) * (this.view.to - this.view.from);

  // What the chart is aiming to show: its own framing or your pan, always with the scrubber in it.
  private goal(): Range {
    const { span } = this;
    const base = this.manual ?? (this.wholeDay && !runsOverDays(this.subject) ? span : this.fit);
    return {
      from: Math.max(span.from, Math.min(base.from, this.t - VIEW_MARGIN_MIN)),
      to: Math.min(span.to, Math.max(base.to, this.t + VIEW_MARGIN_MIN)),
    };
  }

  private ease(dt: number) {
    const still = reducedMotion();
    const toward = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate));
    const goal = this.goal();
    const v = toward(MOTION.viewPerSecond);
    this.view.from += (goal.from - this.view.from) * v;
    this.view.to += (goal.to - this.view.to) * v;
    let moving = Math.abs(goal.from - this.view.from) > 0.2 || Math.abs(goal.to - this.view.to) > 0.2;
    if (!moving) this.view = { ...goal };
    this.shown.forEach((s) => {
      if (s.age < MOTION.drawInSeconds) {
        s.age = still ? MOTION.drawInSeconds : s.age + dt;
        moving = true;
      }
    });
    this.settled = !moving;
    this.dirty = true;
  }

  // Where a pointer lands: on something worth stopping at if one is close, unless shift says otherwise.
  private landing(x: number, y: number, free: boolean): { at: number; label: string | null } {
    const at = Math.max(this.span.from, Math.min(this.span.to, this.minuteAt(x)));
    if (free) return { at, label: null };
    const reach = (y < this.topHeight() ? SNAP_PX.top : SNAP_PX.lanes) * ((this.view.to - this.view.from) / (this.width || 1));
    let best: Anchor | null = null;
    for (const anchor of this.anchors) {
      const off = Math.abs(anchor.at - at);
      if (off <= reach && (!best || off < Math.abs(best.at - at) || (off === Math.abs(best.at - at) && anchor.label))) best = anchor;
    }
    return best ?? { at, label: null };
  }

  // The curve the pointer is on, if it is close enough to one to mean it.
  private laneAt(x: number, y: number): Lane | null {
    const top = this.topHeight();
    const height = this.rowsHeight();
    if (y < top || y >= top + height) return null;
    const minute = this.minuteAt(x);
    const floor = top + height - 1;
    const rise = height - LANE_MARGIN_PX - 1;
    let best: Lane | null = null;
    let nearest = NEAREST_LANE_PX;
    for (const { lane } of this.shown) {
      if (lane.mark?.over && minute > lane.mark.at) continue;
      const v = valueAt(lane.values, this.span, minute);
      if (lane.shape === "amount" && v <= NOTHING) continue;
      const off = Math.abs(floor - v * rise - y);
      if (off < nearest) {
        nearest = off;
        best = lane;
      }
    }
    return best;
  }

  private stopAt(x: number): number | null {
    let best: number | null = null;
    let nearest = Infinity;
    this.stopXs.forEach((at, index) => {
      if (Math.abs(at - x) < nearest) {
        nearest = Math.abs(at - x);
        best = index;
      }
    });
    return best;
  }

  private local(e: PointerEvent | WheelEvent) {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  private readonly moved = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    if (this.subject.kind === "story") {
      this.canvas.style.cursor = "pointer";
      const stop = this.stopAt(x);
      if (stop !== this.pointedStop) {
        this.pointedStop = stop;
        // Not every stop has room for its name along the top.
        this.canvas.title = stop === null ? "" : this.subject.stops[stop].label;
        this.dirty = true;
      }
      return;
    }
    this.pointer = { x, y, free: e.shiftKey };
    this.dirty = true;
    if (this.dragging) {
      if (this.pressedMoment && Math.abs(x - this.pressedMoment.x) > STILL_CLICK_PX) this.pressedMoment = null;
      this.events.scrub(this.landing(x, y, e.shiftKey).at);
      return;
    }
    const lane = this.laneAt(x, y);
    if ((lane?.id ?? null) !== this.pointedId) this.events.pointAtLane(lane);
    this.canvas.style.cursor = y < this.topHeight() && (this.momentAt(x) || this.landing(x, y, e.shiftKey).label) ? "pointer" : "ew-resize";
  };

  private readonly left = () => {
    if (this.dragging) return;
    this.pointer = null;
    this.pointedStop = null;
    this.dirty = true;
    if (this.pointedId) this.events.pointAtLane(null);
  };

  private readonly pressed = (e: PointerEvent) => {
    if (this.subject.kind === "story") {
      const stop = this.stopAt(this.local(e).x);
      if (stop !== null) this.events.goToStop(stop);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    const { x, y } = this.local(e);
    this.pointer = { x, y, free: e.shiftKey };
    const moment = y < this.topHeight() ? this.momentAt(x) : null;
    this.pressedMoment = moment?.intakes.length ? { moment, x } : null;
    this.events.scrub(moment ? moment.at : this.landing(x, y, e.shiftKey).at);
  };

  private readonly released = (e: PointerEvent) => {
    this.dragging = false;
    this.dirty = true;
    const pressed = this.pressedMoment;
    this.pressedMoment = null;
    if (pressed && e.type === "pointerup") this.events.fixMoment(pressed.moment, this.x(pressed.moment.at));
  };

  private momentAt(x: number): Moment | null {
    return this.momentHits.find((hit) => x >= hit.left && x <= hit.right)?.moment ?? null;
  }

  private readonly resetView = () => {
    this.manual = null;
    this.settled = false;
  };

  // Pinch to zoom around the pointer, swipe sideways to pan.
  private readonly wheeled = (e: WheelEvent) => {
    if (this.subject.kind === "story") return;
    const { span: all } = this;
    const zooming = e.ctrlKey || e.metaKey;
    if (!zooming && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const span = this.view.to - this.view.from;
    let next: Range;
    if (zooming) {
      const { x } = this.local(e);
      const pivot = this.minuteAt(x);
      const share = (pivot - this.view.from) / span;
      const wanted = Math.max(LEAST_SPAN_MIN, Math.min(all.to - all.from, span * Math.exp(e.deltaY * WHEEL.zoomPerPixel)));
      next = { from: pivot - share * wanted, to: pivot + (1 - share) * wanted };
    } else {
      const shift = (e.deltaX / (this.width || 1)) * span;
      next = { from: this.view.from + shift, to: this.view.to + shift };
    }
    const width = next.to - next.from;
    const from = Math.max(all.from, Math.min(all.to - width, next.from));
    this.manual = { from, to: from + width };
    this.settled = false;
  };

  private writeRows() {
    const pointer = this.pointer;
    const at = pointer && !this.dragging ? this.landing(pointer.x, pointer.y, pointer.free).at : this.t;
    for (const s of this.shown) {
      if (!s.value) continue;
      const said = s.lane.read(at);
      if (said !== s.said) {
        s.value.textContent = said;
        s.said = said;
      }
    }
  }

  private font(mono = false, weight = 400) {
    return `${weight} ${TEXT_REM * this.rem}px ${mono ? FONT_MONO : FONT_UI}`;
  }

  // Words on the chart. A line passing behind them is held off by a halo in the colour of the panel.
  private tag(text: string, x: number, y: number, color: string, { side = "after", halo = false }: { side?: "after" | "before"; halo?: boolean } = {}) {
    const c = this.ctx;
    const gap = TEXT_GAP_REM * this.rem;
    c.font = this.font();
    const wide = c.measureText(text).width;
    let left = side === "after" ? x + gap : x - gap - wide;
    if (left + wide > this.width - 2) left = x - gap - wide;
    left = Math.max(2, left);
    c.textBaseline = "middle";
    c.textAlign = "left";
    if (halo) {
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = this.colors.surface;
      c.strokeText(text, left, y);
    }
    c.fillStyle = color;
    c.fillText(text, left, y);
  }

  // The minutes to draw between two times, with the two ends exact.
  private minutes(from: number, to: number) {
    const { span } = this;
    const list = [from];
    const first = Math.ceil((from - span.from) / span.stepMin + 1e-6);
    for (let i = first; span.from + i * span.stepMin < to; i++) list.push(span.from + i * span.stepMin);
    list.push(to);
    return list;
  }

  // An amount: filled down to the floor of its row, and only drawn where there is something to draw.
  private area(lane: Lane, from: number, to: number, floor: number, rise: number, fill: number, stroke: number, dashed: boolean) {
    if (to <= from) return;
    const c = this.ctx;
    const minutes = this.minutes(from, to);
    let run: { x: number; y: number }[] = [];
    const flush = () => {
      if (run.length > 1) {
        c.beginPath();
        run.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.setLineDash(dashed ? FUTURE_DASH : []);
        c.globalAlpha = stroke;
        c.stroke();
        c.setLineDash([]);
        c.lineTo(run[run.length - 1].x, floor);
        c.lineTo(run[0].x, floor);
        c.closePath();
        if (fill > 0) {
          c.globalAlpha = fill;
          c.fill();
        }
      }
      run = [];
    };
    minutes.forEach((m, i) => {
      const v = valueAt(lane.values, this.span, m);
      const edge = valueAt(lane.values, this.span, minutes[i + 1] ?? m) > NOTHING || valueAt(lane.values, this.span, minutes[i - 1] ?? m) > NOTHING;
      if (v > NOTHING || edge) run.push({ x: this.x(m), y: floor - v * rise });
      else flush();
    });
    flush();
  }

  private line(values: Float32Array, from: number, to: number, floor: number, rise: number) {
    if (to <= from) return;
    const c = this.ctx;
    c.beginPath();
    this.minutes(from, to).forEach((m, i) => {
      const y = floor - valueAt(values, this.span, m) * rise;
      if (i) c.lineTo(this.x(m), y);
      else c.moveTo(this.x(m), y);
    });
    c.stroke();
  }

  // The one drawn large: the curve you are pointing at, otherwise what a what-if adds, otherwise the first.
  private loudLane(): Shown | null {
    return this.shown.find((s) => s.lane.id === this.pointedId) ?? this.shown.find((s) => s.lane.hypothetical) ?? this.shown[0] ?? null;
  }

  // Everything else stays in the chart as a thin line, so you still see what else is going on.
  private drawQuiet(s: Shown, top: number) {
    const c = this.ctx;
    const { lane } = s;
    const height = this.rowsHeight();
    const floor = top + height - 1;
    const rise = height - LANE_MARGIN_PX - 1;
    const nowAt = Math.max(this.view.from, Math.min(this.view.to, this.now));
    c.save();
    const drawn = easeOut(Math.min(1, s.age / MOTION.drawInSeconds));
    if (drawn < 1) {
      c.beginPath();
      c.rect(0, top, this.width * drawn, height);
      c.clip();
    }
    c.strokeStyle = SYSTEM_HUE[lane.hypothetical ? ACCENT_SYSTEM : lane.system][this.theme];
    c.lineJoin = "round";
    c.lineCap = "round";
    c.lineWidth = 1;
    if (lane.shape === "amount") {
      const end = lane.mark?.over ? Math.min(this.view.to, lane.mark.at) : this.view.to;
      this.area(lane, this.view.from, Math.min(nowAt, end), floor, rise, 0, ALPHA.quiet, false);
      this.area(lane, nowAt, end, floor, rise, 0, ALPHA.quiet * ALPHA.lineFuture, true);
    } else {
      c.globalAlpha = ALPHA.quiet;
      this.line(lane.values, this.view.from, nowAt, floor, rise);
      c.setLineDash(FUTURE_DASH);
      c.globalAlpha = ALPHA.quiet * ALPHA.lineFuture;
      this.line(lane.values, nowAt, this.view.to, floor, rise);
      c.setLineDash([]);
    }
    c.restore();
  }

  private drawLoud(s: Shown, top: number, cursor: number) {
    const c = this.ctx;
    const { lane } = s;
    const height = this.rowsHeight();
    // In a what-if, the new thing stands out from what is really in your day.
    const hue = SYSTEM_HUE[lane.hypothetical ? ACCENT_SYSTEM : lane.system][this.theme];
    const nowAt = Math.max(this.view.from, Math.min(this.view.to, this.now));
    c.save();
    // Something new draws itself in along the day.
    const drawn = easeOut(Math.min(1, s.age / MOTION.drawInSeconds));
    if (drawn < 1) {
      c.beginPath();
      c.rect(0, top, this.width * drawn, height);
      c.clip();
    }
    c.strokeStyle = hue;
    c.fillStyle = hue;
    c.lineJoin = "round";
    c.lineCap = "round";
    const floor = top + height - 1;
    const rise = height - LANE_MARGIN_PX - 1;
    const yOf = (minute: number) => floor - valueAt(lane.values, this.span, minute) * rise;
    // Your real day, behind what you are exploring.
    if (lane.ghost) {
      c.strokeStyle = this.colors.ink3;
      c.lineWidth = 1.2;
      c.lineJoin = "round";
      c.globalAlpha = 1;
      this.line(lane.ghost, this.view.from, this.view.to, floor, rise);
      c.strokeStyle = hue;
    }
    if (lane.shape === "amount") {
      // What is over is over: nothing is drawn past the moment it says so.
      const end = lane.mark?.over ? Math.min(this.view.to, lane.mark.at) : this.view.to;
      c.lineWidth = 1.4;
      this.area(lane, this.view.from, Math.min(nowAt, end), floor, rise, ALPHA.fillPast, 1, false);
      c.lineWidth = 1.2;
      this.area(lane, nowAt, end, floor, rise, ALPHA.fillFuture, ALPHA.lineFuture, true);
    } else {
      if (lane.band) {
        c.globalAlpha = ALPHA.band;
        const yHigh = floor - lane.band.high * rise;
        const yLow = floor - lane.band.low * rise;
        c.fillRect(0, yHigh, this.width, yLow - yHigh);
      }
      c.lineWidth = 1.4;
      c.globalAlpha = 1;
      this.line(lane.values, this.view.from, nowAt, floor, rise);
      c.lineWidth = 1.2;
      c.setLineDash(FUTURE_DASH);
      c.globalAlpha = ALPHA.lineFuture;
      this.line(lane.values, nowAt, this.view.to, floor, rise);
      c.setLineDash([]);
    }
    // Where the line is at the minute you are looking at.
    if (valueAt(lane.values, this.span, cursor) > NOTHING) {
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(this.x(cursor), yOf(cursor), 2.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.globalAlpha = drawn;
    const pointed = this.pointedId === lane.id;
    const color = pointed ? this.colors.ink : this.colors.ink2;
    const textHalf = (TEXT_REM * this.rem) / 2;
    if (pointed && lane.band) this.tag(lane.band.label, 0, top + textHalf + 1, this.colors.ink3, { halo: true });
    if (lane.mark && lane.mark.at >= this.view.from && lane.mark.at <= this.view.to) {
      const x = this.x(lane.mark.at);
      const y = yOf(lane.mark.at);
      c.fillStyle = this.colors.surface;
      c.strokeStyle = hue;
      c.lineWidth = 1.3;
      c.beginPath();
      c.arc(x, y, 2.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      // Past the end of a curve there is nothing in the way, unless the words have to sit back over it.
      // Otherwise they keep clear of the line.
      c.font = this.font();
      const fitsAfter = x + TEXT_GAP_REM * this.rem + c.measureText(lane.mark.text).width <= this.width - 2;
      const above = y - textHalf - 3;
      const clear = above - textHalf >= top ? above : Math.min(floor - textHalf, y + textHalf + 3);
      const textY = lane.mark.over && fitsAfter ? Math.max(top + textHalf, Math.min(floor - textHalf, y - 1)) : clear;
      this.tag(lane.mark.text, x, textY, color, { halo: !lane.mark.over || !fitsAfter });
    } else if (lane.beyond) {
      this.tag(`${lane.beyond} →`, this.width, top + textHalf + 1, color, { side: "before" });
    }
    c.globalAlpha = 1;
  }

  // Which day it is, as well as the time, when the chart runs over more than one.
  private timeWords(minute: number) {
    const clock = formatClock(minute);
    if (!runsOverDays(this.subject)) return clock;
    const day = Math.floor(minute / 1440);
    return day === 0 ? clock : `${dayWord(day)} ${clock}`;
  }

  // A line down the chart, or where words sit in the way, just its two ends.
  private cursorLine(x: number, top: number, color: string) {
    const c = this.ctx;
    c.fillStyle = color;
    const height = this.rowsHeight();
    if (this.subject.kind === "next") {
      c.fillRect(x - 0.5, top - 3, 1, 3);
      c.fillRect(x - 0.5, top + height - CURSOR_TICK_PX, 1, CURSOR_TICK_PX);
    } else c.fillRect(x - 0.5, top - 3, 1, height + 3);
  }

  // A walkthrough's steps along the top, close ones held far enough apart to click. The one you are on always
  // gets its name, and the others where there is room.
  private drawStops(stops: { at: number; label: string }[], current: number, top: number) {
    const c = this.ctx;
    const gap = 0.4 * this.rem;
    const labelY = top - (DAY_TOP_REM * this.rem) / 2 + 1;
    this.stopXs = [];
    for (const stop of stops) {
      const last = this.stopXs[this.stopXs.length - 1];
      this.stopXs.push(last === undefined ? this.x(stop.at) : Math.max(this.x(stop.at), last + STOP_GAP_PX));
    }
    const place = (index: number) => {
      c.font = this.font(false, index === current ? 500 : 400);
      const wide = c.measureText(stops[index].label).width;
      return { left: Math.max(0, Math.min(this.width - wide, this.stopXs[index] + gap)), wide };
    };
    const lit = place(current);
    const taken = [{ left: lit.left, right: lit.left + lit.wide }];
    let free = 0;
    stops.forEach((_, index) => {
      c.fillStyle = index === current ? this.colors.ink : this.colors.ink3;
      c.fillRect(this.stopXs[index] - 0.5, top - 4, 1, 4);
      const { left, wide } = place(index);
      const right = left + wide;
      if (index !== current && (left < free || taken.some((t) => left < t.right + gap && right > t.left - gap))) return;
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillStyle = index === current || index === this.pointedStop ? this.colors.ink : this.colors.ink2;
      c.fillText(stops[index].label, left, labelY);
      free = right + gap * 2;
    });
  }

  // The time on a vertical line, kept clear of the one already drawn.
  private pill(x: number, text: string, solid: boolean, clearOf: { left: number; right: number } | null = null) {
    const c = this.ctx;
    const pad = PILL_PAD_REM * this.rem;
    const high = PILL_HEIGHT_REM * this.rem;
    c.font = this.font(true, 500);
    const wide = c.measureText(text).width + pad * 2;
    let left = Math.max(0, Math.min(this.width - wide, x - wide / 2));
    if (clearOf && left < clearOf.right + 2 && left + wide > clearOf.left - 2) {
      left = x >= (clearOf.left + clearOf.right) / 2 ? clearOf.right + 2 : clearOf.left - 2 - wide;
      left = Math.max(0, Math.min(this.width - wide, left));
    }
    c.beginPath();
    c.roundRect(left, 0, wide, high, 0.3 * this.rem);
    c.fillStyle = solid ? this.colors.ink : this.colors.surface;
    c.fill();
    if (!solid) {
      c.strokeStyle = this.colors.ink3;
      c.lineWidth = 1;
      c.stroke();
    }
    c.fillStyle = solid ? this.colors.surface : this.colors.ink;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(text, left + pad, high / 2 + 0.5);
    return { left, right: left + wide };
  }

  private draw() {
    const c = this.ctx;
    const dpr = window.devicePixelRatio;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    if (!this.width) return;
    const top = this.topHeight();
    const bottom = top + this.rowsHeight();
    const pointer = this.pointer;
    const hover = pointer && !this.dragging ? this.landing(pointer.x, pointer.y, pointer.free) : null;
    const cursor = hover ? hover.at : this.t;

    const rows = this.rowsHeight();
    c.fillStyle = this.colors.line;
    if (this.subject.kind !== "next") c.fillRect(0, top - 0.5, this.width, 1);
    if (rows) c.fillRect(0, bottom - 0.5, this.width, 1);
    const loud = this.loudLane();
    for (const s of this.shown) if (s !== loud) this.drawQuiet(s, top);
    if (loud) this.drawLoud(loud, top, cursor);

    // Along the bottom: the days when it runs over several, otherwise the hours, as often as there is room for.
    const axisY = bottom + (DAY_HOURS_REM * this.rem) / 2 + 1;
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.fillStyle = this.colors.ink3;
    if (runsOverDays(this.subject)) {
      c.font = this.font();
      for (let day = Math.ceil(this.view.from / 1440); day * 1440 <= this.view.to; day++) {
        const label = dayWord(day);
        c.fillText(label, Math.max(0, Math.min(this.width - c.measureText(label).width, this.x(day * 1440))), axisY);
      }
    } else {
      const perHour = (this.width / (this.view.to - this.view.from)) * 60;
      const step = HOUR_STEPS.find((h) => perHour >= h.leastPxPerHour)?.step ?? 4;
      c.font = this.font(true);
      for (let h = Math.ceil(this.view.from / 60 / step) * step; h * 60 <= this.view.to; h += step) {
        const x = this.x(h * 60);
        const label = String(h % 24).padStart(2, "0");
        const wide = c.measureText(label).width;
        c.fillText(label, Math.max(0, Math.min(this.width - wide, x - wide / 2)), axisY);
      }
    }

    // What comes next has its own ticks on the time, under the words that name it.
    if (this.subject.kind === "next") {
      c.fillStyle = this.colors.ink2;
      for (const item of this.subject.items) c.fillRect(this.x(item.at) - 0.5, bottom - ITEM_TICK_PX, 1, ITEM_TICK_PX);
    }

    const away = Math.abs(this.t - this.now) >= 1;
    const nowX = this.x(Math.max(this.view.from, Math.min(this.view.to, this.now)));
    if (away) this.cursorLine(nowX, top, this.colors.ink3);
    const scrubX = this.x(this.t);
    this.cursorLine(scrubX, top, this.colors.ink);

    // A walkthrough's own steps say where you are, so it needs no time written on the line.
    if (this.subject.kind === "story") {
      this.drawStops(this.subject.stops, this.subject.current, top);
      this.momentHits = [];
      return;
    }

    // Where the scrubber and the pointer are comes first, so the names along the top can keep clear of them.
    const taken: { left: number; right: number }[] = [];
    if (hover) this.cursorLine(this.x(hover.at), top, this.colors.ink3);
    const scrubPill = this.pill(scrubX, this.timeWords(this.t), true);
    taken.push(scrubPill);
    if (hover && Math.abs(hover.at - this.t) >= 1) taken.push(this.pill(this.x(hover.at), hover.label ? `${this.timeWords(hover.at)} ${hover.label}` : this.timeWords(hover.at), false, scrubPill));

    c.font = this.font();
    c.textBaseline = "middle";
    c.textAlign = "left";
    const labelY = top - (DAY_TOP_REM * this.rem) / 2 + 1;
    const gap = 0.4 * this.rem;
    if (away) {
      const wide = c.measureText("now").width;
      const left = nowX - wide / 2;
      if (!taken.some((t) => left < t.right + gap && left + wide > t.left - gap)) {
        c.fillStyle = this.colors.ink3;
        c.fillText("now", left, labelY);
        taken.push({ left, right: left + wide });
      }
    }
    if (this.shown.some((s) => s.lane.ghost)) {
      const wide = c.measureText(GHOST_NOTE).width;
      const left = this.width - wide;
      if (!taken.some((t) => left < t.right + gap && this.width > t.left - gap)) {
        c.fillStyle = this.colors.ink3;
        c.fillText(GHOST_NOTE, left, labelY);
        taken.push({ left, right: this.width });
      }
    }
    let free = 0;
    const hits: MomentHit[] = [];
    for (const moment of momentsOf(this.subject)) {
      if (moment.at < this.view.from || moment.at > this.view.to) continue;
      const x = this.x(moment.at);
      c.fillStyle = this.colors.ink3;
      c.fillRect(x - 0.5, top - 4, 1, 4);
      const wide = c.measureText(moment.label).width;
      const left = x + gap;
      const right = left + wide;
      if (left < free || right > this.width || taken.some((t) => left < t.right + gap && right > t.left - gap)) {
        hits.push({ moment, left: x - TICK_REACH_PX, right: x + TICK_REACH_PX });
        continue;
      }
      hits.push({ moment, left: x - TICK_REACH_PX, right });
      c.fillStyle = hover?.label === moment.label ? this.colors.ink : this.colors.ink2;
      c.fillText(moment.label, left, labelY);
      // A dotted underline says this one can be corrected.
      if (moment.intakes.length) {
        const y = labelY + (TEXT_REM * this.rem) / 2 + 1.5;
        c.beginPath();
        c.moveTo(left, y);
        c.lineTo(right, y);
        c.setLineDash(CORRECTABLE_DOTS);
        c.lineWidth = 1;
        c.strokeStyle = this.colors.ink3;
        c.stroke();
        c.setLineDash([]);
      }
      free = right + gap * 2;
    }
    this.momentHits = hits;
  }
}
