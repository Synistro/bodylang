import { useEffect, useRef, useState } from "react";
import { Assessment, Feeling, hasSomethingToSay, MuscleSummary, Reading, shortUnit } from "../model/assess";
import { systemById, SystemId } from "../model/systems";
import { setUi, useStore } from "../store";
import { Crossfade } from "./Crossfade";
import { assessmentAt, organHover, useMinute, useScrollFade } from "./hooks";
import { isNumeric, outsideTypical, RangeBar, TrendMark } from "./marks";
import { showMuscle, showOrgan } from "./navigation";
import { feelingOrigin, modelOrigin, readingOrigin } from "../model/origin";
import { REFERENCE } from "../model/params";
import { ProcessDetail } from "./Processes";
import { sourced } from "./SourceTip";

// What would wake up a system with nothing going on.
const QUIET_HINT: Partial<Record<SystemId, string>> = {
  digestion: "Tell your body what you ate.",
  muscles: "Tell your body what you trained.",
  immune: "Tell your body if you feel ill.",
  reproductive: "Tell your body when your last period started, if you have one.",
};

const touchOnly = () => window.matchMedia("(hover: none)").matches;

// A meter: the name and number on one line, a wide bar under them with the typical band and you.
function ReadingRow({ reading, index, hot }: { reading: Reading; index: number; hot: boolean }) {
  const [open, setOpen] = useState(false);
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  const from = sourced(readingOrigin(reading, tr, minute));
  // Clicking goes one level down. Without hover, the first tap has to show the reason instead.
  const press = () => {
    if (reading.organ && (open || !touchOnly())) showOrgan(reading.organ);
    else setOpen(!open);
  };
  return (
    <button type="button" className="reading stagger" data-tone={reading.tone} data-outside={outsideTypical(reading) || undefined} data-open={open || undefined} data-hot={hot || undefined} style={{ "--i": index }} onClick={press} {...organHover(reading.organ)}>
      <span className="reading-head">
        <span className="reading-label">{reading.label}</span>
        <TrendMark trend={reading.trend} />
        <span className="reading-value" data-word={!isNumeric(reading.display) || undefined} {...from}>
          {reading.display}
          <small>{shortUnit(reading.unit)}</small>
        </span>
      </span>
      <RangeBar scale={reading.scale} value={reading.value} tone={reading.tone} />
      <span className="fold fold-why">
        <span className="fold-inner">
          <span className="reading-why" {...from}>
            <b>{reading.verdictWord}.</b> {reading.why}
          </span>
        </span>
      </span>
      <span className="fold fold-detail">
        <span className="fold-inner">
          {reading.forecast ? (
            <span className="reading-more" {...from}>
              {reading.forecast}
            </span>
          ) : null}
          <span className="reading-more" {...from}>
            {reading.scale.typicalLabel}
          </span>
        </span>
      </span>
    </button>
  );
}

function ReadingList({ ids, assessment, startIndex }: { ids: Reading["id"][]; assessment: Assessment; startIndex: number }) {
  const hover = useStore((s) => s.hover);
  const readings = ids.flatMap((id) => assessment.readings.find((r) => r.id === id) ?? []).filter(hasSomethingToSay);
  return (
    <>
      {readings.map((r, i) => (
        <ReadingRow key={r.id} reading={r} index={startIndex + i} hot={hover !== null && hover === r.organ} />
      ))}
    </>
  );
}

function FeelingRow({ feeling, index }: { feeling: Feeling; index: number }) {
  return (
    <li className="feel stagger" style={{ "--i": index }} {...organHover(feeling.organ)}>
      <span className="feel-label">{feeling.label}</span>
      <span className="feel-cause" {...sourced(feelingOrigin(feeling))}>
        {feeling.cause}
        {feeling.when ? <span className="feel-when">{feeling.when}</span> : null}
      </span>
    </li>
  );
}

// Level 0: how you may feel. Its sentence heads the page, and what you logged is in the outline.
function Glance({ assessment }: { assessment: Assessment }) {
  const { feelings } = assessment;
  if (!feelings.length) return null;
  return (
    <section className="group" aria-labelledby="feel-title">
      <h3 id="feel-title" className="group-title stagger" style={{ "--i": 0 }}>
        You may feel
      </h3>
      <ul>
        {feelings.map((f, i) => (
          <FeelingRow key={f.id} feeling={f} index={1 + i} />
        ))}
      </ul>
    </section>
  );
}

