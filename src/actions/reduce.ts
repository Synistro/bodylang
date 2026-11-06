import { z } from "zod";
import { BodyEvent, CustomStory, SEX_LABEL } from "../model/events/types";
import { MuscleGroup } from "../model/muscleGroups";
import type { Cycle } from "../model/cycle";
import { CYCLE } from "../model/params";
import { SystemId, OrganId } from "../model/ids";
import { ActivitySpan, Body, CustomSubstance, Intake } from "../model/scenario";
import { systemById, ORGAN_HOME } from "../model/systems";
import { Action, customStory } from "./schemas";
import { scaledTo, withActivity, withSleep } from "../model/dayEdits";

export interface WhatIf {
  label: string;
  activities: ActivitySpan[];
}

export interface BodyState {
  body: Body;
  intakes: Intake[];
  activities: ActivitySpan[];
  substances: CustomSubstance[];
  events: BodyEvent[];
  cycle: Cycle | null;
  now: number;
  system: SystemId;
  process: string | null;
  focus: OrganId | null;
  focusMuscle: MuscleGroup | null;
  whatIf: WhatIf | null;
  assumptions: Record<string, string>;
}

function storyFrom(custom: z.infer<typeof customStory>): CustomStory {
  return {
    systems: custom.systems,
    effects: custom.effects.map((e) => ({ channel: e.channel, amount: e.amount, riseMin: e.rise_min, halfLifeMin: e.half_life_min, after: e.after })),
    feelings: custom.feelings.map((f) => ({ id: f.id, label: f.label, amount: f.amount, riseMin: f.rise_min, halfLifeMin: f.half_life_min, after: f.after, cause: f.cause, organ: f.organ })),
    stops: custom.stops.map((s) => ({ organ: s.organ, muscle: s.muscle, label: s.label, afterMin: s.after_min, say: s.say, routes: s.routes })),
    track: custom.track ?? null,
  };
}

export function reduce(state: BodyState, action: Action): BodyState {
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
      return { ...state, intakes: [...state.intakes.filter((i) => i.id !== a.id), intake], assumptions: { ...state.assumptions, [a.id]: a.assumption } };
    }
    case "correct_intake": {
      const { id, grams, at, assumption } = action.args;
      const intake = state.intakes.find((i) => i.id === id);
      if (!intake) throw new Error(`No food or drink with id ${id}. Known ids: ${state.intakes.map((i) => i.id).join(", ") || "none"}`);
      if (grams !== undefined && intake.grams <= 0) throw new Error(`${intake.label} was logged with no weight, so log it again with its real amount.`);
      const corrected: Intake = { ...(grams === undefined ? intake : { ...scaledTo(intake, grams), portionBy: "you" as const }), at: at ?? intake.at };
      return { ...state, intakes: state.intakes.map((i) => (i.id === id ? corrected : i)), assumptions: assumption === undefined ? state.assumptions : { ...state.assumptions, [id]: assumption } };
    }
    case "remove_intake":
      return { ...state, intakes: state.intakes.filter((i) => i.id !== action.args.id), process: state.process === `intake:${action.args.id}` || state.process === `meal:${action.args.id}` ? null : state.process };
    case "set_activity":
      return { ...state, activities: withActivity(state.activities, action.args.posture, action.args.from, action.args.until), whatIf: null };
    case "set_sleep":
      return { ...state, activities: withSleep(state.activities, action.args.bed, action.args.wake), whatIf: null };
    case "set_cycle": {
      const { last_start: start, length_days: lengthDays, period_days: periodDays } = action.args;
      if (start === null) return { ...state, cycle: null };
      return { ...state, cycle: { start, lengthDays: lengthDays ?? state.cycle?.lengthDays ?? CYCLE.lengthDays, periodDays: periodDays ?? state.cycle?.periodDays ?? CYCLE.periodDays } };
    }
    case "set_body": {
      const a = action.args;
      return {
        ...state,
        body: {
          sex: a.sex ?? state.body.sex,
          age: a.age ?? state.body.age,
          heightCm: a.height_cm ?? state.body.heightCm,
          weightKg: a.weight_kg ?? state.body.weightKg,
        },
      };
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
      return { ...state, substances: [...state.substances.filter((s) => s.id !== a.id), substance] };
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
      return { ...state, events: [...state.events.filter((e) => e.id !== a.id), event] };
    }
    case "end_event": {
      const { id, at } = action.args;
      const event = state.events.find((e) => e.id === id);
      if (!event) throw new Error(`No event with id ${id}. Known ids: ${state.events.map((e) => e.id).join(", ") || "none"}`);
      if (at < event.from) throw new Error(`${event.label} started at minute ${event.from}, so it can't end at minute ${at}. Log it again with the right start if it began earlier.`);
      return { ...state, events: state.events.map((e) => (e.id === id ? { ...e, until: at } : e)) };
    }
    case "show_system":
      return { ...state, system: action.args.system, process: null, focus: null, focusMuscle: null };
    case "show_process":
      return { ...state, process: action.args.id };
    case "focus_organ": {
      const wanted = action.args.organ;
      if ((wanted === "uterus" || wanted === "ovaries") && state.body.sex !== "female") throw new Error(`This body has no ${wanted}. Its sex is set to ${state.body.sex}.`);
      if (wanted === "prostate" && state.body.sex !== "male") throw new Error(`This body has no prostate. Its sex is set to ${state.body.sex}.`);
      // An organ outside the section you are in takes you to its own, so the path always says where you are.
      const elsewhere = wanted !== null && !state.process && state.system !== "overview" && !systemById(state.system).organs.includes(wanted);
      return { ...state, system: elsewhere ? ORGAN_HOME[wanted] : state.system, focus: action.args.organ, focusMuscle: action.args.organ === "muscle" ? action.args.muscle ?? null : null };
    }
    case "guide":
      return state;
    case "what_if":
      return {
        ...state,
        whatIf: { label: action.args.label, activities: withActivity(state.activities, action.args.posture, action.args.from, action.args.until) },
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
