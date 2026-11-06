import type { GuideStep } from "../agent/actions";
import { closeupOf } from "../closeup/list";
import { aheadOf, Ahead, DAY_SPAN, dayMoments, dayStops, fromSeverity, isStill, Lane, Moment, MuscleSubject, recoveryOf, Span } from "../model/lanes";
import { LANES } from "../model/params";
import type { Trajectory } from "../model/engine/trajectory";
import { levelWord } from "../model/state";
import { processIdsOf } from "../model/yourDay";
import { isOnChart, stepMinute } from "../store";

export interface StoryStop {
  at: number;
  label: string;
}

// What the panel under the body shows. Most of the time that is today, one curve at a time. When today has
// nothing to say about what is on screen, it shows what does.
export type DayView =
  | { kind: "today"; span: Span; lanes: Lane[]; moments: Moment[] }
  | { kind: "recovery"; span: Span; lanes: Lane[]; moments: Moment[] }
  | { kind: "story"; span: Span; lanes: [Lane]; stops: StoryStop[]; current: number }
  | { kind: "next"; span: Span; items: Ahead[]; moments: Moment[] }
  | { kind: "quiet"; span: Span; moments: Moment[] };

export interface Walkthrough {
  steps: readonly GuideStep[];
  index: number;
}

interface Page {
  tr: Trajectory;
  now: number;
  lanes: Lane[]; // what this page draws on today's chart
  muscles: MuscleSubject | null; // set when this page is about how muscles are doing
  walkthrough: Walkthrough | null;
  readings: ReadonlySet<string> | null; // what this page's next moments can be about when it has no rows; null for all of them
  yourDay?: Trajectory | null; // while exploring: what was already true of your day stays off the chart
}

const FIRST_LEVEL = "pain";

// A walkthrough that leaves today runs on its own time, from its first step to its last. Only a muscle's
// levels can be read away from today, so only a muscle's walkthrough can do that.
function storyOf({ tr, now, walkthrough }: Page): Extract<DayView, { kind: "story" }> | null {
  if (!walkthrough) return null;
  const { steps, index } = walkthrough;
  if (!steps.some((step) => step.at !== null && !isOnChart(step.at))) return null;
  const muscle = steps[index]?.muscle ?? steps.find((step) => step.muscle)?.muscle ?? null;
  const closeup = closeupOf("muscle");
  if (!muscle || !closeup) return null;
  const stops: StoryStop[] = steps.map((step, i) => ({ at: stepMinute(steps, i) ?? now, label: step.title }));
  const first = Math.min(...stops.map((stop) => stop.at));
  const last = Math.max(...stops.map((stop) => stop.at));
  const margin = Math.max(last - first, LANES.days.leastStoryMin) * LANES.days.storyMarginShare;
  const span: Span = { from: first - margin, to: last + margin, stepMin: LANES.days.stepMin };
  const lit = steps[index]?.closeup;
  const level = lit?.organ === closeup.organ ? lit.light[0] : FIRST_LEVEL;
  const levelAt = (minute: number) => closeup.fromModel({ trajectory: tr, muscle }, minute)[level] ?? 0;
  const lane: Lane = {
    id: "story",
    label: level,
    system: "muscles",
    badge: { kind: "plain" },
    shape: "amount",
    values: fromSeverity(levelAt, span),
    band: null,
    ghost: null,
    hypothetical: false,
    read: (minute) => levelWord(levelAt(minute)),
    mark: null,
    beyond: null,
    target: null,
    organ: null,
  };
  return { kind: "story", span, lanes: [lane], stops, current: index };
}

const momentKey = ({ at, label }: Moment) => `${at}|${label}`;

// A thread you already had, or a curve the question didn't move, is only your day again.
const isYourDayAgain = (lane: Lane, tr: Trajectory, yourDay: Trajectory, alreadyYours: Set<string>) => tr === yourDay || lane.sameAsYourDay === true || (lane.target?.kind === "process" && alreadyYours.has(lane.target.id));

export function dayViewOf(page: Page): DayView {
  const { tr, now, muscles, walkthrough, readings, yourDay } = page;
  const story = storyOf(page);
  if (story) return story;
  const recovery = muscles && !walkthrough ? recoveryOf(tr, now, muscles) : null;
  if (recovery) return { kind: "recovery", ...recovery };
  const alreadyYours = yourDay ? processIdsOf(yourDay, now) : new Set<string>();
  const lanes = yourDay ? page.lanes.filter((lane) => !isYourDayAgain(lane, tr, yourDay, alreadyYours)) : page.lanes;
  const yourMoments = new Set(yourDay ? dayMoments(yourDay, now).map(momentKey) : []);
  const moments = dayMoments(tr, now).filter((moment) => !yourMoments.has(momentKey(moment)));
  if (!isStill(lanes, now)) return { kind: "today", span: DAY_SPAN, lanes, moments };
  if (yourDay) return { kind: "quiet", span: DAY_SPAN, moments };
  const items = aheadOf(tr, now, lanes.length ? new Set(lanes.map((lane) => lane.id)) : readings);
  return items.length ? { kind: "next", span: DAY_SPAN, items, moments } : { kind: "quiet", span: DAY_SPAN, moments };
}

// Everything worth stopping at in this view, in order.
export function viewStops(view: DayView, now: number): { at: number; label: string | null }[] {
  switch (view.kind) {
    case "today":
    case "recovery":
      return dayStops(view.lanes, view.moments, now);
    case "next":
      return [...dayStops([], view.moments, now), ...view.items.map((item) => ({ at: item.at, label: null }))].sort((a, b) => a.at - b.at);
    case "quiet":
      return dayStops([], view.moments, now);
    case "story":
      return [];
    default: {
      const unknownView: never = view;
      return unknownView;
    }
  }
}

// The curves a view draws, if any.
export const lanesOf = (view: DayView): Lane[] => (view.kind === "next" || view.kind === "quiet" ? [] : view.lanes);

// The views that run on more than one day, where the cursor can be somewhere the chart of today can't reach.
export const runsOverDays = (view: DayView) => view.kind === "recovery" || view.kind === "story";
