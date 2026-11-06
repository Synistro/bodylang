import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Process, ProcessStop, processesAt } from "../model/processes";
import { simulate } from "../model/engine/simulate";
import { Scenario, Sex } from "../model/scenario";
import type { OrganMeta } from "./assets";
import { RouteNetwork } from "./routes";
import { PALETTES } from "./materials";
import { ProcessLine } from "./processLine";
import { NO_NUTRIENTS } from "../model/testKit";


function lineFor(sex: Sex) {
  const meta: OrganMeta = JSON.parse(readFileSync(`public/assets/organs-${sex}.json`, "utf8"));
  const point = (name: string) => new THREE.Vector3().fromArray(meta.landmarks[name]);
  const network = new RouteNetwork(meta, new THREE.LineCurve3(point("gastric_impression_of_liver"), point("duodenum_superior")), new THREE.LineCurve3(point("trachea"), point("gastric_impression_of_liver")));
  // A stop anchored anywhere on the body has to work, so this one sits each stop by its number.
  const locate = (stop: ProcessStop, _process: Process, out: THREE.Vector3) => out.set(0, 1.2 + stop.number * 0.03, 0.1);
  const line = new ProcessLine(network, locate, new THREE.Vector2(1000, 800), 2);
  line.setPalette(PALETTES.light);
  return line;
}

const shownPoints = (line: ProcessLine) => {
  const points = line.group.children.find((child) => child instanceof THREE.Points);
  if (!(points instanceof THREE.Points)) throw new Error("The line has no points");
  return points.geometry.drawRange.count;
};

const settle = (line: ProcessLine, process: Process | null) => {
  for (let frame = 0; frame < 40; frame++) line.update(0.05, process, null, true);
};

describe.each<Sex>(["male", "female"])("process lines on the %s body", (sex) => {
  const scenario: Scenario = {
    body: { sex, age: 30, heightCm: 180, weightKg: 80 },
    activities: [{ from: 0, posture: "sleeping" }, { from: 450, posture: "sitting" }],
    substances: [],
    intakes: [
      { ...NO_NUTRIENTS, id: "coffee", label: "Coffee", at: 510, grams: 250, waterMl: 245, caffeineMg: 95 },
      { ...NO_NUTRIENTS, id: "pizza", label: "Pizza", at: 1005, grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4 },
      { ...NO_NUTRIENTS, id: "beer", label: "Beer", at: 1200, grams: 500, waterMl: 460, carbsG: 18, alcoholG: 20 },
    ],
  };
  const trajectory = simulate(scenario);

  it("draws every process at any hour with at most twelve beads", () => {
    const line = lineFor(sex);
    for (const minute of [300, 520, 1020, 1210, 1500]) {
      for (const process of processesAt(trajectory, minute)) {
        settle(line, process);
        expect(line.bounds.isEmpty()).toBe(false);
        expect(shownPoints(line)).toBeLessThanOrEqual(process.stops.length + 12);
      }
    }
    settle(line, null);
    expect(line.group.visible).toBe(false);
  });

  it("shows no beads on a process with nothing moving, and a stop with no organ or route still draws", () => {
    const line = lineFor(sex);
    const stop = (number: number, routes: ProcessStop["routes"], organ: ProcessStop["organ"]): ProcessStop => ({ id: `s${number}`, number, organ, muscle: null, label: "", reading: "", share: 0, state: "ahead", flow: 0, say: "", from: null, routes });
    const still: Process = { id: "still", title: "", system: "overview", substance: "glucose", active: false, headline: "", stops: [stop(1, [], null), stop(2, ["esophagus"], "stomach"), stop(3, [], null)] };
    settle(line, still);
    expect(line.group.visible).toBe(true);
    expect(shownPoints(line)).toBe(3);
  });
});
