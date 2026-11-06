import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { MUSCLE_GROUPS } from "../model/muscleGroups";
import type { BodyAsset } from "./assets";
import { Figure } from "./figure";
import { PALETTES } from "./materials";
import { MuscleAsset, MuscleInput, MuscleMeta, Muscles } from "./muscles";

function buffer(path: string) {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

function bodyAsset(): BodyAsset {
  return { meta: JSON.parse(readFileSync("public/assets/body.json", "utf8")), bin: buffer("public/assets/body.bin") };
}

function muscleAsset(): MuscleAsset {
  const meta: MuscleMeta = JSON.parse(readFileSync("public/assets/muscles.json", "utf8"));
  return { meta, bin: buffer("public/assets/muscles.bin") };
}

const QUIET: MuscleInput = {
  visible: 0,
  shown: {},
  outlined: [],
  levels: {},
  palette: PALETTES.light,
  hover: null,
  focus: null,
};

describe("the muscle figure", () => {
  let muscles: Muscles;
  const meshesOf = () => muscles.group.children.filter((child) => child instanceof THREE.SkinnedMesh);
  const drawn = () => {
    const first = meshesOf()[0];
    if (!(first instanceof THREE.SkinnedMesh)) throw new Error("No muscle mesh");
    return first.geometry.drawRange.count;
  };
  const settle = (input: MuscleInput) => {
    for (let frame = 0; frame < 60; frame++) muscles.update(0.05, input);
  };

  beforeAll(() => {
    const figure = new Figure(bodyAsset(), PALETTES.light);
    figure.setBody({ sex: "male", age: 30, heightCm: 180, weightKg: 80 }, 0);
    figure.setPose(0, 0, 0);
    muscles = new Muscles(muscleAsset(), figure, PALETTES.light, new THREE.Vector2(1000, 800));
    muscles.setBody("male", 1.8, 80);
  });

  it("draws nothing and costs nothing while nothing is asked for", () => {
    settle(QUIET);
    expect(drawn()).toBe(0);
    expect(meshesOf().every((mesh) => !mesh.visible)).toBe(true);
  });

  it("draws only the groups asked for, with no bones", () => {
    settle({ ...QUIET, shown: { chest: 0.5 } });
    const chestOnly = drawn();
    expect(chestOnly).toBeGreaterThan(0);
    settle({ ...QUIET, shown: { chest: 0.5, quads: 0.5 } });
    expect(drawn()).toBeGreaterThan(chestOnly);
    const [depth, fill, outline, boneDepth, boneFill] = meshesOf();
    expect([depth.visible, fill.visible, outline.visible]).toEqual([true, true, true]);
    expect([boneDepth.visible, boneFill.visible]).toEqual([false, false]);
    settle(QUIET);
    expect(drawn()).toBe(0);
  });

  it("stands the whole figure on its bones, without a skull", () => {
    settle({ ...QUIET, visible: 1 });
    expect(drawn()).toBe(muscleAsset().meta.muscles.indexCount);
    const bones = meshesOf()[4];
    expect(bones.visible).toBe(true);
    if (!(bones instanceof THREE.SkinnedMesh)) throw new Error("No bone mesh");
    expect(bones.geometry.getIndex()?.count).toBeLessThan(muscleAsset().meta.bones.indexCount * 0.8);
  });

  const rayTo = (point: THREE.Vector3, from: THREE.Vector3) => {
    const raycaster = new THREE.Raycaster();
    raycaster.set(from, point.clone().sub(from).normalize());
    return raycaster;
  };

  it("picks the group under the ray, among those on screen", () => {
    settle({ ...QUIET, visible: 1 });
    const front = new THREE.Vector3(0, 1.4, 4);
    const chest = muscles.anchorOf("chest", new THREE.Vector3());
    expect(muscles.pick(rayTo(chest, front))?.group).toBe("chest");
    settle({ ...QUIET, shown: { quads: 0.5 } });
    expect(muscles.pick(rayTo(chest, front))).toBe(null);
    const quads = muscles.anchorOf("quads", new THREE.Vector3());
    expect(muscles.pick(rayTo(quads, new THREE.Vector3(0, 0.8, 4)))?.group).toBe("quads");
    settle(QUIET);
    expect(muscles.pick(rayTo(chest, front))).toBe(null);
  });

  it("anchors every group inside the body, with sides that mirror", () => {
    for (const group of MUSCLE_GROUPS) {
      const left = muscles.anchorOf(group, new THREE.Vector3(), "left");
      const right = muscles.anchorOf(group, new THREE.Vector3(), "right");
      expect(left.y).toBeGreaterThan(0.2);
      expect(left.y).toBeLessThan(1.8);
      expect(Math.abs(left.x + right.x)).toBeLessThan(0.04);
    }
  });
});
