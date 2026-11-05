import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Lane, muscleStateLanes, MuscleSubject, processLanes, readingLanes, systemLanes, workedMuscleLanes } from "../model/lanes";
import { LANES } from "../model/params";
import { assess } from "../model/assess";
import { foodOrigin, modelOrigin, Origin, processOrigin, readingOrigin, SENTENCE_ORIGIN } from "../model/origin";
import { REFERENCE } from "../model/params";
import { processesAt } from "../model/processes";
import type { Trajectory } from "../model/simulate";
import { formatClock } from "../model/state";
import type { Stage } from "../scene/stage";
import { systemById } from "../model/systems";
import { AppState, getState, goToStep, muscleMinute, releaseMoment, selectedProcess, setUi, showMuscleMinute, useStore, yourDayWhileAsking } from "../store";
import { viewSystemOf } from "../look";
import { DAY_HOURS_REM, DAY_ROW_REM, DAY_TOP_REM, dayRowsRem, DayChart } from "./dayChart";
import { DayView, dayViewOf, lanesOf, runsOverDays, viewStops } from "./dayView";
import { FoodFix } from "./FoodFix";
import { useFrame } from "./hooks";
import { organStory } from "./insets/organStory";
import { Pause, Play, SkipBack, SkipForward } from "./icons";
import { showMuscle, showOrgan, showProcess } from "./navigation";
import { sourced } from "./SourceTip";

const DAY_FROM = LANES.from;
const DAY_TO = LANES.to;

const KEY_STEP = { today: { small: 5, large: 30 }, days: { small: 60, large: 360 } };

// What this page is, as far as the day panel cares: what it draws today and what it is about.
function useDayView(): DayView {
  const tr = useStore((s) => s.trajectory);
  const now = useStore((s) => Math.round(s.body.now));
  const system = useStore((s) => s.body.system);
  const processId = useStore((s) => s.body.process);
  const focus = useStore((s) => s.body.focus);
  const focusMuscle = useStore((s) => s.body.focusMuscle);
  const real = useStore((s) => (s.asking && s.asking.realDerived.trajectory !== s.trajectory ? s.asking.realDerived.trajectory : null));
  const yourDay = useStore(yourDayWhileAsking);
  const steps = useStore((s) => (s.asking?.guideOpen && !s.touring ? s.asking.guide : null));
  const index = useStore((s) => s.asking?.step ?? 0);
  return useMemo(() => {
    const walkthrough = steps ? { steps, index } : null;
    const page = { tr, now, walkthrough, yourDay };
    if (focus === "muscle") {
      const muscles: MuscleSubject = focusMuscle ? { kind: "one", group: focusMuscle } : { kind: "worked", groups: null };
      return dayViewOf({ ...page, lanes: focusMuscle ? muscleStateLanes(tr, now, focusMuscle) : workedMuscleLanes(tr, now), muscles, readings: new Set() });
    }
    if (focus) {
      const hue = viewSystemOf({ system, process: selectedProcess(getState()), focus });
      return dayViewOf({ ...page, lanes: readingLanes(tr, now, organStory(focus, tr, now).rows, hue, real), muscles: null, readings: new Set() });
    }
    if (processId) {
      const training = tr.events.find((e) => e.preset === "training" && `event:${e.id}` === processId);
      const muscles: MuscleSubject | null = training ? { kind: "worked", groups: training.muscles.map((m) => m.group) } : null;
      return dayViewOf({ ...page, lanes: processLanes(tr, now, processId, real), muscles, readings: new Set() });
    }
    const { readings, more } = systemById(system);
    return dayViewOf({
      ...page,
      lanes: systemLanes(tr, now, system, real),
      muscles: system === "muscles" ? { kind: "worked", groups: null } : null,
      readings: system === "overview" ? null : new Set<string>([...readings, ...more]),
    });
  }, [tr, real, yourDay, now, system, processId, focus, focusMuscle, steps, index]);
}

