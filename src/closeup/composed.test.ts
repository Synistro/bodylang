import { describe, expect, it } from "vitest";
import { compositionOf, ComposedSpec, composedSpec, layoutComposed } from "./composed";

const healthy = { state: "healthy" as const, amount: 0 };
const actor = (
  id: string,
  label: string,
  from: string,
  to: string,
  over: Partial<ComposedSpec["actors"][number]> = {},
) => ({ id, label, look: "molecule" as const, tone: "drug" as const, from, to, amount: 0.7, settles: false, ...over });

const airSac: ComposedSpec = {
  caption: "Smoke crossing an air sac",
  layers: [
    { id: "air", kind: "air", label: "Air sac", ...healthy },
    { id: "wall", kind: "wall", label: "Thin wall", state: "inflamed", amount: 0.4 },
    { id: "blood", kind: "blood", label: "Blood vessel", ...healthy },
  ],
  actors: [
    actor("nicotine", "Nicotine", "air", "blood"),
    actor("tar", "Tar", "air", "wall", { settles: true, look: "dot", tone: "gas" }),
    actor("co", "Carbon monoxide", "air", "blood", { tone: "gas" }),
  ],
  light: ["nicotine"],
  basis: "Benowitz 2009 on nicotine absorption",
};

const wound: ComposedSpec = {
  caption: "A torn vessel inside the liver",
  layers: [
    { id: "skin", kind: "wall", label: "Skin", state: "torn", amount: 1 },
    { id: "liver", kind: "tissue", label: "Liver cells", state: "torn", amount: 0.7 },
    { id: "vessel", kind: "blood", label: "Portal vein branch", state: "torn", amount: 0.8 },
    { id: "space", kind: "space", label: "Belly cavity", ...healthy },
  ],
  actors: [
    actor("blood", "Blood", "vessel", "space"),
    actor("clot", "Platelets", "vessel", "liver", { look: "dot", settles: true }),
    actor("cells", "Immune cells", "vessel", "liver", { look: "cell", tone: "immune", settles: true }),
    actor("pain", "Pain signal", "liver", "liver", { look: "pulse", tone: "nerve" }),
    actor("fluid", "Fluid", "vessel", "space", { look: "dot" }),
  ],
  light: [],
  basis: "Trauma surgery textbook understanding",
};

describe("what Claude can compose", () => {
  it("accepts a real composition", () => {
    expect(composedSpec.safeParse(airSac).success).toBe(true);
    expect(composedSpec.safeParse(wound).success).toBe(true);
  });

  it("refuses an actor going to a layer that isn't there", () => {
    expect(composedSpec.safeParse({ ...airSac, actors: [actor("x", "X", "air", "nowhere")] }).success).toBe(false);
  });

  it("refuses to light what isn't there, and two parts sharing an id", () => {
    expect(composedSpec.safeParse({ ...airSac, light: ["ghost"] }).success).toBe(false);
    expect(composedSpec.safeParse({ ...airSac, actors: [actor("air", "Air", "air", "blood")] }).success).toBe(false);
  });

  it("wants a basis, because every amount in it is Claude's", () => {
    expect(composedSpec.safeParse({ ...airSac, basis: "" }).success).toBe(false);
  });

  it("limits how much one drawing can hold", () => {
    const layers = Array.from({ length: 6 }, (_, i) => ({
      id: `l${i}`,
      kind: "wall" as const,
      label: "Wall",
      ...healthy,
    }));
    expect(composedSpec.safeParse({ ...airSac, layers, actors: [], light: [] }).success).toBe(false);
  });
});

describe("how code lays it out", () => {
  for (const [name, spec] of [
    ["an air sac", airSac],
    ["a wound", wound],
  ] as const) {
    it(`keeps every layer on the plate and in order for ${name}`, () => {
      const { layers } = layoutComposed(spec);
      layers.forEach((placed, i) => {
        expect(placed.top).toBeGreaterThanOrEqual(25);
        expect(placed.top + placed.height).toBeLessThanOrEqual(176.01);
        if (i) expect(placed.word.y).toBeGreaterThan(layers[i - 1].top + layers[i - 1].height - 0.01);
      });
    });

    it(`never lets two words land on each other for ${name}`, () => {
      const { words } = layoutComposed(spec);
      for (const [i, a] of words.entries()) {
        for (const b of words.slice(i + 1)) {
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart).toBe(true);
        }
      }
    });
  }

  it("fills the plate with a single layer too", () => {
    const [only] = layoutComposed({ ...airSac, layers: [airSac.layers[0]], actors: [], light: [] }).layers;
    expect(only.center).toBeGreaterThan(70);
    expect(only.center).toBeLessThan(130);
  });

  it("treats a change of amount as the same picture, and a change of parts as a new one", () => {
    const later = { ...airSac, actors: airSac.actors.map((a) => ({ ...a, amount: 0.1 })), caption: "Later" };
    expect(compositionOf(later)).toBe(compositionOf(airSac));
    expect(compositionOf({ ...airSac, actors: [] })).not.toBe(compositionOf(airSac));
    expect(
      compositionOf({ ...airSac, layers: airSac.layers.map((layer) => ({ ...layer, label: "Renamed" })) }),
    ).not.toBe(compositionOf(airSac));
  });
});
