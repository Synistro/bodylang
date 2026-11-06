import { z } from "zod";
import { shortText } from "../agent/shortText";

// A drawing Claude composes for what no organ's own drawing shows, such as dopamine at a nerve ending, smoke
// in an air sac or a torn vessel. Claude says what is there: layers from top to bottom, and things moving
// between them. Code does all the layout, so a composition can't overlap, run off the plate or fall apart.
export const LAYER_KINDS = ["blood", "lymph", "air", "tissue", "wall", "nerve", "space"] as const;
export const LAYER_STATES = ["healthy", "torn", "blocked", "narrowed", "inflamed"] as const;
export const ACTOR_LOOKS = ["cell", "molecule", "dot", "pulse"] as const;
export const ACTOR_TONES = ["blood", "immune", "food", "nerve", "drug", "gas"] as const;

const MOST_LAYERS = 5;
const MOST_ACTORS = 5;

const partId = z.string().regex(/^[a-z][a-z0-9_]*$/, "Lowercase letters, digits and underscores");
const amount = z.number().min(0).max(1);

export const composedSpec = z
  .object({
    caption: shortText(8).describe("What this drawing shows, in at most 8 plain words"),
    layers: z
      .array(
        z.object({
          id: partId,
          kind: z.enum(LAYER_KINDS).describe("blood: a vessel carrying red cells. lymph: a pale vessel. air: an open airway or air sac. tissue: a sheet of cells. wall: a thin membrane. nerve: a nerve carrying signals. space: an empty gap, such as between two nerve cells"),
          label: shortText(4).describe("What it is, such as Air sac or Liver cells"),
          state: z.enum(LAYER_STATES).describe("torn works on anything. blocked and narrowed work on blood. inflamed works on tissue and wall. healthy shows nothing wrong"),
          amount: amount.describe("How far gone the state is, or how strong a nerve's signal is. 0 to 1"),
        }),
      )
      .min(1)
      .max(MOST_LAYERS)
      .describe("From the top of the drawing to the bottom. Keep ids the same from step to step, so the picture changes and doesn't jump"),
    actors: z
      .array(
        z.object({
          id: partId,
          label: shortText(3).describe("What it is, such as Nicotine or Immune cell"),
          look: z.enum(ACTOR_LOOKS).describe("cell: large, with a body. molecule: a small ring. dot: a fine speck. pulse: a travelling signal"),
          tone: z.enum(ACTOR_TONES),
          from: partId.describe("The id of the layer it comes from"),
          to: partId.describe("The id of the layer it goes to. The same layer means it travels along that layer"),
          amount: amount.describe("How many are moving, 0 to 1"),
          settles: z.boolean().describe("True if it stays where it arrives, such as tar on a wall or a cell at a wound"),
        }),
      )
      .max(MOST_ACTORS),
    light: z.array(partId).max(3).describe("The ids this step is about: they stand out and the rest dims. Empty lights everything"),
    basis: z.string().min(1).describe("Where this picture of what happens comes from: name the study or textbook idea, or say it is your own understanding"),
  })
  .superRefine((spec, ctx) => {
    const layers = spec.layers.map((layer) => layer.id);
    const actors = spec.actors.map((actor) => actor.id);
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set([...layers, ...actors]).size !== layers.length + actors.length) issue("Every layer and actor needs its own id");
    for (const actor of spec.actors) for (const end of [actor.from, actor.to]) if (!layers.includes(end)) issue(`${actor.id} names a layer that isn't there: ${end}`);
    for (const id of spec.light) if (!layers.includes(id) && !actors.includes(id)) issue(`light names something that isn't there: ${id}`);
  });

export type ComposedSpec = z.infer<typeof composedSpec>;
export type ComposedLayer = ComposedSpec["layers"][number];
export type ComposedActor = ComposedSpec["actors"][number];

