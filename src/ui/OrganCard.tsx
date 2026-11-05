import { useRef } from "react";
import { hasSomethingToSay, MuscleSummary, Reading, shortUnit } from "../model/assess";
import type { Evidence } from "../model/params";
import { MUSCLE_LABEL, MuscleGroup } from "../model/muscleGroups";
import type { OrganId, Trajectory } from "../model/simulate";
import { setUi, useStore } from "../store";
import { assessmentAt, useMinute, useScrollFade } from "./hooks";
import { OrganInset } from "./insets/OrganInset";
import { muscleStory, organStory, substancesAt } from "./insets/organStory";
import { isNumeric, outsideTypical, RangeBar, TrendMark } from "./marks";
import { showMuscle } from "./navigation";
import { ORGAN_NAME } from "./organ";
import "./insets/insets.css";

const WORKED_FROM = 0.05;
const MAX_ROWS = 3;

function ReadingRow({ reading }: { reading: Reading }) {
  return (
    <li className="reading" data-tone={reading.tone} data-outside={outsideTypical(reading) || undefined} tabIndex={0}>
      <span className="reading-head">
        <span className="reading-label">{reading.label}</span>
        <TrendMark trend={reading.trend} />
        <span className="reading-value" data-word={!isNumeric(reading.display) || undefined}>
          {reading.display}
          <small>{shortUnit(reading.unit)}</small>
        </span>
      </span>
      <RangeBar scale={reading.scale} value={reading.value} tone={reading.tone} />
      <span className="fold fold-why">
        <span className="fold-inner">
          <span className="reading-why">
            <b>{reading.verdictWord}.</b> {reading.why}
          </span>
        </span>
      </span>
      <span className="fold fold-detail">
        <span className="fold-inner">
          {reading.forecast ? <span className="reading-more">{reading.forecast}</span> : null}
          <span className="reading-more">{reading.scale.typicalLabel}</span>
        </span>
      </span>
    </li>
  );
}

// One small word. The citation and how far to trust it open on hover or focus.
function SourceWord({ evidence, source }: { evidence: Evidence; source: string }) {
  return (
    <p className="organ-source" tabIndex={0}>
      Source
      <span className="organ-source-text">
        <span>
          Grade {evidence}. {source}
        </span>
      </span>
    </p>
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
  const story = muscleStory(group, trajectory, minute);
  const summary = assessmentAt(trajectory, minute).muscles.find((m) => m.group === group);
  const lines = [summary?.sorenessLine, summary?.normalLine].flatMap((line) => line ?? []);
  const scroller = useCard();
  return (
    <aside ref={scroller} className="organ-card" aria-label={`${MUSCLE_LABEL[group]} close-up`}>
      <OrganInset organ="muscle" trajectory={trajectory} t={minute} muscle={group} />
      {lines.length ? (
        <ul className="organ-lines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <SourceWord evidence={story.evidence} source={story.source} />
    </aside>
  );
}

function OrganPlate({ organ, trajectory, minute }: { organ: OrganId; trajectory: Trajectory; minute: number }) {
  const story = organStory(organ, trajectory, minute);
  const assessment = assessmentAt(trajectory, minute);
  const worked = organ === "muscle" ? assessment.muscles.filter((m) => m.level >= WORKED_FROM).sort((a, b) => b.level - a.level) : [];
  const readings = (worked.length ? [] : story.rows)
    .flatMap((id) => assessment.readings.find((r) => r.id === id) ?? [])
    .filter(hasSomethingToSay)
    .slice(0, MAX_ROWS);
  const substances = substancesAt(organ, trajectory, minute);
  const scroller = useCard();
  return (
    <aside ref={scroller} className="organ-card" aria-label={`${ORGAN_NAME[organ]} close-up`}>
      {organ === "muscle" ? null : <OrganInset organ={organ} trajectory={trajectory} t={minute} muscle={null} />}
      {worked.length ? <WorkedGroups worked={worked} /> : null}
      {substances.length ? (
        <ul className="organ-substances">
          {substances.map((s) => (
            <li key={s.label}>
              <b>{s.label}</b> {s.effect}
            </li>
          ))}
        </ul>
      ) : null}
      {readings.length ? (
        <section aria-label="Readings">
          <ul className="readings">
            {readings.map((r) => (
              <ReadingRow key={r.id} reading={r} />
            ))}
          </ul>
        </section>
      ) : null}
      {story.line ? <p className="organ-lines">{story.line}</p> : null}
      <SourceWord evidence={story.evidence} source={story.source} />
    </aside>
  );
}

export function OrganCard() {
  const focus = useStore((s) => s.body.focus);
  const group = useStore((s) => s.body.focusMuscle);
  const trajectory = useStore((s) => s.trajectory);
  const minute = useMinute();
  if (!focus) return null;
  if (focus === "muscle" && group) return <MusclePlate key={group} group={group} trajectory={trajectory} minute={minute} />;
  return <OrganPlate key={focus} organ={focus} trajectory={trajectory} minute={minute} />;
}