// Level 1 for most systems: the readings with something to say. What is running here is in the outline.
function SystemDetail({ system, assessment }: { system: SystemId; assessment: Assessment }) {
  const [showMore, setShowMore] = useState(false);
  const def = systemById(system);
  const present = (ids: Reading["id"][]) => ids.filter((id) => assessment.readings.some((r) => r.id === id && hasSomethingToSay(r)));
  const primary = present(def.readings);
  const more = present(def.more);
  const sex = useStore((s) => s.body.body.sex);
  const hint = assessment.systems[system].quiet && (system !== "reproductive" || sex === "female") ? QUIET_HINT[system] : undefined;
  return (
    <>
      {primary.length ? (
        <section className="readings" aria-label="Readings">
          <ReadingList ids={primary} assessment={assessment} startIndex={0} />
          {showMore ? <ReadingList ids={more} assessment={assessment} startIndex={0} /> : null}
          {more.length ? (
            <button type="button" className="link more stagger" style={{ "--i": primary.length }} aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
              {showMore ? "Less" : "More"}
            </button>
          ) : null}
        </section>
      ) : null}
      {hint ? (
        <p className="hint stagger" style={{ "--i": 1 + primary.length }}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

const MUSCLE_ORIGIN = sourced(modelOrigin(REFERENCE.muscleState.evidence, REFERENCE.muscleState.source));

function MuscleRow({ muscle, index, hot }: { muscle: MuscleSummary; index: number; hot: boolean }) {
  const detail = [muscle.sorenessLine, muscle.normalLine].filter(Boolean).join(". ");
  return (
    <li className="stagger" style={{ "--i": index }}>
      <button
        type="button"
        className="item item-button"
        data-hot={hot || undefined}
        onClick={() => {
          setUi({ hoverMuscle: null });
          showMuscle(muscle.group);
        }}
        onPointerEnter={() => setUi({ hoverMuscle: muscle.group })}
        onPointerLeave={() => setUi({ hoverMuscle: null })}
        onFocus={() => setUi({ hoverMuscle: muscle.group })}
        onBlur={() => setUi({ hoverMuscle: null })}
      >
        <span className="item-head">
          <span className="item-title">{muscle.label}</span>
          <span className="item-status" {...MUSCLE_ORIGIN}>
            {muscle.status}
          </span>
        </span>
        {detail ? (
          <span className="item-note" {...MUSCLE_ORIGIN}>
            {detail}
          </span>
        ) : null}
        <span className="muscle-level" aria-hidden="true">
          <i style={{ width: `${Math.round(muscle.level * 100)}%` }} />
        </span>
      </button>
    </li>
  );
}

// Level 1 for muscles: only the groups that have been worked. The rest are one quiet line.
function MusclesDetail({ assessment }: { assessment: Assessment }) {
  const hoverMuscle = useStore((s) => s.hoverMuscle);
  const worked = assessment.muscles.filter((m) => assessment.readings.find((r) => r.id === `muscle:${m.group}`)?.verdict !== "normal").sort((a, b) => b.level - a.level);
  const rested = assessment.muscles.length - worked.length;
  if (!worked.length) return <p className="hint stagger">{QUIET_HINT.muscles}</p>;
  return (
    <>
      <ul>
        {worked.map((m, i) => (
          <MuscleRow key={m.group} muscle={m} index={i} hot={hoverMuscle === m.group} />
        ))}
      </ul>
      {rested ? (
        <p className="quiet-line stagger" style={{ "--i": worked.length }} {...MUSCLE_ORIGIN}>
          {`${rested} others rested`}
        </p>
      ) : null}
    </>
  );
}

function PanelContent({ system, processId }: { system: SystemId; processId: string | null }) {
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  const assessment = assessmentAt(tr, minute);
  if (processId) return <ProcessDetail processId={processId} />;
  if (system === "overview") return <Glance assessment={assessment} />;
  if (system === "muscles") return <MusclesDetail assessment={assessment} />;
  return <SystemDetail system={system} assessment={assessment} />;
}

// The detail for the current level. It stays mounted behind an organ close-up, so coming back lands
// exactly where you left.
export function StatePanel() {
  const system = useStore((s) => s.body.system);
  const processId = useStore((s) => s.body.process);
  const focused = useStore((s) => s.body.focus !== null);
  const scroller = useRef<HTMLElement>(null);
  const level = `${system}/${processId ?? ""}`;
  useScrollFade(scroller);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [level]);

  return (
    <section ref={scroller} className="state" data-away={focused || undefined} inert={focused} aria-label="State of the body">
      <Crossfade k={level}>
        <PanelContent system={system} processId={processId} />
      </Crossfade>
    </section>
  );
}
