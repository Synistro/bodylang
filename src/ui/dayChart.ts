import { ACCENT_SYSTEM, LookTheme, SYSTEM_HUE } from "../look";
import { dayStops, fitWindow, Lane, laneMinute, Moment } from "../model/lanes";
import { LANES } from "../model/params";
import { formatClock } from "../model/state";

interface Range {
  from: number;
  to: number;
}

interface Shown {
  lane: Lane;
  height: number;
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
}

interface MomentHit {
  moment: Moment;
  left: number;
  right: number;
}

// The chart's rows, in rem. The column of names beside it uses the same numbers.
export const DAY_TOP_REM = 2;
export const DAY_ROWS_REM = 8.4;
export const DAY_HOURS_REM = 1.6;

const FULL_DAY: Range = { from: LANES.from, to: LANES.to };
const NOTHING = 0.006; // of a lane, below which an amount has run out
const FONT_UI = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';
const TEXT_REM = 1.1;
const TEXT_GAP_REM = 0.6;
const PILL_HEIGHT_REM = 1.6;
const PILL_PAD_REM = 0.5;
const ALPHA = { fillPast: 0.3, fillFuture: 0.1, band: 0.1, lineFuture: 0.8, dimmed: 0.55 };
const LANE_MARGIN_PX = 3;
const FUTURE_DASH = [3, 3];
const GHOST_NOTE = "Grey is your day";
const SNAP_PX = { lanes: 7, top: 22 };
const TICK_REACH_PX = 7;
const STILL_CLICK_PX = 4;
const CORRECTABLE_DOTS = [1, 2];
const MOTION = { viewPerSecond: 9, heightPerSecond: 14, drawInSeconds: 0.45 };
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

