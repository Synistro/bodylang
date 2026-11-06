import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { actingAt } from "./model/acting";
import { ORGANS } from "./model/ids";
import { assess } from "./model/assess/assess";
import { dayMoments, processLanes, systemLanes, threadLanes, workedMuscleLanes } from "./model/lanes";
import { readout } from "./model/readout";
import { feelingOrigin, processOrigin, readingOrigin } from "./model/origin";
import { processesAt } from "./model/processes/processes";
import { simulate } from "./model/engine/simulate";
import { SERIES, Trajectory } from "./model/engine/trajectory";
import { forecast } from "./model/forecast";
import { organStates } from "./scene/organStates";
import { whereabouts } from "./model/whereabouts";
import { SYSTEMS } from "./model/systems";
import { SCENARIOS } from "./model/testScenarios";
import { threadsAt } from "./model/threads";

// An added process is meant to add lines, and that must never read as the model having moved.
vi.mock("./model/extensions/index", () => ({ EXTENSIONS: [] }));

const SAMPLE_EVERY_MIN = 30;
const LANES_AT = [12 * 60, 18 * 60];

const hashOf = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex").slice(0, 16);

const hashCurve = (curve: Float32Array) => hashOf(new Uint8Array(curve.buffer, curve.byteOffset, curve.byteLength));

const hashJson = (value: unknown) =>
  hashOf(
    JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Float32Array) return hashCurve(item);
      if (item instanceof Map) return [...item];
      if (item instanceof Set) return [...item];
      if (typeof item === "number" && !Number.isFinite(item)) return String(item);
      return item;
    }),
  );

function curveDigest(tr: Trajectory) {
  const digest: Record<string, string> = {};
  for (const name of SERIES) digest[`series ${name}`] = hashCurve(tr.series[name]);
  for (const [id, curve] of Object.entries(tr.channels)) digest[`channel ${id}`] = hashCurve(curve);
  for (const [id, { ledger, caffeineLedger, flows }] of tr.intakeLedgers) {
    digest[`ledger ${id}`] = hashCurve(ledger);
    digest[`caffeine ledger ${id}`] = hashCurve(caffeineLedger);
    digest[`flows ${id}`] = hashCurve(flows);
  }
  for (const [id, { series, ledger }] of tr.substances) digest[`substance ${id}`] = hashJson([series, ledger]);
  digest.events = hashJson([tr.events, tr.muscleEvents]);
  return digest;
}

function sampleMinutes() {
  const minutes: number[] = [];
  for (let t = 0; t <= 1800; t += SAMPLE_EVERY_MIN) minutes.push(t);
  return minutes;
}

function readerDigest(tr: Trajectory) {
  const minutes = sampleMinutes();
  const across = <T>(read: (t: number) => T) => hashJson(minutes.map(read));
  return {
    assess: across((t) => assess(tr, t)),
    processes: across((t) => processesAt(tr, t)),
    threads: across((t) => threadsAt(tr, t)),
    readout: across((t) => readout(tr, t)),
    "organ states": across((t) => organStates(tr, t)),
    whereabouts: across((t) => whereabouts(tr, t)),
    forecast: across((t) => forecast(tr, t)),
    acting: across((t) => ORGANS.map((organ) => actingAt(tr, t, organ))),
    origins: across((t) => {
      const { readings, feelings } = assess(tr, t);
      return [
        readings.map((reading) => readingOrigin(reading, tr, t)),
        feelings.map(feelingOrigin),
        processesAt(tr, t).map((process) => processOrigin(tr, process)),
      ];
    }),
  };
}

function laneDigest(tr: Trajectory) {
  const digest: Record<string, string> = {};
  for (const now of LANES_AT) {
    digest[`thread lanes ${now}`] = hashJson(threadLanes(tr, now));
    digest[`system lanes ${now}`] = hashJson(SYSTEMS.map(({ id }) => systemLanes(tr, now, id)));
    digest[`process lanes ${now}`] = hashJson(processesAt(tr, now).map(({ id }) => processLanes(tr, now, id)));
    digest[`worked muscle lanes ${now}`] = hashJson(workedMuscleLanes(tr, now));
    digest[`day moments ${now}`] = hashJson(dayMoments(tr, now));
  }
  return digest;
}

// Hashes of everything the model computes across a wide set of days. A failure names what moved. If you meant
// to change the model, regenerate with `vitest -u` and say why in the commit. If you didn't, the change is wrong.
describe("the model's output", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const tr = simulate(scenario);
      expect({ ...curveDigest(tr), ...readerDigest(tr), ...laneDigest(tr) }).toMatchSnapshot();
    });
  }
});
