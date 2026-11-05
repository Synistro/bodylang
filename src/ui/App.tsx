import { useEffect, useRef, useState } from "react";
import { Skeleton } from "skullet/react";
import { SYSTEMS } from "../model/systems";
import { Stage } from "../scene/stage";
import { startBeacon, WALL } from "../wall";
import { AppState, dispatch, getState, leaveAsk, selectedProcess, setBody, setUi, useStore } from "../store";
import { viewSystemOf } from "../look";
import { AskBar, Guide } from "./Ask";
import { AtlasKeys } from "./AtlasKeys";
import { Answer, Composer } from "./Conversation";
import { Header, ViewControls } from "./Controls";
import { freeArea, useFreeArea } from "./freeArea";
import { assessmentAt } from "./hooks";
import { applyHues } from "./marks";
import { goUp, showMuscle, showOrgan, showSystem } from "./navigation";
import { isOrganId } from "./organ";
import { OrganCard } from "./OrganCard";
import { startDay } from "./day";
import { PageHead } from "./PageHead";
import { Rail } from "./Rail";
import { SourceTip } from "./SourceTip";
import { StatePanel } from "./StatePanel";
import { Timeline } from "./Timeline";
import { Tour } from "./Tour";

const PLAY_MINUTES_PER_SECOND = 34;
const WALL_IDLE_BEFORE_CYCLE_MS = 3 * 60 * 1000;
const WALL_SYSTEM_DWELL_MS = 40 * 1000;
const CREDITS = "Food composition: USDA FoodData Central, public domain. Organs and vessels: HuBMAP Human Reference Atlas, built from the NLM Visible Human data, CC BY 4.0. Muscles and bones: BodyParts3D, © The Database Center for Life Science, CC BY 4.0. Body: Anny by NAVER Labs Europe, Apache 2.0, with MakeHuman data, CC0.";

if (WALL) document.documentElement.dataset.wall = "";
document.documentElement.dataset.theme = getState().theme === "xray" ? "dark" : "light";
applyHues(getState().theme);

function sceneInput(s: AppState) {
  return {
    trajectory: s.trajectory,
    t: s.t,
    body: s.body.body,
    theme: s.theme,
    layers: s.layers,
    system: s.body.system,
    process: selectedProcess(s),
    stop: s.stop,
    focus: s.body.focus,
    focusMuscle: s.body.focusMuscle,
    hoverMuscle: s.hoverMuscle,
    hover: isOrganId(s.hover) ? s.hover : null,
    insets: freeArea(),
  };
}

const atTopLevel = () => {
  const s = getState();
  return !s.touring && !s.body.focus && s.stop === null && !s.body.process && s.body.system === "overview";
};

// Esc goes up one level, and from the top of an exploration, back to your day. Caught first, so anything else listening for Esc doesn't move a second level.
function useEscape() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (e.target instanceof HTMLTextAreaElement) e.target.blur();
      else if (getState().fixing) setUi({ fixing: null });
      else if (getState().bodyOpen) setUi({ bodyOpen: false });
      else if (atTopLevel() && getState().asking) leaveAsk();
      else goUp();
    };
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
  }, []);
}

// Nobody clicks a wallpaper most of the time, so after a while it walks through whatever is active.
function useWallCycle() {
  useEffect(() => {
    if (!WALL) return;
    let timer = 0;
    const next = () => {
      const s = getState();
      const statuses = assessmentAt(s.trajectory, Math.round(s.t)).systems;
      const stops = SYSTEMS.filter((system) => system.id === "overview" || !statuses[system.id].quiet);
      const at = stops.findIndex((system) => system.id === s.body.system);
      showSystem(stops[(at + 1) % stops.length].id);
      timer = window.setTimeout(next, WALL_SYSTEM_DWELL_MS);
    };
    const touched = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(next, WALL_IDLE_BEFORE_CYCLE_MS);
    };
    touched();
    const events = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, touched, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, touched);
    };
  }, []);
}

