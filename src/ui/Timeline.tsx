import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayMoments, dayStops, Lane, muscleStateLanes, processLanes, readingLanes, systemLanes, workedMuscleLanes } from "../model/lanes";
import { LANES } from "../model/params";
import { formatClock } from "../model/state";
import type { Stage } from "../scene/stage";
import { getState, selectedProcess, setUi, useStore } from "../store";
import { viewSystemOf } from "../look";
import { DAY_HOURS_REM, DAY_ROWS_REM, DAY_TOP_REM, DayChart } from "./dayChart";
import { FoodFix } from "./FoodFix";
import { useFrame } from "./hooks";
import { organStory } from "./insets/organStory";
import { Pause, Play, SkipBack, SkipForward } from "./icons";
import { showMuscle, showOrgan, showProcess } from "./navigation";

export const DAY_FROM = LANES.from;
export const DAY_TO = LANES.to;

const KEY_STEP_MINUTES = 5;
const KEY_STEP_LARGE_MINUTES = 30;

function useLanes(): Lane[] {
  const tr = useStore((s) => s.trajectory);
  const now = useStore((s) => Math.round(s.body.now));
  const system = useStore((s) => s.body.system);
  const processId = useStore((s) => s.body.process);
  const focus = useStore((s) => s.body.focus);
  const focusMuscle = useStore((s) => s.body.focusMuscle);
  const real = useStore((s) => (s.asking && s.asking.realDerived.trajectory !== s.trajectory ? s.asking.realDerived.trajectory : null));
  return useMemo(() => {
    if (focus === "muscle") return focusMuscle ? muscleStateLanes(tr, now, focusMuscle) : workedMuscleLanes(tr, now);
    if (focus) {
      const hue = viewSystemOf({ system, process: selectedProcess(getState()), focus });
      return readingLanes(tr, now, organStory(focus, tr, now).rows, hue, real);
    }
    if (processId) return processLanes(tr, now, processId, real);
    return systemLanes(tr, now, system, real);
  }, [tr, real, now, system, processId, focus, focusMuscle]);
}

const pointAtLane = (lane: Lane | null) =>
  setUi({
    hoverLane: lane?.id ?? null,
    hover: lane?.organ ?? null,
    hoverMuscle: lane?.target?.kind === "muscle" ? lane.target.group : null,
  });

function goToLane(lane: Lane) {
  const { target } = lane;
  if (!target) return;
  if (target.kind === "process") showProcess(target.id);
  else if (target.kind === "organ") showOrgan(target.organ);
  else if (target.kind === "muscle") showMuscle(target.group);
  else setUi({ stop: target.number });
}

// A name, and what is there at the minute you are looking at. The chart writes that value and this
// row's height itself, because both change far more often than React should.
function LaneRow({ lane, hot }: { lane: Lane; hot: boolean }) {
  return (
    <button type="button" className="day-row" data-lane={lane.id} data-hot={hot || undefined} disabled={!lane.target} title={lane.label} onClick={() => goToLane(lane)} onPointerEnter={() => pointAtLane(lane)} onPointerLeave={() => pointAtLane(null)}>
      {lane.badge.kind === "number" ? <span className="day-number">{lane.badge.number}</span> : null}
      <span className="day-name">{lane.label}</span>
      <span className="day-value" />
    </button>
  );
}

