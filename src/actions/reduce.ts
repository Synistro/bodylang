import { z } from "zod";
import { BodyEvent, CustomStory, SEX_LABEL } from "../model/events/types";
import { MuscleGroup } from "../model/muscleGroups";
import { CYCLE } from "../model/params";
import { SystemId, OrganId, processIds } from "../model/ids";
import { ActivitySpan, CustomSubstance, Intake } from "../model/scenario";
import { systemById, ORGAN_HOME } from "../model/systems";
import { Action, customStory } from "./schemas";
import { scaledTo, withActivity, withSleep } from "../model/dayEdits";
import type { DayContent } from "../model/day";

export interface WhatIf {
  label: string;
  activities: ActivitySpan[];
}

// Where you are looking, which never changes what happened.
export interface ViewState {
  system: SystemId;
  process: string | null;
  focus: OrganId | null;
  focusMuscle: MuscleGroup | null;
  whatIf: WhatIf | null;
}

// Everything Claude, the demo and the browser can change: what happened, what time it is, and what is on screen.
export interface BodyState {
  day: DayContent;
  now: number;
  view: ViewState;
}

const inDay = (state: BodyState, change: Partial<DayContent>): BodyState => ({
  ...state,
  day: { ...state.day, ...change },
});
const inView = (state: BodyState, change: Partial<ViewState>): BodyState => ({
  ...state,
  view: { ...state.view, ...change },
});

function storyFrom(custom: z.infer<typeof customStory>): CustomStory {
  return {
    systems: custom.systems,
    effects: custom.effects.map((e) => ({
      channel: e.channel,
      amount: e.amount,
      riseMin: e.rise_min,
      halfLifeMin: e.half_life_min,
      after: e.after,
    })),
    feelings: custom.feelings.map((f) => ({
      id: f.id,
      label: f.label,
      amount: f.amount,
      riseMin: f.rise_min,
      halfLifeMin: f.half_life_min,
      after: f.after,
      cause: f.cause,
      organ: f.organ,
    })),
    stops: custom.stops.map((s) => ({
      organ: s.organ,
      muscle: s.muscle,
      label: s.label,
      afterMin: s.after_min,
      say: s.say,
      routes: s.routes,
    })),
    track: custom.track ?? null,
  };
}

