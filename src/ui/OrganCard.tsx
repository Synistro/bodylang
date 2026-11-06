import { useRef } from "react";
import { ORGAN_NAME } from "../model/systems";
import { hasSomethingToSay, MuscleSummary, Reading, shortUnit } from "../model/assess";
import { modelOrigin, readingOrigin } from "../model/origin";
import { MUSCLE_LABEL, MuscleGroup } from "../model/muscleGroups";
import type { Trajectory } from "../model/engine/trajectory";
import type { OrganId } from "../model/ids";
import { chartOffsetHours, setUi, useStore } from "../store";
import { ActingHere } from "./ActingHere";
import { assessmentAt, useIsNews, useMinute, useMuscleMinute, useScrollFade } from "./hooks";
import { OrganInset } from "./insets/OrganInset";
import { muscleStory, organStory } from "./insets/organStory";
import { isNumeric, outsideTypical, RangeBar, TrendMark } from "./marks";
import { showMuscle } from "./navigation";
import { sourced } from "./SourceTip";
import { BrainPage } from "./StatePanel";
import "./insets/insets.css";

const WORKED_FROM = 0.05;
const MAX_ROWS = 3;

function ReadingRow({ reading, trajectory, minute }: { reading: Reading; trajectory: Trajectory; minute: number }) {
  const from = sourced(readingOrigin(reading, trajectory, minute));
  return (
    <li className="reading" data-tone={reading.tone} data-outside={outsideTypical(reading) || undefined} tabIndex={0}>
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
    </li>
  );
}

// Level 3 for "muscle" with no group chosen: what has been worked, each one a step further down.
function WorkedGroups({ worked }: { worked: MuscleSummary[] }) {
  return (
    <ul>
      {worked.map((m) => (
        <li key={m.group}>
          <button
            type="button"
            className="item item-button"
            onClick={() => {
              setUi({ hoverMuscle: null });
              showMuscle(m.group);
            }}
            onPointerEnter={() => setUi({ hoverMuscle: m.group })}
            onPointerLeave={() => setUi({ hoverMuscle: null })}
            onFocus={() => setUi({ hoverMuscle: m.group })}
            onBlur={() => setUi({ hoverMuscle: null })}
          >
            <span className="item-head">
              <span className="item-title">{m.label}</span>
              <span className="item-status">{m.status}</span>
            </span>
            <span className="muscle-level" aria-hidden="true">
              <i style={{ width: `${Math.round(m.level * 100)}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useCard() {
  const scroller = useRef<HTMLElement>(null);
  useScrollFade(scroller);
  return scroller;
}

function MusclePlate({ group, trajectory, minute }: { group: MuscleGroup; trajectory: Trajectory; minute: number }) {
  const shownAt = useMuscleMinute();
  const offChart = useStore((s) => chartOffsetHours(s) !== null);
  const story = muscleStory(group, trajectory, shownAt);
  const from = sourced(modelOrigin(story.evidence, story.source));
  // These look ahead from the chart's time, so they don't apply to a moment days away from it.
  const summary = offChart ? null : assessmentAt(trajectory, minute).muscles.find((m) => m.group === group);
  const lines = [summary?.sorenessLine, summary?.normalLine].flatMap((line) => line ?? []);
  const scroller = useCard();
  return (
    <aside ref={scroller} className="organ-card" aria-label={`${MUSCLE_LABEL[group]} close-up`}>
      <div {...from}>
        <OrganInset organ="muscle" trajectory={trajectory} t={shownAt} muscle={group} />
      </div>
      {lines.length ? (
        <ul className="organ-lines">
          {lines.map((line) => (
            <li key={line} {...from}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <ActingHere organ="muscle" />
    </aside>
  );
}

function OrganPlate({ organ, trajectory, minute }: { organ: OrganId; trajectory: Trajectory; minute: number }) {
  const story = organStory(organ, trajectory, minute);
  const assessment = assessmentAt(trajectory, minute);
  const isNews = useIsNews(minute);
  const worked = organ === "muscle" ? assessment.muscles.filter((m) => m.level >= WORKED_FROM).sort((a, b) => b.level - a.level) : [];
  const readings = (worked.length ? [] : story.rows)
    .flatMap((id) => assessment.readings.find((r) => r.id === id) ?? [])
    .filter((reading) => hasSomethingToSay(reading) && isNews(reading))
    .slice(0, MAX_ROWS);
  const scroller = useCard();
  const from = sourced(modelOrigin(story.evidence, story.source));
  return (
    <aside ref={scroller} className="organ-card" aria-label={`${ORGAN_NAME[organ]} close-up`}>
      {organ === "muscle" ? null : (
        <div {...from}>
          <OrganInset organ={organ} trajectory={trajectory} t={minute} muscle={null} />
        </div>
      )}
      {worked.length ? <WorkedGroups worked={worked} /> : null}
      <ActingHere organ={organ} />
      {readings.length ? (
        <section aria-label="Readings">
          <ul className="readings">
            {readings.map((r) => (
              <ReadingRow key={r.id} reading={r} trajectory={trajectory} minute={minute} />
            ))}
          </ul>
        </section>
      ) : null}
      {story.line ? (
        <p className="organ-lines" {...from}>
          {story.line}
        </p>
      ) : null}
    </aside>
  );
}

export function OrganCard() {
  const focus = useStore((s) => s.body.focus);
  const group = useStore((s) => s.body.focusMuscle);
  const trajectory = useStore((s) => s.trajectory);
  const minute = useMinute();
  if (!focus) return null;
  if (focus === "brain") {
    return (
      <aside className="organ-card" aria-label="Brain close-up">
        <BrainPage />
      </aside>
    );
  }
  if (focus === "muscle" && group) return <MusclePlate key={group} group={group} trajectory={trajectory} minute={minute} />;
  return <OrganPlate key={focus} organ={focus} trajectory={trajectory} minute={minute} />;
}
