import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RouteId } from "../model/ids";
import type { Sex } from "../model/scenario";
import type { OrganMeta } from "./assets";
import { RouteNetwork, tracePath, traceStrands } from "./flows";

const ROUTE_IDS = [
  "esophagus", "stomach_out", "duodenum", "jejunum", "ileum", "colon", "portal_liver", "liver_out", "ivc", "svc", "to_lung_L", "to_lung_R", "from_lung_L", "from_lung_R", "arch", "carotid", "to_neck", "descending", "to_gut", "to_kidney_L", "to_kidney_R", "from_kidney_L", "from_kidney_R", "from_brain", "to_liver_art", "pancreas_portal", "lymph", "lymph_svc", "leg_L", "leg_R", "arm_L", "arm_R", "to_bladder_L", "to_bladder_R",
] as const satisfies readonly RouteId[];

function networkFor(sex: Sex) {
  const meta: OrganMeta = JSON.parse(readFileSync(`public/assets/organs-${sex}.json`, "utf8"));
  const stomach = new THREE.Vector3().fromArray(meta.landmarks.gastric_impression_of_liver);
  const pylorus = new THREE.Vector3().fromArray(meta.landmarks.duodenum_superior);
  const throat = new THREE.Vector3().fromArray(meta.landmarks.trachea);
  return {
    meta,
    network: new RouteNetwork(meta, new THREE.LineCurve3(stomach, pylorus), new THREE.LineCurve3(throat, stomach)),
  };
}

describe.each<Sex>(["male", "female"])("routes on the %s body", (sex) => {
  const { meta, network } = networkFor(sex);
  const center = (name: string) => new THREE.Vector3().fromArray(meta.organs[name].center);
  const first = (id: RouteId) => network.route(id).points[0];
  const last = (id: RouteId) => {
    const points = network.route(id).points;
    return points[points.length - 1];
  };

  it.each(ROUTE_IDS.filter((id) => !id.startsWith("leg_") && !id.startsWith("arm_")))("%s is one continuous line", (id) => {
    const { points } = network.route(id);
    expect(points.length).toBeGreaterThan(2);
    for (let i = 1; i < points.length; i++) expect(points[i].distanceTo(points[i - 1])).toBeLessThan(0.012);
  });

  it("runs blood in the direction it flows", () => {
    expect(first("descending").y).toBeGreaterThan(last("descending").y);
    expect(first("ivc").y).toBeLessThan(last("ivc").y);
    expect(first("svc").y).toBeGreaterThan(last("svc").y);
    expect(first("portal_liver").y).toBeLessThan(last("portal_liver").y);
    expect(first("carotid").y).toBeLessThan(last("carotid").y);
    expect(first("from_brain").y).toBeGreaterThan(last("from_brain").y);
  });

  it("reaches the organ on the right side", () => {
    expect(last("to_kidney_L").distanceTo(center("kidney_L"))).toBeLessThan(0.001);
    expect(last("to_kidney_R").distanceTo(center("kidney_R"))).toBeLessThan(0.001);
    expect(first("to_bladder_L").distanceTo(center("kidney_L"))).toBeLessThan(0.001);
    expect(first("to_bladder_R").distanceTo(center("kidney_R"))).toBeLessThan(0.001);
    expect(last("to_bladder_L").distanceTo(center("bladder"))).toBeLessThan(0.001);
    expect(last("portal_liver").distanceTo(center("liver"))).toBeLessThan(0.001);
    expect(last("carotid").distanceTo(center("brain"))).toBeLessThan(0.001);
    // A renal artery has to start on the aorta and end at its own kidney, without crossing the far one.
    for (const point of network.route("to_kidney_L").points) expect(point.x).toBeGreaterThan(-0.01);
    for (const point of network.route("to_kidney_R").points) expect(point.x).toBeLessThan(0.05);
  });

  it("rides a trunk only between where it joins and where it leaves", () => {
    const heart = center("heart");
    const kidney = center("kidney_L");
    const path = tracePath(network, ["arch", "descending", "to_kidney_L"], heart, kidney);
    const lowest = path.reduce((a, b) => Math.min(a, b.y), Infinity);
    expect(lowest).toBeGreaterThan(kidney.y - 0.08);
    expect(path[0].distanceTo(heart)).toBeLessThan(1e-6);
    expect(path[path.length - 1].distanceTo(kidney)).toBeLessThan(1e-6);
  });

  it("reaches a branch of the aorta down the aorta, not straight through the chest", () => {
    const heart = center("heart");
    const liver = center("liver");
    const direct = tracePath(network, ["to_liver_art"], heart, liver);
    const aortaBack = network.route("descending").points.reduce((a, b) => Math.min(a, b.z), Infinity);
    expect(direct.reduce((a, b) => Math.min(a, b.z), Infinity)).toBeLessThan(aortaBack + 0.01);
  });

  it("forks where a stop names both sides of a pair", () => {
    const heart = center("heart");
    const anchor = center("kidney_R");
    const strands = traceStrands(network, ["arch", "descending", "to_kidney_L", "to_kidney_R"], heart, anchor);
    expect(strands).toHaveLength(2);
    const [main, side] = strands;
    expect(main.path[main.path.length - 1].distanceTo(anchor)).toBeLessThan(1e-6);
    expect(side.path[side.path.length - 1].distanceTo(center("kidney_L"))).toBeLessThan(1e-3);
    // The side strand only runs from where it parts, and its start lines up with the main strand.
    expect(side.total).toBeLessThan(0.2);
    expect(side.startsAt).toBeGreaterThan(0.1);
    expect(side.path[0].distanceTo(main.path[0])).toBeGreaterThan(0.05);
  });

  it("keeps ureters apart when they start from different kidneys", () => {
    const strands = traceStrands(network, ["to_bladder_L", "to_bladder_R"], center("kidney_R"), center("bladder"));
    expect(strands).toHaveLength(2);
    for (const strand of strands) expect(strand.path.every((p) => Math.abs(p.x) < 0.13)).toBe(true);
    const crossing = strands[1].path.some((p) => p.distanceTo(strands[0].path[0]) < 0.001);
    expect(crossing).toBe(false);
  });

  it("handles a stop with no routes", () => {
    const heart = center("heart");
    const liver = center("liver");
    expect(tracePath(network, [], heart, liver).length).toBeGreaterThan(2);
    expect(tracePath(network, [], null, liver).length).toBe(1);
  });

  it("bows a jump between two stops away from the midline", () => {
    const brain = center("brain");
    const spleen = center("spleen");
    const [arc, ...others] = traceStrands(network, [], spleen, brain);
    expect(others).toHaveLength(0);
    expect(arc.path[0].distanceTo(spleen)).toBeLessThan(1e-6);
    expect(arc.path[arc.path.length - 1].distanceTo(brain)).toBeLessThan(1e-6);
    const straight = spleen.clone().lerp(brain, 0.5);
    const middle = arc.path[Math.floor(arc.path.length / 2)];
    expect(Math.abs(middle.x)).toBeGreaterThan(Math.abs(straight.x));
  });
});