export function reduce(state: BodyState, action: Action): BodyState {
  const { day, view } = state;
  switch (action.name) {
    case "log_intake": {
      const a = action.args;
      const intake: Intake = {
        id: a.id,
        label: a.label,
        at: a.at,
        grams: a.grams,
        waterMl: a.water_ml,
        carbsG: a.carbs_g,
        sugarG: a.sugar_g,
        fatG: a.fat_g,
        proteinG: a.protein_g,
        fiberG: a.fiber_g,
        caffeineMg: a.caffeine_mg,
        alcoholG: a.alcohol_g,
        liquid: a.liquid,
        fructoseShare: a.fructose_share,
        source: a.source,
        serving: a.serving,
      };
      return inDay(state, {
        intakes: [...day.intakes.filter((i) => i.id !== a.id), intake],
        assumptions: { ...day.assumptions, [a.id]: a.assumption },
      });
    }
    case "correct_intake": {
      const { id, grams, at, assumption } = action.args;
      const intake = day.intakes.find((i) => i.id === id);
      if (!intake)
        throw new Error(
          `No food or drink with id ${id}. Known ids: ${day.intakes.map((i) => i.id).join(", ") || "none"}`,
        );
      if (grams !== undefined && intake.grams <= 0)
        throw new Error(`${intake.label} was logged with no weight, so log it again with its real amount.`);
      const corrected: Intake = {
        ...(grams === undefined ? intake : { ...scaledTo(intake, grams), portionBy: "you" as const }),
        at: at ?? intake.at,
      };
      return inDay(state, {
        intakes: day.intakes.map((i) => (i.id === id ? corrected : i)),
        assumptions: assumption === undefined ? day.assumptions : { ...day.assumptions, [id]: assumption },
      });
    }
    case "remove_intake": {
      const { id } = action.args;
      const followed = view.process === processIds.intake(id) || view.process === processIds.meal(id);
      const { [id]: _removed, ...assumptions } = day.assumptions;
      return {
        ...state,
        day: { ...day, intakes: day.intakes.filter((i) => i.id !== id), assumptions },
        view: followed ? { ...view, process: null } : view,
      };
    }
    case "set_activity":
      return {
        ...state,
        day: {
          ...day,
          activities: withActivity(day.activities, action.args.posture, action.args.from, action.args.until),
        },
        view: { ...view, whatIf: null },
      };
    case "set_sleep":
      return {
        ...state,
        day: { ...day, activities: withSleep(day.activities, action.args.bed, action.args.wake) },
        view: { ...view, whatIf: null },
      };
    case "set_cycle": {
      const { last_start: start, length_days: lengthDays, period_days: periodDays } = action.args;
      if (start === null) return inDay(state, { cycle: null });
      return inDay(state, {
        cycle: {
          start,
          lengthDays: lengthDays ?? day.cycle?.lengthDays ?? CYCLE.lengthDays,
          periodDays: periodDays ?? day.cycle?.periodDays ?? CYCLE.periodDays,
        },
      });
    }
    case "set_body": {
      const a = action.args;
      return inDay(state, {
        body: {
          ...day.body,
          sex: a.sex ?? day.body.sex,
          age: a.age ?? day.body.age,
          heightCm: a.height_cm ?? day.body.heightCm,
          weightKg: a.weight_kg ?? day.body.weightKg,
        },
      });
    }
    case "set_now":
      return { ...state, now: action.args.at };
    case "define_substance": {
      const a = action.args;
      const substance: CustomSubstance = {
        id: a.id,
        label: a.label,
        at: a.at,
        doseMg: a.dose_mg,
        tmaxMin: a.tmax_min,
        halfLifeH: a.half_life_h,
        volumeLPerKg: a.volume_l_per_kg,
        bioavailability: a.bioavailability,
        route: a.route,
        targets: a.targets,
        source: a.source,
      };
      return inDay(state, { substances: [...day.substances.filter((s) => s.id !== a.id), substance] });
    }
    case "log_event": {
      const a = action.args;
      const event: BodyEvent = {
        id: a.id,
        label: a.preset === "sex" ? SEX_LABEL : a.label,
        preset: a.preset,
        from: a.from,
        until: a.until,
        intensity: a.intensity,
        muscles: a.muscles,
        symptoms: a.symptoms,
        custom: a.custom ? storyFrom(a.custom) : null,
        source: a.source,
      };
      return inDay(state, { events: [...day.events.filter((e) => e.id !== a.id), event] });
    }
    case "end_event": {
      const { id, at } = action.args;
      const event = day.events.find((e) => e.id === id);
      if (!event)
        throw new Error(`No event with id ${id}. Known ids: ${day.events.map((e) => e.id).join(", ") || "none"}`);
      if (at < event.from)
        throw new Error(
          `${event.label} started at minute ${event.from}, so it can't end at minute ${at}. Log it again with the right start if it began earlier.`,
        );
      return inDay(state, { events: day.events.map((e) => (e.id === id ? { ...e, until: at } : e)) });
    }
    case "show_system":
      return inView(state, { system: action.args.system, process: null, focus: null, focusMuscle: null });
    case "show_process":
      return inView(state, { process: action.args.id });
    case "focus_organ": {
      const wanted = action.args.organ;
      if ((wanted === "uterus" || wanted === "ovaries") && day.body.sex !== "female")
        throw new Error(`This body has no ${wanted}. Its sex is set to ${day.body.sex}.`);
      if (wanted === "prostate" && day.body.sex !== "male")
        throw new Error(`This body has no prostate. Its sex is set to ${day.body.sex}.`);
      // An organ outside the section you are in takes you to its own, so the path always says where you are.
      const elsewhere =
        wanted !== null &&
        !view.process &&
        view.system !== "overview" &&
        !systemById(view.system).organs.includes(wanted);
      return inView(state, {
        system: elsewhere ? ORGAN_HOME[wanted] : view.system,
        focus: action.args.organ,
        focusMuscle: action.args.organ === "muscle" ? (action.args.muscle ?? null) : null,
      });
    }
    case "guide":
      return state;
    case "what_if":
      return inView(state, {
        whatIf: {
          label: action.args.label,
          activities: withActivity(day.activities, action.args.posture, action.args.from, action.args.until),
        },
      });
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
