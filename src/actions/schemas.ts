import { z } from "zod";
import { composedSpec } from "../closeup/composed";
import { closeupOf, closeupSpec } from "../closeup/list";
import { CHANNELS, PRESETS, SYMPTOMS, TRACK_FROM } from "../model/events/types";
import { MUSCLE_GROUPS } from "../model/muscleGroups";
import { ROUTE_IDS, ORGANS } from "../model/ids";
import { shortText } from "../model/shortText";
import { SUBSTANCE_ROUTES } from "../model/scenario";

// The one vocabulary between language and the body: Claude calls these as tools, the scripted
// opening replays them, and the browser and server share the same reducer.

const minute = z.number().int().min(-1440).max(1799).describe("Minutes since 00:00 today, for example 16:45 is 1005. Yesterday is negative: 23:00 yesterday is -60");
const organ = z.enum(ORGANS);
const posture = z.enum(["sleeping", "sitting", "standing", "walking", "running"]);
const system = z.enum(["overview", "digestion", "energy", "circulation", "muscles", "brain", "immune", "clearing", "reproductive"]);
const eventMinute = z.number().int().min(-14 * 1440).max(1799).describe("Minutes since 00:00 today. Negative for earlier days: 18:00 yesterday is -360");
const foodSource = z.discriminatedUnion("kind", [z.object({ kind: z.literal("table"), fdcId: z.number(), name: z.string(), dataset: z.string() }), z.object({ kind: z.literal("estimate") }), z.object({ kind: z.literal("recipe"), ingredients: z.array(z.object({ fdcId: z.number(), name: z.string(), grams: z.number() })) })]);
const serving = z.object({ label: z.string().min(1).describe("What one serving is, in the singular, such as slice or cup"), grams: z.number().positive() });

export const customStory = z.object({
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
  track: z
    .object({
      aim: organ.describe("The organ it goes through"),
      from: z.enum(TRACK_FROM).describe("The side of the body it comes from, the person's own left and right"),
      crossed: z.array(z.object({ organ: organ.nullable(), name: z.string() })).optional().describe("Leave this out. The app fills it in"),
    })
    .nullable()
    .optional()
    .describe("Only for a hypothetical injury that goes through the body. A straight line, which the app tests against the real organs and tells you what it crosses. Null otherwise"),
});

const STEP_REACHES_DAYS = 8;

// One step of a guided explanation: what to put on screen, and what to say about it.
const guideStep = z.object({
  title: shortText(6).describe("What this step is about, in a few words, such as The pancreas answers"),
  say: shortText(32).describe("One or two plain sentences, at most 32 words"),
  system: system.nullable().describe("The body system to show, or null to stay where the last step was. A step with an organ shows that organ's own"),
  process: z.string().nullable().describe("A process id from the readout, or null. With no organ, it is drawn as a line through the body. With an organ, it is what the step is about: its row stands out in the panel and its way to this organ is drawn on the body"),
  organ: organ.nullable().describe("An organ to fly into, which also shows its diagram, or null"),
  muscle: z.enum(MUSCLE_GROUPS).nullable().describe("With organ muscle, the group to go to; otherwise null"),
  at: z.number().int().min(-STEP_REACHES_DAYS * 1440).max(STEP_REACHES_DAYS * 1440).nullable().describe("The minute to move to, so the body shows that moment, or null to stay at the same moment as the step before. It counts from 00:00 today, so an earlier day is negative"),
  closeup: closeupSpec.nullable().describe("What this step points at in the close-up beside the body. Every step on an organ listed under close-ups needs one, unless it composes a drawing. Null otherwise"),
  composed: composedSpec.nullable().optional().describe("A drawing you compose, shown in place of the organ's own drawing, for what that drawing can't show. Needs an organ. Null otherwise"),
  unverified: z.array(z.string()).optional().describe("Leave this out. The app fills it in"),
}).refine((step) => !step.closeup || step.closeup.organ === step.organ, "A close-up has to be of the organ the step flies to").refine((step) => step.closeup || step.composed || !step.organ || !closeupOf(step.organ), "A step on this organ needs a closeup, with light naming what it is about, or a composed drawing").refine((step) => !step.composed || step.organ, "A composed drawing shows beside an organ, so name one").refine((step) => {
  const closeup = step.closeup;
  return !closeup || closeup.basis !== null || (Object.keys(closeup.set).length === 0 && closeup.compare === null);
}, "Numbers in set or compare need a basis");
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
    route: z.enum(SUBSTANCE_ROUTES).default("swallowed").describe("How it gets in: swallowed, inhaled as with smoke or vapour, or injected"),
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
