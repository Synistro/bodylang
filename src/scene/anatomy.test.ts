import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Sex } from "../model/scenario";
import { Anatomy } from "./anatomy";
import type { BodyAsset, LimbRouteId, OrganAsset } from "./assets";
import { Figure } from "./figure";
import { PALETTES } from "./materials";
import { MuscleAsset, Muscles } from "./muscles";

function pair(name: string) {
  const file = readFileSync(`public/assets/${name}.bin`);
  return {
    meta: JSON.parse(readFileSync(`public/assets/${name}.json`, "utf8")),
    bin: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  };
}

function rigged(sex: Sex) {
  const body: BodyAsset = pair("body");
  const muscleAsset: MuscleAsset = pair("muscles");
  const organs: OrganAsset = pair(`organs-${sex}`);
  const resolution = new THREE.Vector2(1000, 800);
  const figure = new Figure(body, PALETTES.light);
  figure.setBody({ sex, age: 30, heightCm: 180, weightKg: 80 }, sex === "female" ? 1 : 0);
  figure.setPose(0, 0, 0);
  const muscles = new Muscles(muscleAsset, figure, PALETTES.light, resolution);
  muscles.setBody(sex, 1.8, 80);
  const quiet = { visible: 0, shown: {}, outlined: [], levels: {}, palette: PALETTES.light, hover: null, focus: null };
  for (let frame = 0; frame < 120; frame++) muscles.update(0.05, quiet);
  const bones = muscleAsset.meta.joints.map((name) => {
    const bone = figure.bones.get(name);
    if (!bone) throw new Error(`No joint ${name}`);
    return bone;
  });
  const anatomy = new Anatomy(organs, PALETTES.light, resolution, bones);
  // The organs' place on the hips, as the stage sets it.
  const reference = figure.referenceTorso[sex];
  const hips = figure.restJoints.get("hips");
  const neck = figure.restJoints.get("neck");
  if (!hips || !neck) throw new Error("The figure has no trunk");
  const scale = neck.distanceTo(hips) / reference.neck.distanceTo(reference.hips);
  const torso = new THREE.Matrix4().makeScale(scale, scale, scale);
  const place = reference.hips.clone().multiplyScalar(-scale).setX(0);
  torso.setPosition(place);
  anatomy.setVesselBones(muscles.boneInverses, muscleAsset.meta.joints.indexOf("hips"), torso);
  return { figure, anatomy, organs };
}

const LIMBS: [LimbRouteId, string][] = [
  ["leg_L", "foot.L"],
  ["leg_R", "foot.R"],
  ["arm_L", "hand.L"],
  ["arm_R", "hand.R"],
];

describe.each<Sex>(["male", "female"])("the anatomy of the %s body", (sex) => {
  const { figure, anatomy, organs } = rigged(sex);
  const route = (id: LimbRouteId) => anatomy.posedLimbRoute(id, new THREE.Matrix4());

  it.each(LIMBS)("runs %s as one unbroken artery out to the end of the limb", (id, end) => {
    const points = route(id);
    for (let i = 1; i < points.length; i++) expect(points[i].distanceTo(points[i - 1])).toBeLessThan(0.03);
    const joint = figure.worldJoint(end);
    expect(points[points.length - 1].distanceTo(joint)).toBeLessThan(0.14);
    expect(points[0].distanceTo(joint)).toBeGreaterThan(0.4);
  });

  it("carries a limb's artery with the limb when the body sits", () => {
    figure.setPose(0, 0, 0);
    const standing = route("leg_L");
    figure.setPose(1, 0, 0);
    const seated = route("leg_L");
    figure.setPose(0, 0, 0);
    const last = standing.length - 1;
    expect(seated[last].distanceTo(standing[last])).toBeGreaterThan(0.3);
    expect(seated[last].distanceTo(figure.worldJoint("foot.L"))).toBeLessThan(0.45);
  });

  it("draws the great vessels first, so a quieter view can stop at them", () => {
    for (const name of ["arteries", "veins"]) {
      const { tiers, indexCount } = organs.meta.organs[name];
      if (!tiers) throw new Error(`${name} has no tiers`);
      expect(tiers[0].indexCount).toBeGreaterThan(0);
      expect(tiers[0].indexCount).toBeLessThan(tiers[tiers.length - 1].indexCount);
      expect(tiers[tiers.length - 1].indexCount).toBe(indexCount);
    }
  });

  it("gives the vessels only joints the skeleton has", () => {
    for (const name of ["arteries", "veins"]) {
      const meta = organs.meta.organs[name];
      if (meta.skinIndex === undefined || meta.skinWeight === undefined) throw new Error(`${name} has no skin`);
      const index = new Uint8Array(organs.bin, meta.skinIndex, meta.vertexCount * 4);
      const weight = new Uint8Array(organs.bin, meta.skinWeight, meta.vertexCount * 4);
      for (let v = 0; v < meta.vertexCount; v += 97) {
        expect(weight[v * 4] + weight[v * 4 + 1] + weight[v * 4 + 2] + weight[v * 4 + 3]).toBe(255);
        expect(index[v * 4]).toBeLessThan(19);
      }
    }
  });
});
