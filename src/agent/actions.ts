import { z } from "zod";
import { BodyEvent, CHANNELS, CustomStory, PRESETS, SEX_LABEL, SYMPTOMS } from "../model/events";
import { MUSCLE_GROUPS, MuscleGroup } from "../model/muscleGroups";
import type { Cycle } from "../model/cycle";
import { CYCLE, DAY } from "../model/params";
import { ROUTE_IDS } from "../model/processes";
import { ActivitySpan, Body, CustomSubstance, Intake, OrganId, Posture, postureAt } from "../model/simulate";
import { formatClock } from "../model/state";
import { systemById, SystemId } from "../model/systems";
import { ORGAN_HOME } from "../look";

// The one vocabulary between language and the body: Claude calls these as tools, the scripted
// opening replays them, and the browser and server share the same reducer.

const minute = z.number().int().min(-1440).max(1799).describe("Minutes since 00:00 today, for example 16:45 is 1005. Yesterday is negative: 23:00 yesterday is -60");
const organ = z.enum(["brain", "heart", "lungs", "liver", "stomach", "pancreas", "spleen", "small_intestine", "large_intestine", "kidneys", "bladder", "muscle", "fat", "uterus", "ovaries", "prostate"]);
const posture = z.enum(["sleeping", "sitting", "standing", "walking", "running"]);
const system = z.enum(["overview", "digestion", "energy", "circulation", "muscles", "brain", "immune", "clearing", "reproductive"]);
const eventMinute = z.number().int().min(-14 * 1440).max(1799).describe("Minutes since 00:00 today. Negative for earlier days: 18:00 yesterday is -360");
const foodSource = z.discriminatedUnion("kind", [z.object({ kind: z.literal("table"), fdcId: z.number(), name: z.string(), dataset: z.string() }), z.object({ kind: z.literal("estimate") }), z.object({ kind: z.literal("recipe"), ingredients: z.array(z.object({ fdcId: z.number(), name: z.string(), grams: z.number() })) })]);
const serving = z.object({ label: z.string().min(1).describe("What one serving is, in the singular, such as slice or cup"), grams: z.number().positive() });
const wordsAtMost = (limit: number) => (text: string) => text.trim().split(/\s+/).length <= limit;
const shortText = (limit: number) => z.string().min(1).refine(wordsAtMost(limit), `Keep this to ${limit} words or fewer`);

const customStory = z.object({
  systems: z.array(system.exclude(["overview"])).min(1).describe("Body systems this touches, the main one first"),
  effects: z
    .array(
      z.object({
        channel: z.enum(CHANNELS).describe("heartRate bpm added; breathing per minute added; temperature C added; bloodPressure mmHg added; stress, reward, drowsiness, inflammation, immune 0 to 1; metabolism, insulinSensitivity, liverOutput a multiplier minus 1; appetite -1 to 1; fluidLoss ml per minute; muscleFlow added share of blood 0 to 1"),
        amount: z.number().describe("Value at full strength"),
        rise_min: z.number().min(0).describe("Minutes to reach full strength"),
        half_life_min: z.number().positive().describe("Half-life of the decay after the event ends"),
        after: z.boolean().optional().describe("True if this starts only when the event ends, such as drowsiness afterwards"),
      }),
    )
    .min(1),
  feelings: z.array(
    z.object({
      id: z.string().describe("Short lowercase id, such as nauseous"),
      label: z.string().describe("One word, such as Nauseous"),
      amount: z.number().min(0).max(1),
      rise_min: z.number().min(0),
      half_life_min: z.number().positive(),
      after: z.boolean().optional(),
      cause: shortText(10).describe("Why, in at most 10 plain words"),
      organ: organ.nullable(),
    }),
  ),
  stops: z
    .array(
      z.object({
        organ: organ.nullable(),
        muscle: z.enum(MUSCLE_GROUPS).nullable(),
        label: z.string().describe("One or two words"),
        after_min: z.number().min(0).describe("Minutes after the start when this becomes the current stop"),
        say: shortText(25).describe("What happens here, at most 25 plain words"),
        routes: z.array(z.enum(ROUTE_IDS)).describe("Vessels leading here from the previous stop; empty for a jump"),
      }),
    )
    .min(1),
});