const valueAt = (values: Float32Array, minute: number) => {
  const at = Math.max(0, Math.min(values.length - 1, (minute - LANES.from) / LANES.stepMin));
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
  private shown: Shown[] = [];
  private moments: Moment[] = [];
  private anchors: Anchor[] = [];
  private now: number = LANES.from;
  private t: number = LANES.from;
  private fit: Range = FULL_DAY;
  private view: Range = { ...FULL_DAY };
  private manual: Range | null = null;
  private wholeDay = false;
  private pointedId: string | null = null;
  private pointer: { x: number; y: number; free: boolean } | null = null;
  private dragging = false;
  private momentHits: MomentHit[] = [];
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

  setData(lanes: Lane[], moments: Moment[], now: number) {
    const before = new Map(this.shown.map((s) => [s.lane.id, s]));
    const allNew = !lanes.some((lane) => before.has(lane.id));
    this.shown = lanes.map((lane) => {
      const kept = before.get(lane.id);
      if (kept) return { ...kept, lane, said: "" };
      return { lane, height: this.rowsHeight() / Math.max(1, lanes.length), age: 0, row: null, value: null, said: "" };
    });
    for (const s of this.shown) {
      s.row = this.rows.querySelector<HTMLElement>(`[data-lane="${s.lane.id}"]`);
      s.value = s.row?.querySelector<HTMLElement>(".day-value") ?? null;
    }
    // A new subject starts framed by its own story, whatever you had panned to before.
    if (allNew) this.manual = null;
    this.moments = moments;
    this.now = now;
    this.fit = this.framed();
    this.anchors = dayStops(lanes, moments, now);
    this.settled = false;
    this.dirty = true;
  }

  // The model's framing, stretched just enough for the words at the end of each row to fit after it.
  private framed(): Range {
    const lanes = this.shown.map((s) => s.lane);
    const fit = fitWindow(lanes, this.now);
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
  private rowsHeight = () => DAY_ROWS_REM * this.rem;
  private x = (minute: number) => ((minute - this.view.from) / (this.view.to - this.view.from)) * this.width;
  private minuteAt = (x: number) => this.view.from + (x / (this.width || 1)) * (this.view.to - this.view.from);

  // What the chart is aiming to show: its own framing or your pan, always with the scrubber in it.
  private goal(): Range {
    const base = this.manual ?? (this.wholeDay ? FULL_DAY : this.fit);
    return {
      from: Math.max(LANES.from, Math.min(base.from, this.t - VIEW_MARGIN_MIN)),
      to: Math.min(LANES.to, Math.max(base.to, this.t + VIEW_MARGIN_MIN)),
    };
  }

  private goalHeights() {
    return this.shown.map(() => this.rowsHeight() / Math.max(1, this.shown.length));
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
    const heights = this.goalHeights();
    const h = toward(MOTION.heightPerSecond);
    this.shown.forEach((s, i) => {
      s.height += (heights[i] - s.height) * h;
      if (Math.abs(heights[i] - s.height) > 0.2) moving = true;
      else s.height = heights[i];
      if (s.row) s.row.style.height = `${s.height.toFixed(2)}px`;
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
    const at = Math.max(LANES.from, Math.min(LANES.to, this.minuteAt(x)));
    if (free) return { at, label: null };
    const reach = (y < this.topHeight() ? SNAP_PX.top : SNAP_PX.lanes) * ((this.view.to - this.view.from) / (this.width || 1));
    let best: Anchor | null = null;
    for (const anchor of this.anchors) {
      const off = Math.abs(anchor.at - at);
      if (off <= reach && (!best || off < Math.abs(best.at - at) || (off === Math.abs(best.at - at) && anchor.label))) best = anchor;
    }
    return best ?? { at, label: null };
  }

  private laneAtY(y: number): Lane | null {
    let top = this.topHeight();
    for (const s of this.shown) {
      if (y >= top && y < top + s.height) return s.lane;
      top += s.height;
    }
    return null;
  }

  private local(e: PointerEvent | WheelEvent) {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  private readonly moved = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    this.pointer = { x, y, free: e.shiftKey };
    this.dirty = true;
    if (this.dragging) {
      if (this.pressedMoment && Math.abs(x - this.pressedMoment.x) > STILL_CLICK_PX) this.pressedMoment = null;
      this.events.scrub(this.landing(x, y, e.shiftKey).at);
      return;
    }
    const lane = this.laneAtY(y);
    if ((lane?.id ?? null) !== this.pointedId) this.events.pointAtLane(lane);
    this.canvas.style.cursor = y < this.topHeight() && (this.momentAt(x) || this.landing(x, y, e.shiftKey).label) ? "pointer" : "ew-resize";
  };

  private readonly left = () => {
    if (this.dragging) return;
    this.pointer = null;
    this.dirty = true;
    if (this.pointedId) this.events.pointAtLane(null);
  };

  private readonly pressed = (e: PointerEvent) => {
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
    const zooming = e.ctrlKey || e.metaKey;
    if (!zooming && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const span = this.view.to - this.view.from;
    let next: Range;
    if (zooming) {
      const { x } = this.local(e);
      const pivot = this.minuteAt(x);
      const share = (pivot - this.view.from) / span;
      const wanted = Math.max(LEAST_SPAN_MIN, Math.min(LANES.to - LANES.from, span * Math.exp(e.deltaY * WHEEL.zoomPerPixel)));
      next = { from: pivot - share * wanted, to: pivot + (1 - share) * wanted };
    } else {
      const shift = (e.deltaX / (this.width || 1)) * span;
      next = { from: this.view.from + shift, to: this.view.to + shift };
    }
    const width = next.to - next.from;
    const from = Math.max(LANES.from, Math.min(LANES.to - width, next.from));
    this.manual = { from, to: from + width };
    this.settled = false;
  };

  private writeRows() {
    const pointer = this.pointer;
    const at = pointer && !this.dragging ? this.landing(pointer.x, pointer.y, pointer.free).at : this.t;
    for (const s of this.shown) {
      const said = s.lane.read(at);
      if (s.value && said !== s.said) {
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
    const list = [from];
    const first = Math.ceil((from - LANES.from) / LANES.stepMin + 1e-6);
    for (let i = first; laneMinute(i) < to; i++) list.push(laneMinute(i));
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
        c.globalAlpha = fill;
        c.fill();
      }
      run = [];
    };
    minutes.forEach((m, i) => {
      const v = valueAt(lane.values, m);
      const edge = valueAt(lane.values, minutes[i + 1] ?? m) > NOTHING || valueAt(lane.values, minutes[i - 1] ?? m) > NOTHING;
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
      const y = floor - valueAt(values, m) * rise;
      if (i) c.lineTo(this.x(m), y);
      else c.moveTo(this.x(m), y);
    });
    c.stroke();
  }

  private drawLane(s: Shown, top: number, cursor: number) {
    const c = this.ctx;
    const { lane, height } = s;
    // In a what-if, the new thing stands out from what is really in your day.
    const hue = SYSTEM_HUE[lane.hypothetical ? ACCENT_SYSTEM : lane.system][this.theme];
    const dim = this.pointedId !== null && this.pointedId !== lane.id ? ALPHA.dimmed : 1;
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
    const yOf = (minute: number) => floor - valueAt(lane.values, minute) * rise;
    // Your real day, behind what you are exploring.
    if (lane.ghost) {
      c.strokeStyle = this.colors.ink3;
      c.lineWidth = 1.2;
      c.lineJoin = "round";
      c.globalAlpha = dim;
      this.line(lane.ghost, this.view.from, this.view.to, floor, rise);
      c.strokeStyle = hue;
    }
    if (lane.shape === "amount") {
      // What is over is over: nothing is drawn past the moment it says so.
      const end = lane.mark?.over ? Math.min(this.view.to, lane.mark.at) : this.view.to;
      c.lineWidth = 1.4;
      this.area(lane, this.view.from, Math.min(nowAt, end), floor, rise, ALPHA.fillPast * dim, dim, false);
      c.lineWidth = 1.2;
      this.area(lane, nowAt, end, floor, rise, ALPHA.fillFuture * dim, ALPHA.lineFuture * dim, true);
    } else {
      if (lane.band) {
        c.globalAlpha = ALPHA.band * dim;
        const yHigh = floor - lane.band.high * rise;
        const yLow = floor - lane.band.low * rise;
        c.fillRect(0, yHigh, this.width, yLow - yHigh);
      }
      c.lineWidth = 1.4;
      c.globalAlpha = dim;
      this.line(lane.values, this.view.from, nowAt, floor, rise);
      c.lineWidth = 1.2;
      c.setLineDash(FUTURE_DASH);
      c.globalAlpha = ALPHA.lineFuture * dim;
      this.line(lane.values, nowAt, this.view.to, floor, rise);
      c.setLineDash([]);
    }
    // Where the line is at the minute you are looking at.
    if (valueAt(lane.values, cursor) > NOTHING) {
      c.globalAlpha = dim;
      c.beginPath();
      c.arc(this.x(cursor), yOf(cursor), 2.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.globalAlpha = drawn * dim;
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
      // Past the end of a curve there is nothing in the way. Otherwise the words sit clear of the line.
      const above = y - textHalf - 3;
      const textY = lane.mark.over ? Math.max(top + textHalf, Math.min(floor - textHalf, y - 1)) : above - textHalf >= top ? above : Math.min(floor - textHalf, y + textHalf + 3);
      this.tag(lane.mark.text, x, textY, color, { halo: !lane.mark.over });
    } else if (lane.beyond) {
      this.tag(`${lane.beyond} →`, this.width, top + textHalf + 1, color, { side: "before" });
    }
    c.globalAlpha = 1;
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

    let y = top;
    c.fillStyle = this.colors.line;
    c.fillRect(0, top - 0.5, this.width, 1);
    for (const s of this.shown) {
      this.drawLane(s, y, cursor);
      y += s.height;
      c.fillStyle = this.colors.line;
      c.fillRect(0, y - 0.5, this.width, 1);
    }

    // The hours, as often as there is room for.
    const perHour = (this.width / (this.view.to - this.view.from)) * 60;
    const step = HOUR_STEPS.find((h) => perHour >= h.leastPxPerHour)?.step ?? 4;
    c.font = this.font(true);
    c.textBaseline = "middle";
    c.fillStyle = this.colors.ink3;
    for (let h = Math.ceil(this.view.from / 60 / step) * step; h * 60 <= this.view.to; h += step) {
      const x = this.x(h * 60);
      const label = String(h % 24).padStart(2, "0");
      const wide = c.measureText(label).width;
      c.textAlign = "left";
      c.fillText(label, Math.max(0, Math.min(this.width - wide, x - wide / 2)), bottom + (DAY_HOURS_REM * this.rem) / 2 + 1);
    }

    // Where the scrubber and the pointer are comes first, so the names along the top can keep clear of them.
    const taken: { left: number; right: number }[] = [];
    const away = Math.abs(this.t - this.now) >= 1;
    if (away) {
      const x = this.x(Math.max(this.view.from, Math.min(this.view.to, this.now)));
      c.fillStyle = this.colors.ink3;
      c.fillRect(x - 0.5, top - 3, 1, this.rowsHeight() + 3);
    }
    const scrubX = this.x(this.t);
    c.fillStyle = this.colors.ink;
    c.fillRect(scrubX - 0.5, top - 3, 1, this.rowsHeight() + 3);
    if (hover) {
      const x = this.x(hover.at);
      c.fillStyle = this.colors.ink3;
      c.fillRect(x - 0.5, top, 1, this.rowsHeight());
    }
    const scrubPill = this.pill(scrubX, formatClock(this.t), true);
    taken.push(scrubPill);
    if (hover && Math.abs(hover.at - this.t) >= 1) taken.push(this.pill(this.x(hover.at), hover.label ? `${formatClock(hover.at)} ${hover.label}` : formatClock(hover.at), false, scrubPill));

    c.font = this.font();
    c.textBaseline = "middle";
    c.textAlign = "left";
    const labelY = top - (DAY_TOP_REM * this.rem) / 2 + 1;
    const gap = 0.4 * this.rem;
    if (away) {
      const x = this.x(Math.max(this.view.from, Math.min(this.view.to, this.now)));
      const wide = c.measureText("now").width;
      const left = x - wide / 2;
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
    for (const moment of this.moments) {
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
