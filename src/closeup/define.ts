import { z } from "zod";
import { shortText } from "../agent/shortText";
import type { MuscleGroup } from "../model/muscleGroups";
import type { OrganId, Trajectory } from "../model/simulate";

// A close-up is the one drawing of what happens inside an organ, shown beside the body all the time. The
// model sets its levels, each from 0 to 1. During an Ask walkthrough, a step can point at parts of it and
// adjust what the model can't know. Nothing in here draws, so the server can load it too.
export type Levels<K extends string = string> = Readonly<Record<K, number>>;

export interface Place {
  trajectory: Trajectory;
  muscle: MuscleGroup | null;
}

// Something a level sends across the body, drawn on the body when a step lights that level. `here` is the
// place the close-up shows, and `through` names the skeleton's joints on the way.
export interface Travel {
  kind: "nerve" | "blood";
  from: "here" | OrganId;
  through: string[];
  to: "here" | OrganId;
}

export type FromModel<K extends string> = (place: Place, minute: number) => Levels<K>;

interface Definition<O extends OrganId, K extends string> {
  organ: O;
  settings: Record<K, string>; // what each level means, in words Claude reads
  fromModel: FromModel<K>;
  travels: Partial<Record<K, Travel>>;
}

type Amounts<K extends string> = Partial<Record<K, number>>;

export function defineCloseup<const O extends OrganId, K extends string>(definition: Definition<O, K>) {
  const keys = Object.keys(definition.settings) as [K, ...K[]];
  const amounts = (most: number) => {
    const shape = Object.fromEntries(keys.map((key) => [key, z.number().min(0).max(most).optional().describe(definition.settings[key])]));
    return z.object(shape as Record<K, z.ZodOptional<z.ZodNumber>>);
  };
  const spec = z.object({
    organ: z.literal(definition.organ),
    light: z.array(z.enum(keys)).min(1).max(3).describe("What this step is about. These stand out and the rest of the drawing dims"),
    set: amounts(1).describe("Levels from 0 to 1, only for what the model can't know in this case. Leave out everything else, because the model sets it"),
    compare: z
      .object({
        this_label: shortText(3).describe("What the upper drawing is, such as First session"),
        other_label: shortText(3).describe("What the lower drawing is, such as Repeat session"),
        times: amounts(3).describe("How much of each level the lower drawing has, compared with the upper one, such as 0.4 for less than half"),
      })
      .nullable()
      .describe("A second drawing below the first, for when the question is about a difference. Otherwise null"),
    basis: z.string().min(1).nullable().describe("Where the numbers in set and compare come from: name the study or the textbook idea, or say it is your own understanding. Null when you use neither"),
  });
  return { ...definition, keys, spec };
}

export interface Adjustment<K extends string> {
  light: readonly K[] | null;
  set: Amounts<K>;
  times: Amounts<K>;
}

export const AS_THE_MODEL_SAYS: Adjustment<never> = { light: null, set: {}, times: {} };

interface Directions<K extends string> {
  light: readonly K[];
  set: Amounts<K>;
  compare: { this_label: string; other_label: string; times: Amounts<K> } | null;
}

export interface Panel<K extends string> {
  label: string | null;
  adjustment: Adjustment<K>;
}

// One drawing, or two to compare, from what a step asks for.
export function panelsOf<K extends string>(step: Directions<K> | null): Panel<K>[] {
  if (!step) return [{ label: null, adjustment: AS_THE_MODEL_SAYS }];
  const { light, set, compare } = step;
  if (!compare) return [{ label: null, adjustment: { light, set, times: {} } }];
  return [
    { label: compare.this_label, adjustment: { light, set, times: {} } },
    { label: compare.other_label, adjustment: { light, set, times: compare.times } },
  ];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const mapLevels = <K extends string>(keys: readonly K[], level: (key: K) => number) => Object.fromEntries(keys.map((key) => [key, level(key)])) as Levels<K>;

// What the drawing shows: the model's levels, with whatever the step changed.
export function levelsAt<K extends string>(keys: readonly K[], fromModel: FromModel<K>, place: Place, minute: number, { set, times }: Adjustment<K>): Levels<K> {
  const model = fromModel(place, minute);
  return mapLevels(keys, (key) => clamp01((set[key] ?? model[key]) * (times[key] ?? 1)));
}

// With nothing singled out, everything is as bright as it gets.
export const litLevels = <K extends string>(keys: readonly K[], light: readonly K[] | null): Levels<K> => mapLevels(keys, (key) => (!light || light.includes(key) ? 1 : 0));