// One step of a guided explanation: what to put on screen, and what to say about it.
const guideStep = z.object({
  title: shortText(6).describe("What this step is about, in a few words, such as The pancreas answers"),
  say: shortText(32).describe("One or two plain sentences, at most 32 words"),
  system: system.nullable().describe("The body system to show, or null to stay where the last step was"),
  process: z.string().nullable().describe("A process id from the readout to draw as a line through the body, or null"),
  organ: organ.nullable().describe("An organ to fly into, which also shows its diagram, or null"),
  muscle: z.enum(MUSCLE_GROUPS).nullable().describe("With organ muscle, the group to go to; otherwise null"),
  at: minute.nullable().describe("The minute to move to, so the body shows that moment, or null to stay at the same time"),
  unverified: z.array(z.string()).optional().describe("Leave this out. The app fills it in"),
});
export type GuideStep = z.infer<typeof guideStep>;

export const ACTION_SCHEMAS = {
  guide: z.object({ steps: z.array(guideStep).min(1).max(6) }),
  log_intake: z.object({
    id: z.string().describe("Short stable id, such as pizza or coffee_2"),
    label: z.string().describe("What the person would call it"),
    at: minute,
    grams: z.number().min(0),
    water_ml: z.number().min(0),
    carbs_g: z.number().min(0).describe("Total carbohydrate including fiber, as on a US label. The model subtracts fiber_g itself"),
    sugar_g: z.number().min(0),
    fat_g: z.number().min(0),
    protein_g: z.number().min(0),
    fiber_g: z.number().min(0),
    caffeine_mg: z.number().min(0),
    alcohol_g: z.number().min(0),
    liquid: z.boolean().describe("True for drinks"),
    fructose_share: z.number().min(0).max(1).optional().describe("Share of its sugar that is fructose, if it differs from table sugar's 0.5. About 0.6 for whole fruit such as apples"),
    assumption: z.string().describe("The portion you assumed, in a few words, shown to the person"),
    serving: serving.optional().describe("What one serving is, so they can correct the portion in those units"),
    source: foodSource.optional(),
  }),
  correct_intake: z
    .object({
      id: z.string(),
      grams: z.number().positive().optional().describe("How much they really had. Everything in the food scales with it"),
      at: minute.optional().describe("When they really had it"),
      assumption: z.string().optional().describe("The corrected portion in a few words, shown to the person"),
    })
    .refine((a) => a.grams !== undefined || a.at !== undefined, "Give grams, at, or both"),
  remove_intake: z.object({ id: z.string() }),
  set_activity: z.object({ posture, from: minute, until: minute.optional().describe("When the activity ends; the previous activity resumes") }),
  set_sleep: z
    .object({
      bed: minute.describe("When they went to sleep. Before midnight this is negative: 23:30 yesterday is -30"),
      wake: minute.describe("When they woke up today"),
    })
    .refine((a) => a.wake > a.bed, "wake must be later than bed"),
  set_cycle: z.object({
    last_start: z.number().int().min(-90 * 1440).max(1799).nullable().describe("When their latest period began, in minutes since 00:00 today: 3 days ago is -4320. Null clears it, such as on a hormonal contraceptive, in pregnancy or after menopause, when this curve doesn't apply"),
    length_days: z.number().int().min(21).max(45).optional().describe("The usual length of their cycle, only if they say. Otherwise 28"),
    period_days: z.number().int().min(2).max(10).optional().describe("How long their period usually lasts, only if they say. Otherwise 5"),
  }),
  set_body: z.object({
    sex: z.enum(["male", "female"]).optional(),
    age: z.number().min(18).max(90).optional(),
    height_cm: z.number().min(145).max(205).optional(),
    weight_kg: z.number().min(42).max(140).optional(),
  }),
  set_now: z.object({ at: minute }),
  define_substance: z.object({
    id: z.string(),
    label: z.string(),
    at: minute,
    dose_mg: z.number().positive(),
    tmax_min: z.number().positive().describe("Minutes from taking it to peak blood level"),
    half_life_h: z.number().positive(),
    volume_l_per_kg: z.number().positive(),
    bioavailability: z.number().min(0).max(1),
    targets: z.array(z.object({ organ, effect: z.string().describe("What it does there, under 12 words") })).min(1),
    source: z.string().describe("Where these kinetics come from"),
  }),
  log_event: z
    .object({
      id: z.string().describe("Short stable id, such as cold or chest_day. Reusing an id replaces that event"),
      label: z.string().max(30).describe("The way a person says it, such as Chest and triceps workout or Cold"),
      preset: z.enum(PRESETS),
      from: eventMinute,
      until: eventMinute.nullable().describe("When it ended, or null while it is still going on"),
      intensity: z.number().min(0).max(1).describe("training: 0.3 easy, 0.6 solid, 1 to failure. illness: 0.3 a mild cold, 0.6 a bad cold, 1 a bad flu. sex: 0.6 typical. stress: 1 a job interview in front of a panel, 0.5 a hard day. poor_sleep: 1 about 4 hours of sleep, 0.5 about 6 hours"),
      muscles: z.array(z.object({ group: z.enum(MUSCLE_GROUPS), load: z.number().min(0).max(1).describe("1 for the main target, 0.5 for a helper muscle") })).describe("training only; empty otherwise"),
      symptoms: z.array(z.enum(SYMPTOMS)).describe("illness only, what they actually report; empty otherwise. Only fever raises temperature"),
      source: z.string().describe("custom only: where your numbers come from, or that they are your own estimate. Empty otherwise"),
      custom: customStory.nullable().describe("custom only; null otherwise"),
    })
    .superRefine((a, ctx) => {
      const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
      if (a.until !== null && a.until <= a.from) issue("until", "until must be later than from");
      if (a.preset === "training" && !a.muscles.length) issue("muscles", "training needs at least one muscle group; use the groups they name");
      if (a.preset !== "training" && a.muscles.length) issue("muscles", "muscles is for training only; pass an empty list");
      if (a.preset !== "illness" && a.symptoms.length) issue("symptoms", "symptoms is for illness only; pass an empty list");
      if (a.preset === "custom" && !a.custom) issue("custom", "a custom event needs its custom story");
      if (a.preset !== "custom" && a.custom) issue("custom", "custom is for the custom preset only; pass null");
    }),
  end_event: z.object({ id: z.string().describe("The id given to log_event"), at: eventMinute.describe("When it ended") }),
  show_system: z.object({ system }),
  show_process: z.object({ id: z.string().nullable().describe("A process id from the readout, such as intake:pizza, meal:pizza, insulin or alertness; null hides the line") }),
  focus_organ: z.object({ organ: organ.nullable(), muscle: z.enum(MUSCLE_GROUPS).nullable().optional().describe("With organ \"muscle\", the group to go to") }),
  what_if: z.object({
    label: z.string().describe("Short name for the alternative, such as Walk 15 min now"),
    posture,
    from: minute,
    until: minute,
  }),
} as const;