// Two steps with the same parts are one picture changing. Anything else is a new picture.
export const compositionOf = ({ layers, actors }: ComposedSpec) => JSON.stringify([layers.map((l) => [l.id, l.kind, l.label]), actors.map((a) => [a.id, a.label, a.look, a.tone, a.from, a.to, a.settles])]);

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedLayer {
  layer: ComposedLayer;
  top: number;
  height: number;
  center: number;
  word: { x: number; y: number };
}

export interface PlacedActor {
  actor: ComposedActor;
  column: number;
  fromY: number;
  toY: number;
  word: { x: number; y: number; anchor: "start" | "end" };
}

export interface ComposedLayout {
  layers: PlacedLayer[];
  actors: PlacedActor[];
  words: Box[];
}

const BAND_HEIGHT: Record<ComposedLayer["kind"], number> = { blood: 14, lymph: 9, air: 30, tissue: 30, wall: 5, nerve: 6, space: 14 };
const WORD_ROW = 9; // the layer's name sits on its own row just above it
const AREA = { top: 25, bottom: 176, left: 6, right: 234 };
const COLUMNS = { from: 92, to: 218 };
const WORD = { unitsPerLetter: 3.9, height: 8, off: 7, step: 9 };
const OFFSETS = [0, -1, 1, -2, 2];

const wordBox = (x: number, y: number, anchor: "start" | "end", text: string): Box => {
  const width = text.length * WORD.unitsPerLetter;
  return { x: anchor === "start" ? x : x - width, y: y - WORD.height / 2, width, height: WORD.height };
};

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const fits = (box: Box) => box.x >= AREA.left && box.x + box.width <= AREA.right && box.y >= AREA.top - 2 && box.y + box.height <= AREA.bottom + 2;

// Layers share the height, with what is left over in the gaps, because that is where things travel. A word
// goes on the first free place near the middle of its path, so no two words ever land on each other.
export function layoutComposed(spec: ComposedSpec): ComposedLayout {
  const needed = spec.layers.reduce((sum, layer) => sum + BAND_HEIGHT[layer.kind] + WORD_ROW, 0);
  const room = AREA.bottom - AREA.top;
  const scale = Math.min(1, (room - (spec.layers.length - 1) * 2) / needed);
  const spare = Math.max(0, room - needed * scale);
  const gap = spec.layers.length > 1 ? spare / (spec.layers.length - 1) : 0;
  let y = spec.layers.length > 1 ? AREA.top : AREA.top + spare / 2;
  const words: Box[] = [];
  const layers = spec.layers.map((layer): PlacedLayer => {
    const height = BAND_HEIGHT[layer.kind] * scale;
    const wordY = y + (WORD_ROW * scale) / 2;
    const top = y + WORD_ROW * scale;
    y = top + height + gap;
    words.push(wordBox(AREA.left, wordY, "start", layer.label));
    return { layer, top, height, center: top + height / 2, word: { x: AREA.left, y: wordY } };
  });
  const centerOf = (id: string) => layers.find(({ layer }) => layer.id === id)?.center ?? AREA.top;
  const actors = spec.actors.map((actor, i): PlacedActor => {
    const column = COLUMNS.from + ((i + 0.5) / spec.actors.length) * (COLUMNS.to - COLUMNS.from);
    const fromY = centerOf(actor.from);
    const toY = centerOf(actor.to);
    const middle = (fromY + toY) / 2;
    const tries = OFFSETS.flatMap((off) => [
      { x: column + WORD.off, y: middle + off * WORD.step, anchor: "start" as const },
      { x: column - WORD.off, y: middle + off * WORD.step, anchor: "end" as const },
    ]);
    const box = (at: (typeof tries)[number]) => wordBox(at.x, at.y, at.anchor, actor.label);
    const word = tries.find((at) => fits(box(at)) && !words.some((other) => overlap(box(at), other))) ?? tries[0];
    words.push(box(word));
    return { actor, column, fromY, toY, word };
  });
  return { layers, actors, words };
}
