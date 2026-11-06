import { ActingHere } from "./ActingHere";
import { useEffect, useRef, useState } from "react";
import { OrganInset } from "./insets/OrganInset";
import { BRAIN_PAGE, organStory } from "./insets/organStory";
import { PROCESS, REFERENCE } from "../model/params";
import "./insets/insets.css";
import { Assessment, Feeling, hasSomethingToSay, MuscleSummary, Reading, shortUnit } from "../model/assess";
import { systemById } from "../model/systems";
import { SystemId } from "../model/ids";
import { setUi, useStore, yourDayWhileAsking } from "../store";
import { Swap } from "./Swap";
import { assessmentAt, organHover, useMinute, useScrollFade, useIsNews } from "./hooks";
import { isNumeric, outsideTypical, RangeBar, TrendMark } from "./marks";
import { showMuscle, showOrgan } from "./navigation";
import { feelingOrigin, modelOrigin, readingOrigin } from "../model/origin";
import { FEELING_FROM_CLAUDE, FEELING_LOOK } from "./icons";
import { ProcessDetail } from "./Processes";
import { sourced } from "./sources";

// What would wake up a system with nothing going on.
const QUIET_HINT: Partial<Record<SystemId, string>> = {
  digestion: "Tell your body what you ate.",
  muscles: "Tell your body what you trained.",
  immune: "Tell your body if you feel ill.",
  reproductive: "Tell your body when your last period started, if you have one.",
};

const touchOnly = () => window.matchMedia("(hover: none)").matches;