export type ActionName = keyof typeof ACTION_SCHEMAS;
export type Action = { [K in ActionName]: { name: K; args: z.infer<(typeof ACTION_SCHEMAS)[K]> } }[ActionName];

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

function withActivity(activities: ActivitySpan[], posture: Posture, from: number, until?: number): ActivitySpan[] {
  // What the body would be doing by then anyway, which past bedtime is sleeping.
  const resume = until === undefined ? null : postureAt(activities, until);
  const kept = activities.filter((a) => a.from < from || (until !== undefined && a.from >= until));
  const next: ActivitySpan[] = [...kept, { from, posture }];
  // The body falls asleep at bedtime unless a span starts after it, so a late walk has to say it's still going.
  if (until !== undefined && from < DAY.sleepMin && until > DAY.sleepMin) next.push({ from: DAY.sleepMin, posture });
  if (until !== undefined && resume) next.push({ from: until, posture: resume });
  return next.sort((a, b) => a.from - b.from);
}

// The night they describe. Past their usual bedtime they were still up, and once awake they stay up.
function withSleep(activities: ActivitySpan[], bed: number, wake: number): ActivitySpan[] {
  const usualBed = DAY.sleepMin - 1440;
  const afterwards = postureAt(activities, wake);
  const kept = activities.filter((a) => a.from < Math.min(bed, usualBed) || a.from > wake);
  const up: ActivitySpan[] = bed > usualBed ? [{ from: usualBed, posture: "sitting" }] : [];
  const next: ActivitySpan[] = [...kept, ...up, { from: bed, posture: "sleeping" }, { from: wake, posture: afterwards === "sleeping" ? "standing" : afterwards }];
  return next.sort((a, b) => a.from - b.from);
}