// A page nobody can see has its animations paused, and an entrance that never finishes would leave
// content invisible when the page comes back or is captured.
function useStillWhileHidden() {
  useEffect(() => {
    const update = () => document.documentElement.toggleAttribute("data-still", document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
}

function Foot() {
  const [credits, setCredits] = useState(false);
  const problem = useStore((s) => s.dayProblem);
  return (
    <div className="foot">
      {problem ? <p className="foot-problem">{problem}</p> : null}
      {credits ? <p className="credits">{CREDITS}</p> : null}
      <p className="foot-line">
        Estimates, not medical advice.{" "}
        <button type="button" className="link" aria-expanded={credits} onClick={() => setCredits(!credits)}>
          Credits
        </button>
      </p>
    </div>
  );
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const theme = useStore((s) => s.theme);
  const playing = useStore((s) => s.playing);
  const view = useStore((s) => viewSystemOf({ system: s.body.system, process: selectedProcess(s), focus: s.body.focus }));
  const asking = useStore((s) => s.asking !== null);
  useFreeArea(sheet, asking);
  useEscape();
  useWallCycle();
  useStillWhileHidden();

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "xray" ? "dark" : "light";
    applyHues(theme);
  }, [theme]);

  useEffect(() => {
    const next = new Stage(canvas.current!);
    let alive = true;
    next.setInput(sceneInput(getState()));
    next
      .load()
      .then(() => {
        if (!alive) return;
        setStage(next);
        startBeacon(next.frameListeners);
        if (import.meta.env.DEV) Object.assign(window, { stage: next, bodylang: { setUi, setBody, dispatch, getState } });
        startDay();
      })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      next.dispose();
    };
  }, []);

  // The scene reads the store once a frame; everything it draws comes from the one trajectory.
  useEffect(() => {
    if (!stage) return;
    const listener = (s: Stage) => s.setInput(sceneInput(getState()));
    stage.frameListeners.add(listener);
    return () => {
      stage.frameListeners.delete(listener);
    };
  }, [stage]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = getState();
      const next = s.t + ((now - last) / 1000) * PLAY_MINUTES_PER_SECOND;
      last = now;
      if (next >= s.playUntil) setUi({ t: s.playUntil, playing: false });
      else setUi({ t: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Hover and click on the body. A drag belongs to the camera, a click on an organ goes straight to
  // it, and a click on nothing goes up a level.
  useEffect(() => {
    const el = canvas.current!;
    if (!stage) return;
    let down: { x: number; y: number; closesPanel: boolean } | null = null;
    let last = 0;
    const move = (e: PointerEvent) => {
      if (down) return;
      const now = performance.now();
      if (now - last < 70) return;
      last = now;
      const { organ, muscle } = stage.pickTarget(e.clientX, e.clientY);
      const s = getState();
      if (organ !== s.hover || muscle !== s.hoverMuscle) setUi({ hover: organ, hoverMuscle: muscle });
      el.style.cursor = organ || muscle ? "pointer" : "grab";
    };
    const leave = () => {
      const s = getState();
      if (s.hover || s.hoverMuscle) setUi({ hover: null, hoverMuscle: null });
    };
    const press = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, closesPanel: getState().bodyOpen };
      stage.stopIdle();
    };
    const release = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const { closesPanel } = down;
      down = null;
      if (moved > 5 || closesPanel) return;
      const { organ, muscle, onBody } = stage.pickTarget(e.clientX, e.clientY);
      if (muscle) showMuscle(muscle);
      else if (organ) showOrgan(organ);
      else if (!onBody) goUp();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
    };
  }, [stage]);

  return (
    <div className="plate" data-view={view} data-asking={asking || undefined} style={{ "--view-hue": `var(--hue-${view})` }}>
      <div className="object">
        <canvas ref={canvas} aria-label="Three-dimensional model of the body. Drag to rotate, scroll to zoom." />
        {stage ? <AtlasKeys stage={stage} /> : null}
      </div>
      <div ref={sheet} className="sheet">
        <aside className="left">
          <Skeleton className="header-slot" loading={!stage && !failed} label="Loading the body" error={failed}>
            <Header />
          </Skeleton>
          <Rail />
          <Answer />
          <Composer />
        </aside>
        <div className="center">
          <AskBar />
          <div className="console">
            <div className="float">
              <Tour />
              <Guide />
            </div>
            <Timeline stage={stage} />
          </div>
        </div>
        <main className="right">
          <PageHead />
          <div className="panel-stack">
            <StatePanel />
            <OrganCard />
          </div>
          <div className="right-foot">
            <ViewControls />
            <Foot />
          </div>
        </main>
      </div>
      <SourceTip />
    </div>
  );
}