// A meter: the name and number on one line, a wide bar under them with the typical band and you.
function ReadingRow({ reading, hot }: { reading: Reading; hot: boolean }) {
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
    <button type="button" className="reading" data-tone={reading.tone} data-outside={outsideTypical(reading) || undefined} data-open={open || undefined} data-hot={hot || undefined} onClick={press} {...organHover(reading.organ)}>
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

function ReadingList({ ids, assessment }: { ids: Reading["id"][]; assessment: Assessment }) {
  const hover = useStore((s) => s.hover);
  const readings = ids.flatMap((id) => assessment.readings.find((r) => r.id === id) ?? []).filter(hasSomethingToSay);
  return (
    <>
      {readings.map((r) => (
        <ReadingRow key={r.id} reading={r} hot={hover !== null && hover === r.organ} />
      ))}
    </>
  );
}

function FeelingRow({ feeling }: { feeling: Feeling }) {
  const look = FEELING_LOOK[feeling.id];
  const Icon = look?.glyph ?? FEELING_FROM_CLAUDE;
  return (
    <li className="feel" {...organHover(feeling.organ)}>
      <Icon className="feel-icon" weight="light" style={{ color: look ? `var(--hue-${look.system})` : "var(--ink-3)" }} aria-hidden="true" />
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
  const yourDay = useStore(yourDayWhileAsking);
  const minute = useMinute();
  const alreadyYours = new Set(yourDay ? assessmentAt(yourDay, minute).feelings.map((feeling) => feeling.id) : []);
  const feelings = assessment.feelings.filter((feeling) => !alreadyYours.has(feeling.id));
  if (!feelings.length) return null;
  return (
    <section className="group" aria-labelledby="feel-title">
      <h3 id="feel-title" className="group-title">
        You may feel
      </h3>
      <ul>
        {feelings.map((f) => (
          <FeelingRow key={f.id} feeling={f} />
        ))}
      </ul>
    </section>
  );
}

// Level 1 for most systems: the readings with something to say. What is running here is in the outline.
function SystemDetail({ system, assessment }: { system: SystemId; assessment: Assessment }) {
  const [showMore, setShowMore] = useState(false);
  const def = systemById(system);
  const isNews = useIsNews(useMinute());
  const present = (ids: Reading["id"][]) => ids.filter((id) => assessment.readings.some((r) => r.id === id && hasSomethingToSay(r) && isNews(r)));
  const well = system === "immune" && assessment.systems.immune.quiet;
  const primary = well ? [] : present(def.readings);
  const more = well ? [] : present(def.more);
  const symptoms = system === "immune" ? assessment.feelings.filter((f) => FEELING_LOOK[f.id]?.system === "immune" || f.byClaude) : [];
  const sex = useStore((s) => s.body.body.sex);
  const hint = assessment.systems[system].quiet && (system !== "reproductive" || sex === "female") ? QUIET_HINT[system] : undefined;
  return (
    <>
      {symptoms.length ? (
        <section className="group" aria-label="You may feel">
          <ul>
            {symptoms.map((f) => (
              <FeelingRow key={f.id} feeling={f} />
            ))}
          </ul>
        </section>
      ) : null}
      {primary.length ? (
        <section className="readings" aria-label="Readings">
          <ReadingList ids={primary} assessment={assessment} />
          {showMore ? <ReadingList ids={more} assessment={assessment} /> : null}
          {more.length ? (
            <button type="button" className="link more" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
              {showMore ? "Less" : "More"}
            </button>
          ) : null}
        </section>
      ) : null}
      {hint ? (
        <p className="hint">
          {hint}
        </p>
      ) : null}
    </>
  );
}

const MUSCLE_ORIGIN = sourced(modelOrigin(REFERENCE.muscleState.evidence, REFERENCE.muscleState.source));

function MuscleRow({ muscle, hot }: { muscle: MuscleSummary; hot: boolean }) {
  const detail = [muscle.sorenessLine, muscle.normalLine].filter(Boolean).join(". ");
  return (
    <li>
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
  if (!worked.length) return <p className="hint">{QUIET_HINT.muscles}</p>;
  return (
    <>
      <ul>
        {worked.map((m) => (
          <MuscleRow key={m.group} muscle={m} hot={hoverMuscle === m.group} />
        ))}
      </ul>
      {rested ? (
        <p className="quiet-line" {...MUSCLE_ORIGIN}>
          {`${rested} others rested`}
        </p>
      ) : null}
    </>
  );
}

// Feel-good chemicals sit at rest most of the day, and a row saying so tells you nothing.
const worthARow = (assessment: Assessment) => (id: Reading["id"]) => id !== "reward" || (assessment.readings.find((r) => r.id === id)?.value ?? 0) >= PROCESS.liftedFrom * 100;

export function BrainPage() {
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  const assessment = assessmentAt(tr, minute);
  const story = organStory("brain", tr, minute);
  const isNews = useIsNews(minute);
  const newsOnly = (ids: Reading["id"][]) => ids.filter((id) => assessment.readings.some((r) => r.id === id && isNews(r)));
  const feel = newsOnly(BRAIN_PAGE.feel.filter(worthARow(assessment)));
  const acting = newsOnly(BRAIN_PAGE.acting);
  return (
    <div className="brain-page">
      <section className="readings" aria-label="How you feel">
        <ReadingList ids={feel} assessment={assessment} />
      </section>
      <div {...sourced(modelOrigin(story.evidence, story.source))}>
        <OrganInset organ="brain" trajectory={tr} t={minute} muscle={null} />
      </div>
      <ActingHere organ="brain" />
      <section className="readings" aria-label="What is acting on it">
        <ReadingList ids={acting} assessment={assessment} />
      </section>
    </div>
  );
}

function PanelContent({ system, processId }: { system: SystemId; processId: string | null }) {
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  const assessment = assessmentAt(tr, minute);
  if (processId) return <ProcessDetail processId={processId} />;
  if (system === "overview") return <Glance assessment={assessment} />;
  if (system === "muscles") return <MusclesDetail assessment={assessment} />;
  if (system === "brain") return <BrainPage />;
  return <SystemDetail system={system} assessment={assessment} />;
}

// The detail for the current level. It stays mounted behind an organ close-up, so coming back lands
// exactly where you left.
export function SystemPage() {
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
      <Swap k={level}>
        <PanelContent system={system} processId={processId} />
      </Swap>
    </section>
  );
}