const scaledTo = (intake: Intake, grams: number): Intake => {
  const by = grams / intake.grams;
  const source = intake.source?.kind === "recipe" ? { ...intake.source, ingredients: intake.source.ingredients.map((part) => ({ ...part, grams: part.grams * by })) } : intake.source;
  return { ...intake, source, grams, waterMl: intake.waterMl * by, carbsG: intake.carbsG * by, sugarG: intake.sugarG * by, fatG: intake.fatG * by, proteinG: intake.proteinG * by, fiberG: intake.fiberG * by, caffeineMg: intake.caffeineMg * by, alcoholG: intake.alcoholG * by };
};

function storyFrom(custom: z.infer<typeof customStory>): CustomStory {
  return {
    systems: custom.systems,
    effects: custom.effects.map((e) => ({ channel: e.channel, amount: e.amount, riseMin: e.rise_min, halfLifeMin: e.half_life_min, after: e.after })),
    feelings: custom.feelings.map((f) => ({ id: f.id, label: f.label, amount: f.amount, riseMin: f.rise_min, halfLifeMin: f.half_life_min, after: f.after, cause: f.cause, organ: f.organ })),
    stops: custom.stops.map((s) => ({ organ: s.organ, muscle: s.muscle, label: s.label, afterMin: s.after_min, say: s.say, routes: s.routes })),
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

// One compact line per call, shown under the person's message while the body responds.
export function traceLine(action: Action): string {
  const clock = formatClock;
  switch (action.name) {
    case "log_intake": {
      const a = action.args;
      const kcal = Math.round(Math.max(0, a.carbs_g - a.fiber_g) * 4 + a.fat_g * 9 + a.protein_g * 4 + a.alcohol_g * 7);
      return `log_intake ${a.label}, ${clock(a.at)}, ${a.caffeine_mg > 0 && kcal < 30 ? `${a.caffeine_mg} mg caffeine` : `${kcal} kcal`}`;
    }
    case "correct_intake": {
      const { id, grams, at } = action.args;
      return `correct_intake ${id}${grams === undefined ? "" : `, ${Math.round(grams)} g`}${at === undefined ? "" : `, at ${clock(at)}`}`;
    }
    case "remove_intake":
      return `remove_intake ${action.args.id}`;
    case "set_activity":
      return `set_activity ${action.args.posture}, from ${clock(action.args.from)}`;
    case "set_sleep":
      return `set_sleep ${clock(action.args.bed)} to ${clock(action.args.wake)}`;
    case "set_cycle":
      return action.args.last_start === null ? "set_cycle none" : `set_cycle period began ${clock(action.args.last_start)}, ${action.args.length_days ?? CYCLE.lengthDays} days`;
    case "set_body":
      return `set_body ${Object.entries(action.args).map(([k, v]) => `${k} ${v}`).join(", ")}`;
    case "set_now":
      return `set_now ${clock(action.args.at)}`;
    case "define_substance":
      return `define_substance ${action.args.label}, ${action.args.dose_mg} mg, half-life ${action.args.half_life_h} h`;
    case "log_event": {
      const a = action.args;
      return `log_event ${a.preset === "sex" ? SEX_LABEL : a.label}, ${a.preset}, ${clock(a.from)}${a.until === null ? ", ongoing" : ` to ${clock(a.until)}`}`;
    }
    case "end_event":
      return `end_event ${action.args.id}, ${clock(action.args.at)}`;
    case "show_system":
      return `show_system ${action.args.system}`;
    case "show_process":
      return `show_process ${action.args.id ?? "none"}`;
    case "focus_organ":
      return `focus_organ ${action.args.muscle ?? action.args.organ ?? "whole body"}`;
    case "guide":
      return `guide, ${action.args.steps.length} steps`;
    case "what_if":
      return `what_if ${action.args.label}`;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