// Where a row of the chart comes from. A row is a thread, a reading, a stop on a line, or a muscle.
function laneOrigin(tr: Trajectory, lane: Lane, minute: number, selected: string | null): Origin {
  const { target } = lane;
  if (target?.kind === "muscle" || (!target && lane.system === "muscles")) return modelOrigin(REFERENCE.muscleState.evidence, REFERENCE.muscleState.source);
  const processes = processesAt(tr, minute);
  const processId = target?.kind === "process" ? target.id : target?.kind === "stop" ? selected : null;
  const process = processId ? processes.find((p) => p.id === processId) : undefined;
  if (process) return processOrigin(tr, process);
  const reading = assess(tr, minute).readings.find((r) => r.id === lane.id);
  if (reading) return readingOrigin(reading, tr, minute);
  const food = tr.scenario.intakes.find((intake) => lane.id === `intake:${intake.id}`);
  return food ? foodOrigin(food) : SENTENCE_ORIGIN;
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

// A name, and what is there at the minute you are looking at. The chart writes that value itself,
// because it changes far more often than React should.
function LaneRow({ lane, hot, origin }: { lane: Lane; hot: boolean; origin: Origin }) {
  return (
    <button {...sourced(origin)} type="button" className="day-row" data-lane={lane.id} data-hot={hot || undefined} disabled={!lane.target} title={lane.label} onClick={() => goToLane(lane)} onPointerEnter={() => pointAtLane(lane)} onPointerLeave={() => pointAtLane(null)}>
      {lane.badge.kind === "number" ? <span className="day-number">{lane.badge.number}</span> : null}
      <span className="day-name">{lane.label}</span>
      <span className="day-value" />
    </button>
  );
}

// The day under the body. One thing at a time is drawn large and the rest stay behind it as thin lines:
// what runs out is an area that ends where it ends, what never does is a line against its typical band, and
// each row reads out its value at the minute under your pointer. Pointing at a name or a curve swaps which
// one is large.
//
// When today has nothing to say about what is on screen, the panel shows what does: a muscle's recovery over
// days, a walkthrough's own steps, what comes next, or only the time.
//
// Moving through it works like any player: skip between the moments that matter, play forward from
// where you are, or drag along it. Back to now is always in the same place. The two words under the
// names decide how much of the day is shown.
export function Timeline({ stage }: { stage: Stage | null }) {
  const theme = useStore((s) => s.theme);
  const tr = useStore((s) => s.trajectory);
  const now = useStore((s) => s.body.now);
  const playing = useStore((s) => s.playing);
  const dayMoment = useStore((s) => s.dayMoment);
  const hoverLane = useStore((s) => s.hoverLane);
  const view = useDayView();
  const lanes = lanesOf(view);
  const overDays = runsOverDays(view);
  const cursorOf = (s: AppState) => (overDays ? muscleMinute(s) : s.t);
  const selected = useStore((s) => s.body.process);
  const origins = useMemo(() => new Map(lanes.map((lane) => [lane.id, laneOrigin(tr, lane, Math.round(now), selected)])), [lanes, tr, now, selected]);
  const stops = useMemo(() => viewStops(view, now).map((stop) => stop.at), [view, now]);
  const away = useStore((s) => Math.abs(Math.round(cursorOf(s)) - Math.round(s.body.now)) >= 1);
  const previous = useStore((s) => stops.filter((at) => at < cursorOf(s) - 0.5).at(-1) ?? null);
  const next = useStore((s) => stops.find((at) => at > cursorOf(s) + 0.5) ?? null);
  const overDaysRef = useRef(overDays);
  overDaysRef.current = overDays;
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
      scrub: (minute) => (overDaysRef.current ? showMuscleMinute(minute) : setUi({ t: minute, playing: false })),
      goToStop: goToStep,
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
    chart.current?.setData(view, now);
  }, [view, now]);

  // A minute away from today only means something on a recovery.
  useEffect(() => {
    if (view.kind !== "recovery" && dayMoment !== null) setUi({ dayMoment: null });
  }, [view.kind, dayMoment]);

  useEffect(() => chart.current?.setTheme(theme), [theme]);
  useEffect(() => chart.current?.setPointedLane(hoverLane), [hoverLane]);

  useFrame(stage, (_, dt) => {
    const s = getState();
    const t = overDaysRef.current ? muscleMinute(s) : s.t;
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
    if (minute === null) return;
    if (overDays) showMuscleMinute(minute);
    else setUi({ t: minute, playing: false });
  };

  const backToNow = () => setUi({ t: now, dayMoment: null, playing: false });

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
    const steps = overDays ? KEY_STEP.days : KEY_STEP.today;
    const step = e.shiftKey ? steps.large : steps.small;
    const { from, to } = view.span;
    const at = cursorOf(s);
    if (e.key === "ArrowLeft") goTo(Math.max(from, at - step));
    else if (e.key === "ArrowRight") goTo(Math.min(to, at + step));
    else if (e.key === "Home") goTo(from);
    else if (e.key === "End") goTo(to);
    else if (e.key === ",") goTo(previous);
    else if (e.key === ".") goTo(next);
    else return;
    e.preventDefault();
  };

  return (
    <section
      className="day"
      data-shape={view.kind}
      onPointerDownCapture={overDays ? undefined : releaseMoment}
      onKeyDownCapture={overDays ? undefined : releaseMoment}
      style={{ "--day-top": `${DAY_TOP_REM}rem`, "--day-rows": `${dayRowsRem(view.kind)}rem`, "--day-hours": `${DAY_HOURS_REM}rem`, "--day-row": `${DAY_ROW_REM}rem` }}
      aria-label="Today, and when each thing ends"
    >
      <div className="day-side">
        <div className="transport">
          <button type="button" className="icon-button" aria-label="Previous moment" title="Previous moment" disabled={previous === null} onClick={() => goTo(previous)}>
            <SkipBack weight="fill" />
          </button>
          {overDays ? null : (
            <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play forward"} title={playing ? "Pause" : "Play forward"} aria-pressed={playing} onClick={togglePlay}>
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Next moment" title="Next moment" disabled={next === null} onClick={() => goTo(next)}>
            <SkipForward weight="fill" />
          </button>
          {away ? (
            <button type="button" className="to-now" onClick={backToNow}>
              Back to now
            </button>
          ) : (
            <span className="at-now">Now</span>
          )}
        </div>
        <div ref={rows} className="day-rows">
          {lanes.map((lane) => (
            <LaneRow key={lane.id} lane={lane} hot={lane.id === hoverLane} origin={origins.get(lane.id) ?? SENTENCE_ORIGIN} />
          ))}
        </div>
        {overDays ? null : (
          <div className="day-range" role="radiogroup" aria-label="How much of the day to show">
            <button type="button" className="toggle" role="radio" aria-checked={!wholeDay} title="From where this began to where it ends" onClick={() => showRange(false)}>
              Focus
            </button>
            <button type="button" className="toggle" role="radio" aria-checked={wholeDay} title={`${formatClock(DAY_FROM)} to ${formatClock(DAY_TO)}`} onClick={() => showRange(true)}>
              Whole day
            </button>
          </div>
        )}
      </div>
      <div ref={plot} className="day-plot" role="slider" tabIndex={0} aria-label="Time" aria-valuemin={view.span.from} aria-valuemax={view.span.to} onKeyDown={key}>
        <canvas ref={canvas} aria-hidden="true" />
      </div>
      {view.kind === "next" ? (
        <div className="day-next">
          {view.items.map((item) => (
            <button
              key={item.reading.id}
              {...sourced(readingOrigin(item.reading, tr, Math.round(now)))}
              type="button"
              className="day-next-item"
              onClick={() => goTo(item.at)}
              onPointerEnter={() => setUi({ hover: item.reading.organ })}
              onPointerLeave={() => setUi({ hover: null })}
            >
              <span className="day-next-at">{formatClock(item.at)}</span>
              <span className="day-next-what">{item.what}</span>
              <span className="day-next-whose">{item.reading.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <FoodFix />
    </section>
  );
}