// The day under the body. What runs out is an area that ends where it ends, what never does is a line
// against its typical band, and each row reads out its value at the minute under your pointer.
//
// Moving through it works like any player: skip between the moments that matter, play forward from
// where you are, or drag along it. Back to now is always in the same place. The two words under the
// names decide how much of the day is shown.
export function Timeline({ stage }: { stage: Stage | null }) {
  const theme = useStore((s) => s.theme);
  const tr = useStore((s) => s.trajectory);
  const now = useStore((s) => s.body.now);
  const playing = useStore((s) => s.playing);
  const away = useStore((s) => Math.abs(Math.round(s.t) - Math.round(s.body.now)) >= 1);
  const hoverLane = useStore((s) => s.hoverLane);
  const lanes = useLanes();
  const moments = useMemo(() => dayMoments(tr, now), [tr, now]);
  const stops = useMemo(() => dayStops(lanes, moments, now).map((stop) => stop.at), [lanes, moments, now]);
  const previous = useStore((s) => stops.filter((at) => at < s.t - 0.5).at(-1) ?? null);
  const next = useStore((s) => stops.find((at) => at > s.t + 0.5) ?? null);
  const [wholeDay, setWholeDay] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const chart = useRef<DayChart | null>(null);

  useLayoutEffect(() => {
    const el = canvas.current;
    const list = rows.current;
    if (!el || !list) return;
    const made = new DayChart(el, list, {
      scrub: (minute) => setUi({ t: minute, playing: false }),
      pointAtLane,
      fixMoment: (moment, x) => setUi({ fixing: { ids: moment.intakes, x: (plot.current?.offsetLeft ?? 0) + x } }),
    });
    chart.current = made;
    return () => {
      made.dispose();
      chart.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    chart.current?.setData(lanes, moments, now);
  }, [lanes, moments, now]);

  useEffect(() => chart.current?.setTheme(theme), [theme]);
  useEffect(() => chart.current?.setPointedLane(hoverLane), [hoverLane]);

  useFrame(stage, (_, dt) => {
    const t = getState().t;
    chart.current?.frame(dt, t);
    const area = plot.current;
    if (!area) return;
    const minute = String(Math.round(t));
    if (area.getAttribute("aria-valuenow") !== minute) {
      area.setAttribute("aria-valuenow", minute);
      area.setAttribute("aria-valuetext", formatClock(t));
    }
  });

  const goTo = (minute: number | null) => {
    if (minute !== null) setUi({ t: minute, playing: false });
  };

  // Plays forward to the last moment there is, from the start of what is shown if it is already there.
  const togglePlay = () => {
    if (playing) {
      setUi({ playing: false });
      return;
    }
    const { from } = chart.current?.shownRange() ?? { from: DAY_FROM };
    const end = stops.at(-1) ?? DAY_TO;
    const t = getState().t;
    setUi({ playing: true, playUntil: end, t: t >= end - 1 ? from : t });
  };

  const showRange = (whole: boolean) => {
    setWholeDay(whole);
    chart.current?.setWholeDay(whole);
  };

  const key = (e: KeyboardEvent) => {
    const s = getState();
    // A walkthrough owns the arrow keys while it runs.
    if (s.touring) return;
    const step = e.shiftKey ? KEY_STEP_LARGE_MINUTES : KEY_STEP_MINUTES;
    if (e.key === "ArrowLeft") setUi({ t: Math.max(DAY_FROM, s.t - step), playing: false });
    else if (e.key === "ArrowRight") setUi({ t: Math.min(DAY_TO, s.t + step), playing: false });
    else if (e.key === "Home") setUi({ t: DAY_FROM, playing: false });
    else if (e.key === "End") setUi({ t: DAY_TO, playing: false });
    else if (e.key === ",") goTo(previous);
    else if (e.key === ".") goTo(next);
    else return;
    e.preventDefault();
  };

  return (
    <section className="day" style={{ "--day-top": `${DAY_TOP_REM}rem`, "--day-rows": `${DAY_ROWS_REM}rem`, "--day-hours": `${DAY_HOURS_REM}rem` }} aria-label="Today, and when each thing ends">
      <div className="day-side">
        <div className="transport">
          <button type="button" className="icon-button" aria-label="Previous moment" title="Previous moment" disabled={previous === null} onClick={() => goTo(previous)}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play forward"} title={playing ? "Pause" : "Play forward"} aria-pressed={playing} onClick={togglePlay}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" className="icon-button" aria-label="Next moment" title="Next moment" disabled={next === null} onClick={() => goTo(next)}>
            <SkipForward weight="fill" />
          </button>
          {away ? (
            <button type="button" className="to-now" onClick={() => setUi({ t: now, playing: false })}>
              Back to now
            </button>
          ) : (
            <span className="at-now">Now</span>
          )}
        </div>
        <div ref={rows} className="day-rows">
          {lanes.map((lane) => (
            <LaneRow key={lane.id} lane={lane} hot={lane.id === hoverLane} />
          ))}
          {lanes.length ? null : <p className="day-empty">Nothing here yet</p>}
        </div>
        <div className="day-range" role="radiogroup" aria-label="How much of the day to show">
          <button type="button" className="toggle" role="radio" aria-checked={!wholeDay} title="From where this began to where it ends" onClick={() => showRange(false)}>
            Focus
          </button>
          <button type="button" className="toggle" role="radio" aria-checked={wholeDay} title={`${formatClock(DAY_FROM)} to ${formatClock(DAY_TO)}`} onClick={() => showRange(true)}>
            Whole day
          </button>
        </div>
      </div>
      <div ref={plot} className="day-plot" role="slider" tabIndex={0} aria-label="Time of day" aria-valuemin={DAY_FROM} aria-valuemax={DAY_TO} onKeyDown={key}>
        <canvas ref={canvas} aria-hidden="true" />
      </div>
      <FoodFix />
    </section>
  );
}
