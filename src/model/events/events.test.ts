import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_SCHEMAS, BodyState, reduce, traceLine } from "../../actions/actions";
import { assess } from "../assess/assess";
import { Assessment } from "../assess/types";
import { heartVerdict } from "../assess/verdicts";
import { BodyEvent } from "./types";
import { channelSeries, curveStrength } from "./curves";
import { maxHeartRate, muscleStateAt } from "./muscles";
import { resolveEvent } from "./presets";
import { MUSCLE_GROUPS } from "../muscleGroups";
import { openingReply, readout } from "../readout";
import { levelWord } from "../words";
import { simulate } from "../engine/simulate";
import { anthropometrics } from "../engine/anthropometrics";
import { Intake, postureAt, Scenario } from "../scenario";
import { Trajectory, value } from "../engine/trajectory";
import { CAFFEINE, ENERGY, FEEL, KIDNEY, MUSCLE_RECOVERY, REFERENCE, TRAINING } from "../params";
import { processesAt, processesFor } from "../processes/processes";
import { SYSTEMS, systemById } from "../systems";
import { threadsAt } from "../threads";
import { hm, NO_NUTRIENTS } from "../testKit";

const toMmol = (mgDl: number) => mgDl / REFERENCE.mgDlPerMmolGlucose;
const body = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80 };
const anthro = anthropometrics(body);

const base: Scenario = { body, activities: [{ from: hm(8), posture: "sitting" }], substances: [], intakes: [], events: [] };
const coffee: Intake = { ...NO_NUTRIENTS, id: "coffee", label: "Coffee", at: hm(8, 30), grams: 250, waterMl: 250, caffeineMg: 95, liquid: true };
const pizza: Intake = { ...NO_NUTRIENTS, id: "pizza", label: "Pizza", at: hm(16, 45), grams: 240, waterMl: 110, carbsG: 72, sugarG: 8, fatG: 26, proteinG: 28, fiberG: 4 };
const water: Intake = { ...NO_NUTRIENTS, id: "water", label: "Water", at: hm(12), grams: 1000, waterMl: 1000, liquid: true };

const blank = { muscles: [], symptoms: [], custom: null, source: "" };
const chestDay: BodyEvent = { ...blank, id: "chest", label: "Chest workout", preset: "training", from: hm(10), until: hm(11), intensity: 0.8, muscles: [{ group: "chest", load: 1 }, { group: "triceps", load: 0.6 }] };
const cold: BodyEvent = { ...blank, id: "cold", label: "Cold", preset: "illness", from: hm(8), until: null, intensity: 0.4, symptoms: ["cough", "congestion"] };
const flu: BodyEvent = { ...blank, id: "flu", label: "Flu", preset: "illness", from: -hm(24), until: null, intensity: 0.7, symptoms: ["cough", "fever", "fatigue"] };
const sex: BodyEvent = { ...blank, id: "sex", label: "Sex", preset: "sex", from: hm(21), until: null, intensity: 0.6 };
const exam: BodyEvent = { ...blank, id: "exam", label: "Exam", preset: "stress", from: hm(14), until: hm(16), intensity: 1 };
const shortNight: BodyEvent = { ...blank, id: "night", label: "Short night", preset: "poor_sleep", from: hm(8), until: null, intensity: 1 };
const sauna: BodyEvent = {
  ...blank,
  id: "sauna",
  label: "Sauna",
  preset: "custom",
  from: hm(18),
  until: hm(18, 20),
  intensity: 1,
  source: "Claude's estimate",
  custom: {
    systems: ["circulation"],
    effects: [
      { channel: "heartRate", amount: 40, riseMin: 10, halfLifeMin: 10 },
      { channel: "temperature", amount: 1, riseMin: 15, halfLifeMin: 20 },
      { channel: "fluidLoss", amount: 15, riseMin: 5, halfLifeMin: 5 },
    ],
    feelings: [{ id: "flushed", label: "Flushed", amount: 0.6, riseMin: 5, halfLifeMin: 20, cause: "Heat is opening your skin vessels", organ: "heart" }],
    stops: [{ organ: "heart", muscle: null, label: "Skin", afterMin: 0, say: "Blood moves to your skin to shed heat.", routes: [] }],
  },
};

const withEvents = (...events: BodyEvent[]) => simulate({ ...base, events });
const addedBy = (tr: Trajectory, plain: Trajectory, name: Parameters<typeof value>[1], t: number) => value(tr, name, t) - value(plain, name, t);
const plain = simulate(base);
const reading = (a: Assessment, id: Assessment["readings"][number]["id"]) => {
  const found = a.readings.find((r) => r.id === id);
  if (!found) throw new Error(`Missing reading ${id}`);
  return found;
};
const words = (text: string) => text.trim().split(/\s+/).length;

describe("the event kernel", () => {
  it("climbs while the event runs and decays by its half-life after", () => {
    const curve = { riseMin: 10, halfLifeMin: 20 };
    expect(curveStrength(curve, 100, 200, 99)).toBe(0);
    expect(curveStrength(curve, 100, 200, 105)).toBeCloseTo(0.5);
    expect(curveStrength(curve, 100, 200, 150)).toBe(1);
    expect(curveStrength(curve, 100, 200, 220)).toBeCloseTo(0.5);
    expect(curveStrength(curve, 100, null, 5000)).toBe(1);
  });

  it("starts an after curve when the event ends", () => {
    const curve = { riseMin: 10, halfLifeMin: 20, after: true };
    expect(curveStrength(curve, 100, 200, 150)).toBe(0);
    expect(curveStrength(curve, 100, 200, 205)).toBeCloseTo(0.5);
    expect(curveStrength(curve, 100, 200, 210)).toBe(1);
    expect(curveStrength(curve, 100, 200, 230)).toBeCloseTo(0.5);
    expect(curveStrength(curve, 100, null, 5000)).toBe(0);
  });

  it("adds channels from every event and shares nothing it writes to", () => {
    const resolved = [cold, exam].map((e) => resolveEvent(e, { body, anthro }));
    const series = channelSeries(resolved, 1801);
    expect(series.heartRate[hm(14, 25)]).toBeGreaterThan(19);
    expect(series.liverOutput[hm(10)]).toBe(0);
    expect(series.muscleFlow).toBe(series.temperature);
    expect(series.heartRate).not.toBe(series.liverOutput);
  });
});

describe("training, against published numbers", () => {
  const tr = withEvents(chestDay);

  it("uses Tanaka's maximum heart rate", () => {
    expect(maxHeartRate(30)).toBeCloseTo(187);
    expect(maxHeartRate(60)).toBeCloseTo(166);
  });

  it("keeps lifting in the light to moderate part of heart rate reserve, about 120 bpm at 0.8", () => {
    const sittingBpm = anthro.restingBpm + 2;
    const reserveAt = (intensity: number) => (value(withEvents({ ...chestDay, intensity }), "hr", hm(10, 30)) - sittingBpm) / (maxHeartRate(30) - sittingBpm);
    expect(reserveAt(0)).toBeCloseTo(TRAINING.heartReserve.atZero, 1);
    expect(reserveAt(1)).toBeCloseTo(TRAINING.heartReserve.atZero + TRAINING.heartReserve.gain, 1);
    expect(value(tr, "hr", hm(10, 30))).toBeCloseTo(120, -0.5);
  });

  it("burns what the Compendium gives for resistance training", () => {
    const metsAt = (intensity: number) => (value(withEvents({ ...chestDay, intensity }), "kcalPerHour", hm(10, 30)) - anthro.bmrKcalPerDay / 24) / body.weightKg + 1;
    expect(metsAt(0)).toBeCloseTo(3.5, 1);
    expect(metsAt(1)).toBeCloseTo(6, 1);
  });

  it("calls 150 bpm expected during training, high at rest, and notes when you near your maximum", () => {
    const during = reading(assess(tr, hm(10, 30)), "hr");
    expect(during.verdict).toBe("expected");
    expect(during.tone).toBe("calm");
    const context = { asleep: false, ownRestBpm: 68, explainedBpm: 0, maxBpm: 187 };
    expect(heartVerdict(150, { ...context, exerting: true }).verdict).toBe("expected");
    expect(heartVerdict(150, { ...context, exerting: false }).verdict).toBe("high");
    expect(heartVerdict(180, { ...context, exerting: true }).word).toBe("Near your maximum");
    expect(heartVerdict(76, { ...context, exerting: false, explainedBpm: 7 }).verdict).toBe("expected");
    expect(heartVerdict(76, { ...context, exerting: false, explainedBpm: 0 }).word).toBe("Slightly raised");
  });

  it("names the session as the reason", () => {
    expect(reading(assess(tr, hm(10, 30)), "hr").why).toMatch(/^About \d+ bpm from the chest workout/);
    expect(assess(tr, hm(10, 30)).headline).toContain("Training your chest and triceps");
  });

  it("brings soreness on late and peaks it in the cited 24 to 72 hours", () => {
    const end = hm(11);
    const soreAt = (h: number) => muscleStateAt([chestDay], "chest", end + h * 60).soreness;
    let peakH = 0;
    for (let h = 0; h <= 240; h++) if (soreAt(h) > soreAt(peakH)) peakH = h;
    expect(peakH).toBeGreaterThanOrEqual(24);
    expect(peakH).toBeLessThanOrEqual(72);
    expect(soreAt(0)).toBe(0);
    expect(soreAt(6) / soreAt(peakH)).toBeLessThan(0.05);
    expect(soreAt(12) / soreAt(peakH)).toBeLessThan(0.2);
    expect(soreAt(24) / soreAt(peakH)).toBeGreaterThan(0.4);
    expect(soreAt(72) / soreAt(peakH)).toBeGreaterThan(0.5);
    expect(soreAt(24 * 7) / soreAt(peakH)).toBeLessThan(0.05);
  });

  it("keeps repair raised on the curve Phillips measured", () => {
    const end = hm(11);
    const repairAt = (h: number) => muscleStateAt([chestDay], "chest", end + h * 60).repair;
    expect(repairAt(24) / repairAt(3)).toBeCloseTo(65 / 112, 1);
    expect(repairAt(48) / repairAt(3)).toBeCloseTo(34 / 112, 1);
  });

  it("recovers strength over the 24 to 48 hours Moran-Navarro reports", () => {
    const fatigueAt = (h: number) => muscleStateAt([chestDay], "chest", hm(11) + h * 60).fatigue;
    expect(fatigueAt(0)).toBeCloseTo(0.8, 1);
    expect(fatigueAt(24) / fatigueAt(0)).toBeLessThan(0.3);
    expect(fatigueAt(48) / fatigueAt(0)).toBeLessThan(0.1);
  });

  it("refills glycogen about as fast as Robergs saw unfed", () => {
    const usedAt = (min: number) => muscleStateAt([chestDay], "chest", hm(11) + min).glycogenUsed;
    const back = 1 - usedAt(120) / usedAt(0);
    expect(back).toBeGreaterThan(14.2 / 46.6 - 0.05);
    expect(back).toBeLessThan(22.2 / 47 + 0.05);
  });

  it("only touches the groups that worked, scaled by load", () => {
    expect(muscleStateAt([chestDay], "quads", hm(10, 30)).work).toBe(0);
    expect(muscleStateAt([chestDay], "chest", hm(10, 30)).work).toBeCloseTo(0.8);
    expect(muscleStateAt([chestDay], "triceps", hm(10, 30)).work).toBeCloseTo(0.48);
  });

  it("reads days beyond the simulated window", () => {
    const yesterday = { ...chestDay, from: -hm(24) + hm(18), until: -hm(24) + hm(19) };
    const today = withEvents(yesterday);
    expect(muscleStateAt([yesterday], "chest", hm(12)).soreness).toBeGreaterThan(0.2);
    const a = assess(today, hm(12));
    expect(a.feelings.map((f) => f.id)).toContain("sore");
    expect(a.systems.muscles.word).toBe("Sore");
    expect(a.feelings.find((f) => f.id === "sore")?.when).toBe("Peaks tomorrow evening");
  });

  it("shares more blood with muscle, sweats within Barnes's range, and warms you", () => {
    expect(value(tr, "flowMuscle", hm(10, 30))).toBeGreaterThan(value(plain, "flowMuscle", hm(10, 30)) + 0.15);
    const litresPerHour = -(value(tr, "fluidBalance", hm(11)) - value(tr, "fluidBalance", hm(10, 30))) * 2 / 1000;
    expect(litresPerHour).toBeGreaterThan(0.3);
    expect(litresPerHour).toBeLessThan(0.83);
    expect(addedBy(tr, plain, "temperature", hm(11))).toBeCloseTo(0.8 * (40 / 40), 0);
  });

  it("lets drinking pay the fluid back", () => {
    const thirsty = value(tr, "fluidBalance", hm(11, 30));
    expect(thirsty).toBeLessThan(-300);
    const drank = simulate({ ...base, events: [chestDay], intakes: [{ ...water, grams: 1500, waterMl: 1500, at: hm(11, 15) }] });
    expect(value(drank, "fluidBalance", hm(13))).toBeGreaterThan(-100);
    expect(value(drank, "fluidBalance", hm(13))).toBeLessThanOrEqual(0);
  });

  it("does not give a fasted lifter low blood sugar, and keeps the afterglow", () => {
    let lowest = Infinity;
    for (let t = hm(10); t <= hm(12); t++) lowest = Math.min(lowest, value(tr, "glucose", t));
    expect(toMmol(lowest)).toBeGreaterThan(3.9);
    const meal = { ...pizza, at: hm(12) };
    const after = simulate({ ...base, intakes: [meal], events: [chestDay] });
    const lazy = simulate({ ...base, intakes: [meal] });
    const area = (s: Trajectory) => s.series.glucose.slice(hm(12), hm(15)).reduce((a, b) => a + (b - 88), 0);
    expect(area(after)).toBeLessThan(area(lazy));
  });

  it("anchors stops on the muscles worked, with here chosen by elapsed time", () => {
    const line = (t: number) => {
      const found = processesAt(tr, t).find((p) => p.id === "event:chest");
      if (!found) throw new Error("No event line");
      return found;
    };
    expect(line(hm(10, 30)).system).toBe("muscles");
    expect(line(hm(10)).stops[0]).toMatchObject({ organ: "muscle", muscle: "chest", state: "here" });
    expect(line(hm(10, 1)).stops[1]).toMatchObject({ muscle: "triceps", state: "here" });
    expect(line(hm(10, 30)).stops.find((s) => s.state === "here")?.label).toBe("Heart");
    expect(line(hm(12, 30)).stops.find((s) => s.state === "here")?.label).toBe("Repair");
    expect(line(hm(24)).stops.find((s) => s.state === "here")?.label).toBe("Soreness");
    expect(line(hm(9)).stops.every((s) => s.state === "ahead")).toBe(true);
    expect(line(hm(9)).headline).toBe("Logged for 10:00");
  });

  it("shows under each system it crosses", () => {
    for (const system of ["muscles", "circulation", "energy"] as const) expect(processesFor(tr, hm(10, 30), system).map((p) => p.id)).toContain("event:chest");
    expect(processesFor(tr, hm(10, 30), "digestion").map((p) => p.id)).not.toContain("event:chest");
  });

  it("gives each muscle group a summary", () => {
    const a = assess(tr, hm(10, 30));
    expect(a.muscles).toHaveLength(MUSCLE_GROUPS.length);
    expect(a.muscles.find((m) => m.group === "chest")).toMatchObject({ status: "Working", label: "Chest" });
    expect(a.muscles.find((m) => m.group === "quads")).toMatchObject({ status: "Rested", level: 0 });
    expect(reading(a, "muscle:chest").verdictWord).toBe("Working");
    expect(reading(a, "muscle:quads").verdict).toBe("normal");
    expect(reading(assess(tr, hm(14)), "muscle:chest").verdictWord).toBe("Tired");
    expect(reading(assess(tr, hm(14)), "muscle:chest").forecast).toBe("Soreness peaks in 2 days");
  });
});

describe("illness, against published numbers", () => {
  const tr = withEvents(flu);

  it("raises heart rate by Karjalainen's 8.5 bpm per degree", () => {
    const degrees = addedBy(tr, plain, "temperature", hm(12));
    const bpm = addedBy(tr, plain, "hr", hm(12));
    expect(degrees).toBeCloseTo(1.4, 1);
    expect(bpm / degrees).toBeCloseTo(8.5, 1);
  });

  it("raises energy use by Manthous's 10% per degree", () => {
    const ratio = value(tr, "kcalPerHour", hm(12)) / value(plain, "kcalPerHour", hm(12));
    expect(ratio).toBeCloseTo(1 + 0.1 * addedBy(tr, plain, "temperature", hm(12)), 2);
  });

  it("lowers insulin action as Yki-Jarvinen measured", () => {
    const worst = resolveEvent({ ...flu, intensity: 1 }, { body, anthro });
    expect(worst.effects.find((e) => e.channel === "insulinSensitivity")?.amount).toBeCloseTo(-0.52);
    const meal = { ...pizza, at: hm(12) };
    const sick = simulate({ ...base, intakes: [meal], events: [flu] });
    const well = simulate({ ...base, intakes: [meal] });
    const peak = (s: Trajectory) => Math.max(...s.series.glucose.slice(hm(12), hm(16)));
    expect(peak(sick)).toBeGreaterThan(peak(well));
  });

  it("names the fever as the reason and calls a fever a fever", () => {
    const a = assess(tr, hm(16));
    const temperature = reading(a, "temperature");
    expect(temperature.value).toBeGreaterThanOrEqual(38);
    expect(temperature.verdictWord).toBe("Fever");
    expect(temperature.why).toBe("Your immune system turned up your temperature");
    expect(reading(a, "hr").why).toMatch(/^About 12 bpm from the fever/);
    expect(reading(a, "inflammation").why).toBe("Raised by the flu");
    expect(reading(a, "immune").why).toBe("Working against the flu");
    expect(reading(a, "inflammation").tone).toBe("calm");
    expect(a.notable[0].text).toBe("You have a fever. Your immune system turned up your temperature.");
    expect(a.headline).not.toContain("Nothing is out of range");
    expect(a.systems.immune.word).toMatch(/^Fever 3\d\.\d$/);
  });

  it("gives a plain cold no fever, as MedlinePlus describes", () => {
    const sniffles = withEvents(cold);
    expect(addedBy(sniffles, plain, "temperature", hm(14))).toBe(0);
    expect(addedBy(sniffles, plain, "hr", hm(14))).toBeLessThan(3);
    const a = assess(sniffles, hm(14));
    expect(reading(a, "temperature").verdict).toBe("normal");
    expect(a.feelings.map((f) => f.id)).toEqual(expect.arrayContaining(["coughing", "stuffy"]));
    expect(a.systems.immune).toMatchObject({ word: "Fighting it", quiet: false });
    expect(a.headline).toContain("Fighting the cold");
  });

  it("tells the illness as a line, with the cough branching off the airways", () => {
    const line = processesAt(tr, hm(12)).find((p) => p.id === "event:flu");
    expect(line?.stops.map((s) => s.label)).toEqual(["Airways", "Immune system", "Brain", "Cough reflex"]);
    expect(line?.stops.find((s) => s.label === "Cough reflex")).toMatchObject({ organ: "muscle", muscle: "abs", from: "stop-0", state: "ahead", reading: "Active" });
    expect(line?.stops.find((s) => s.label === "Airways")?.reading).toBe("Irritated");
    expect(line?.stops.find((s) => s.label === "Immune system")?.reading).toBe("Responding");
    expect(line?.stops.find((s) => s.label === "Brain")).toMatchObject({ state: "here", reading: "+1.4 °C" });
    expect(line?.stops.every((s) => s.state !== "passed")).toBe(true);
    expect(line?.stops.every((s) => s.routes.length === 0)).toBe(true);
    expect(line?.system).toBe("immune");
    expect(line?.headline).not.toBe(assess(tr, hm(12)).systems.immune.sentence);
  });

  it("leaves out the brain stop when there is no fever, and the cough when there is none", () => {
    expect(processesAt(withEvents(cold), hm(14)).find((p) => p.id === "event:cold")?.stops.map((s) => s.label)).toEqual(["Airways", "Immune system", "Cough reflex"]);
    expect(processesAt(withEvents({ ...cold, symptoms: [] }), hm(14)).find((p) => p.id === "event:cold")?.stops.map((s) => s.label)).toEqual(["Airways", "Immune system"]);
  });

  it("stays active while until is null and fades once it ends", () => {
    expect(processesAt(tr, hm(29)).find((p) => p.id === "event:flu")?.active).toBe(true);
    expect(threadsAt(tr, hm(29)).find((t) => t.id === "event:flu")?.status).toBe("fighting it");
    const ended = withEvents({ ...flu, until: hm(9) });
    expect(threadsAt(ended, hm(12)).find((t) => t.id === "event:flu")?.status).toBe("recovering");
    expect(value(ended, "temperature", hm(20))).toBeLessThan(value(tr, "temperature", hm(20)) - 0.5);
  });

  it("dulls hunger and raises drowsiness", () => {
    expect(value(tr, "hunger", hm(12))).toBeLessThan(value(plain, "hunger", hm(12)) * 0.75);
    expect(value(tr, "drowsy", hm(12))).toBeGreaterThan(value(plain, "drowsy", hm(12)) + 0.2);
    expect(value(tr, "alertness", hm(12))).toBeLessThan(value(plain, "alertness", hm(12)) - 0.1);
  });
});

describe("sex, against published numbers", () => {
  const tr = withEvents(sex);
  const atPeak = hm(21, 24);

  it("stays under the AHA's 130 bpm and 170 mmHg", () => {
    const hardest = withEvents({ ...sex, intensity: 1 });
    expect(value(hardest, "hr", atPeak)).toBeLessThanOrEqual(131);
    expect(value(hardest, "systolic", atPeak)).toBeLessThanOrEqual(171);
    expect(value(tr, "hr", atPeak)).toBeGreaterThan(95);
    expect(reading(assess(tr, atPeak), "hr").verdict).toBe("expected");
    expect(reading(assess(tr, atPeak), "temperature").verdict).toBe("normal");
    expect(assess(tr, atPeak).headline).toContain("Sexual activity under way");
    expect(assess(tr, hm(21, 40)).headline).toContain("Recovering after sexual activity");
  });

  it("burns what Frappier measured in each sex", () => {
    const kcalPerMin = (trajectory: Trajectory) => value(trajectory, "kcalPerHour", hm(21, 15)) / 60;
    expect(kcalPerMin(tr)).toBeCloseTo(4.2, 1);
    const her = simulate({ ...base, body: { sex: "female", age: 30, heightCm: 165, weightKg: 62 }, events: [sex] });
    expect(kcalPerMin(her)).toBeCloseTo(3.1, 1);
  });

  it("returns close to baseline quickly, as Bohlen saw", () => {
    const after = hm(21, 25) + 15;
    expect(addedBy(tr, plain, "hr", after)).toBeLessThan(2);
    expect(addedBy(tr, plain, "systolic", after)).toBeLessThan(2);
  });

  it("keeps the hormones raised for an hour and cortisol-free, as Kruger reports", () => {
    expect(value(tr, "reward", hm(21, 25) + 60)).toBeGreaterThan(value(tr, "reward", hm(21, 25)) * 0.45);
    expect(value(tr, "stressLevel", hm(21, 25) + 30)).toBeLessThan(0.01);
    expect(addedBy(tr, plain, "drowsy", hm(21, 25) + 15)).toBeGreaterThan(0.1);
    expect(assess(tr, hm(21, 40)).feelings.map((f) => f.id)).toContain("relaxed");
  });

  it("keeps every string clinical, whatever the person called it", () => {
    const named = withEvents({ ...sex, label: "Hot night with my wife" });
    const line = processesAt(named, atPeak).find((p) => p.id === "event:sex");
    const thread = threadsAt(named, atPeak).find((t) => t.id === "event:sex");
    expect(line?.title).toBe("Sexual activity");
    expect(thread?.title).toBe("Sexual activity");
    const a = assess(named, hm(21, 40));
    const strings = [line?.headline ?? "", ...(line?.stops.flatMap((s) => [s.label, s.say, s.reading]) ?? []), thread?.status ?? "", a.headline, ...a.feelings.flatMap((f) => [f.label, f.cause]), ...a.readings.map((r) => r.why)];
    expect(strings.join(" ")).not.toMatch(/\b(hot|wife|sexy|fun|great|nice|pleasure|intercourse|naked)\b/i);
  });
});

describe("stress, against published numbers", () => {
  const tr = withEvents(exam);

  it("raises heart rate and pressure as Wiesli measured, then settles to half after 30 minutes", () => {
    expect(addedBy(tr, plain, "hr", hm(14, 25))).toBeCloseTo(19, 0);
    expect(addedBy(tr, plain, "systolic", hm(14, 25))).toBeCloseTo(30, 0);
    const half = withEvents({ ...exam, intensity: 0.5 });
    expect(addedBy(half, plain, "hr", hm(14, 25))).toBeCloseTo(9.5, 0);
    expect(addedBy(tr, plain, "hr", hm(15, 45))).toBeGreaterThan(19 * 0.45);
    expect(addedBy(tr, plain, "hr", hm(15, 45))).toBeLessThan(19 * 0.6);
  });

  it("barely moves fasting sugar, as Wiesli saw", () => {
    expect(toMmol(addedBy(tr, plain, "glucose", hm(15, 30)))).toBeLessThan(0.6);
    expect(toMmol(addedBy(tr, plain, "glucose", hm(15, 30)))).toBeGreaterThan(0);
  });

  it("leaves insulin sensitivity alone, as Seematter reports for healthy people", () => {
    expect(resolveEvent(exam, { body, anthro }).effects.some((e) => e.channel === "insulinSensitivity")).toBe(false);
  });

  it("slows the stomach and takes blood from the gut", () => {
    const meal = { ...pizza, at: hm(14) };
    const tense = simulate({ ...base, intakes: [meal], events: [exam] });
    const calm = simulate({ ...base, intakes: [meal] });
    expect(value(tense, "stomachKcal", hm(16))).toBeGreaterThan(value(calm, "stomachKcal", hm(16)) * 1.05);
    expect(value(tense, "flowGut", hm(16))).toBeLessThan(value(calm, "flowGut", hm(16)));
  });

  it("names stress as the cause", () => {
    const a = assess(tr, hm(15));
    expect(reading(a, "hr").why).toMatch(/^About \d+ bpm from the exam/);
    expect(reading(a, "hr").verdict).toBe("expected");
    expect(reading(a, "bloodPressure").why).toMatch(/^About \d+ mmHg from the exam$/);
    expect(reading(a, "stressLevel").why).toBe("Raised by the exam");
    expect(reading(a, "stressLevel").display).toBe("Strong");
    expect(reading(a, "stressLevel").unit).toBe("");
    expect(reading(a, "stressLevel").tone).toBe("calm");
    expect(a.systems.brain.word).toBe("Stressed");
    expect(a.feelings.map((f) => f.id)).toContain("tense");
  });

  it("wakes you up", () => {
    expect(value(tr, "alertness", hm(14, 25))).toBeGreaterThan(value(plain, "alertness", hm(14, 25)) + 0.1);
  });

  it("calls plain stress stress, with no article", () => {
    const stressed = withEvents({ ...exam, id: "stress", label: "Stress", until: null });
    const a = assess(stressed, hm(14, 20));
    expect(reading(a, "stressLevel").why).toBe("Raised by stress");
    expect(reading(a, "hr").why).toMatch(/from stress$/);
  });
});

describe("a short night, against published numbers", () => {
  const tr = withEvents(shortNight);

  it("takes a quarter off insulin action as Donga measured, leaving basal liver output alone", () => {
    const effects = resolveEvent(shortNight, { body, anthro }).effects;
    expect(effects.find((e) => e.channel === "insulinSensitivity")?.amount).toBeCloseTo(-0.25);
    expect(effects.some((e) => e.channel === "liverOutput")).toBe(false);
  });

  it("raises a meal's sugar", () => {
    const meal = { ...pizza, at: hm(12) };
    const short = simulate({ ...base, intakes: [meal], events: [shortNight] });
    const rested = simulate({ ...base, intakes: [meal] });
    const area = (s: Trajectory) => s.series.glucose.slice(hm(12), hm(16)).reduce((a, b) => a + (b - 88), 0);
    expect(area(short)).toBeGreaterThan(area(rested) * 1.05);
  });

  it("raises hunger by Spiegel's 24%", () => {
    const ratio = value(tr, "hunger", hm(9)) / value(plain, "hunger", hm(9));
    expect(ratio).toBeCloseTo(1.24, 1);
  });

  it("makes you drowsy and lasts until bedtime without until", () => {
    expect(value(tr, "alertness", hm(10))).toBeLessThan(value(plain, "alertness", hm(10)) - 0.15);
    expect(resolveEvent(shortNight, { body, anthro }).ends).toBe(hm(23, 30));
    const a = assess(tr, hm(10));
    expect(a.feelings.find((f) => f.id === "tired")?.cause).toBe("You slept short last night");
    expect(a.feelings.find((f) => f.id === "sleepy")?.cause).toBe("From short sleep");
    expect(a.headline).toContain("Short on sleep");
  });
});

describe("a custom story", () => {
  const tr = withEvents(sauna);

  it("is marked as an estimate and moves the model", () => {
    expect(tr.events[0].evidence).toBe("C");
    expect(tr.events[0].source).toBe("Claude's estimate");
    expect(addedBy(tr, plain, "hr", hm(18, 15))).toBeCloseTo(40, 0);
    expect(value(tr, "fluidBalance", hm(18, 20))).toBeLessThan(-150);
  });

  it("reads like everything else", () => {
    const a = assess(tr, hm(18, 15));
    expect(reading(a, "hr").why).toBe("About 40 bpm from sauna");
    expect(a.feelings.map((f) => f.id)).toContain("flushed");
    expect(a.headline).toContain("Dealing with sauna");
    const line = processesAt(tr, hm(18, 5)).find((p) => p.id === "event:sauna");
    expect(line?.headline).toBe("Claude's estimate, still going on");
    expect(line?.stops[0].state).toBe("here");
  });

  it("is refused without a story", () => {
    expect(() => resolveEvent({ ...sauna, custom: null }, { body, anthro })).toThrow(/no story/);
  });
});

describe("the walking fix", () => {
  const walkFrom = (from: number, posture: "walking" | "running", until: number): Scenario["activities"] => [{ from: hm(8), posture: "sitting" }, { from, posture }, { from: until, posture: "sitting" }];

  it("keeps a fasted walk well above low sugar", () => {
    const tr = simulate({ ...base, activities: walkFrom(hm(12), "walking", hm(13)) });
    let lowest = Infinity;
    for (let t = hm(12); t <= hm(14); t++) lowest = Math.min(lowest, value(tr, "glucose", t));
    expect(toMmol(lowest)).toBeGreaterThan(4.5);
    const a = assess(tr, hm(12, 30));
    expect(a.notable.map((n) => n.reading)).not.toContain("glucose");
    expect(a.feelings.map((f) => f.id)).not.toContain("low");
  });

  it("keeps a fasted hour's run above low sugar, and spends the liver to do it", () => {
    const tr = simulate({ ...base, activities: walkFrom(hm(12), "running", hm(13)) });
    let lowest = Infinity;
    for (let t = hm(12); t <= hm(14); t++) lowest = Math.min(lowest, value(tr, "glucose", t));
    expect(toMmol(lowest)).toBeGreaterThan(3.9);
    expect(value(tr, "liverGlycogen", hm(13))).toBeLessThan(value(plain, "liverGlycogen", hm(13)) - 10);
  });

  it("still lowers a meal's peak without driving sugar low", () => {
    const meal = { ...pizza, at: hm(13) };
    const sat = simulate({ ...base, intakes: [meal] });
    const walked = simulate({ ...base, intakes: [meal], activities: walkFrom(hm(13, 10), "walking", hm(13, 40)) });
    const peak = (tr: Trajectory) => Math.max(...tr.series.glucose.slice(hm(13), hm(16)));
    const lowest = Math.min(...walked.series.glucose.slice(hm(13), hm(17)));
    expect(peak(walked)).toBeLessThan(peak(sat));
    expect(toMmol(lowest)).toBeGreaterThan(4.3);
  });
});

describe("caffeine has two separate scales", () => {
  const cups = (n: number) => simulate({ ...base, intakes: [{ ...coffee, caffeineMg: 95 * n }] });
  const peakOf = (tr: Trajectory, name: Parameters<typeof value>[1]) => Math.max(...tr.series[name]);

  it("reads receptors blocked from Elmenhorst's PET figure", () => {
    expect(CAFFEINE.receptorA1Ic50Um).toBe(67);
    expect(13 * CAFFEINE.molarMgPerLToUm / (13 * CAFFEINE.molarMgPerLToUm + CAFFEINE.receptorA1Ic50Um)).toBeCloseTo(0.5, 2);
    const day = simulate({ ...base, intakes: [coffee] });
    expect(value(day, "occupancy", hm(17))).toBeCloseTo(0.043, 2);
    expect(reading(assess(day, hm(17)), "receptors").source).toContain("A1");
    expect(reading(assess(day, hm(17)), "receptors").source).toContain("PET");
  });

  it("makes one or two cups feel like one or two cups", () => {
    const oneCup = peakOf(cups(1), "caffeineFelt");
    const twoCups = peakOf(cups(2), "caffeineFelt");
    expect(oneCup).toBeGreaterThan(0.35);
    expect(twoCups).toBeGreaterThan(oneCup + 0.1);
    expect(peakOf(cups(1), "jitter")).toBe(0);
    expect(peakOf(cups(2), "jitter")).toBeLessThan(0.1);
    expect(peakOf(cups(5), "jitter")).toBeGreaterThan(0.3);
    expect(peakOf(cups(1), "alertness")).toBeGreaterThan(peakOf(plain, "alertness") + 0.1);
  });

  it("keeps one cup well under half of receptors, and calls it working long after", () => {
    expect(peakOf(cups(1), "occupancy")).toBeLessThan(0.15);
    expect(processesAt(simulate({ ...base, intakes: [coffee] }), hm(17)).find((p) => p.id === "intake:coffee")?.active).toBe(true);
  });
});

describe("the fixed quirks", () => {
  it("wakes moderately hungry and builds through a morning with no food", () => {
    expect(value(plain, "hunger", hm(8, 5))).toBeLessThan(0.45);
    expect(value(plain, "hunger", hm(12, 30))).toBeGreaterThan(0.8);
    expect(Math.max(...plain.series.hunger)).toBeCloseTo(FEEL.hungerPlateau, 2);
    expect(assess(plain, hm(8, 5)).feelings.find((f) => f.id === "hungry")?.word).not.toBe("Strong");
    expect(value(plain, "hunger", hm(6))).toBe(0);
  });

  it("eases digestion in, with no jump the moment food is logged", () => {
    const fed = simulate({ ...base, intakes: [pizza] });
    const before = value(fed, "hr", pizza.at - 1);
    const extra = (t: number) => value(fed, "hr", t) - before;
    expect(extra(pizza.at + 1)).toBeLessThan(1.5);
    expect(extra(pizza.at + 15)).toBeGreaterThan(2);
    for (let t = pizza.at; t < pizza.at + 60; t++) expect(value(fed, "hr", t + 1) - value(fed, "hr", t)).toBeLessThan(1);
  });

  it("slows the kidneys overnight", () => {
    const asleep = (value(plain, "bladderMl", hm(7, 50)) - value(plain, "bladderMl", hm(1))) / (hm(7, 50) - hm(1));
    const awake = (value(plain, "bladderMl", hm(10)) - value(plain, "bladderMl", hm(9))) / 60;
    expect(asleep / awake).toBeCloseTo(KIDNEY.sleepingUrineFactor, 1);
    expect(value(plain, "bladderMl", hm(7, 50))).toBeLessThan(KIDNEY.voidAtMl);
    expect(reading(assess(plain, hm(6)), "bladder").verdict).toBe("normal");
  });

  it("goes to bed at 23:30 and lets sleep pressure fall", () => {
    expect(postureAt(base.activities, hm(23, 29))).toBe("sitting");
    expect(postureAt(base.activities, hm(23, 30))).toBe("sleeping");
    expect(value(plain, "sleepPressure", hm(23, 29))).toBeGreaterThan(0.25);
    expect(value(plain, "sleepPressure", hm(29))).toBeLessThan(value(plain, "sleepPressure", hm(23, 29)) * 0.3);
    expect(assess(plain, hm(24)).headline).toContain("Asleep");
  });

  it("lets someone stay up by saying so", () => {
    const up: Scenario["activities"] = [{ from: hm(8), posture: "sitting" }, { from: hm(24, 30), posture: "standing" }];
    expect(postureAt(up, hm(24))).toBe("sleeping");
    expect(postureAt(up, hm(24, 40))).toBe("standing");
  });

  it("only feels low when sugar is actually low", () => {
    const fed = simulate({ ...base, intakes: [pizza] });
    for (let t = hm(6); t <= hm(26); t += 5) {
      if (toMmol(value(fed, "glucose", t)) >= 4) expect(value(fed, "crash", t)).toBe(0);
    }
  });
});

describe("the rail", () => {
  it("lists nine systems in order, with the agreed titles", () => {
    expect(SYSTEMS.map((s) => s.title)).toEqual(["Overview", "Digestion", "Sugar & energy", "Heart & lungs", "Muscles", "Brain & mood", "Illness & recovery", "Liver & kidneys", "Reproductive"]);
    expect(systemById("clearing").title).toBe("Liver & kidneys");
    expect([...systemById("muscles").readings, ...systemById("muscles").more]).toHaveLength(MUSCLE_GROUPS.length);
    expect(systemById("immune").readings).toContain("temperature");
    expect(systemById("circulation").readings).toEqual(["hr", "bloodPressure", "breaths", "flowGut"]);
    for (const system of SYSTEMS) expect(system.readings.length).toBeLessThanOrEqual(4);
  });

  it("marks quiet systems so nothing has to compare words", () => {
    const rest = assess(plain, hm(7));
    for (const system of ["digestion", "muscles", "immune", "clearing"] as const) expect(rest.systems[system].quiet).toBe(true);
    const busy = assess(withEvents(chestDay), hm(10, 30));
    expect(busy.systems.muscles).toMatchObject({ word: "Working", quiet: false });
    expect(busy.systems.circulation).toMatchObject({ word: "Working", quiet: false });
    expect(busy.systems.overview).toMatchObject({ word: "Training", quiet: false });
  });

  it("never lets the headline repeat the first notable item", () => {
    const scenarios = [withEvents(flu), withEvents(chestDay), simulate({ ...base, intakes: [pizza, coffee] }), simulate({ ...base, intakes: [0, 1, 2, 3].map((n) => ({ ...NO_NUTRIENTS, id: `beer_${n}`, label: "Beer", at: hm(19) + n * 10, grams: 500, waterMl: 460, alcoholG: 20, liquid: true })) })];
    for (const tr of scenarios) {
      for (let t = hm(8); t <= hm(23); t += 10) {
        const a = assess(tr, t);
        const outOfRange = a.readings.some((r) => r.verdict !== "expected" && r.verdict !== "normal" && (r.value < r.scale.typicalLow || r.value > r.scale.typicalHigh));
        if (outOfRange) expect(a.headline).not.toContain("Nothing is out of range");
        if (!a.notable.length) continue;
        const subject = a.notable[0].text.split(" is ")[0].toLowerCase();
        expect(a.headline.toLowerCase()).not.toContain(subject);
      }
    }
  });
});

describe("threads", () => {
  it("shows the design's second example", () => {
    const morning = { ...chestDay, from: hm(8), until: hm(9) };
    const tr = withEvents(morning, cold);
    const threads = threadsAt(tr, hm(14));
    expect(threads.map((t) => t.id).sort()).toEqual(["event:chest", "event:cold"]);
    expect(threads.find((t) => t.id === "event:cold")).toMatchObject({ title: "Cold", kind: "illness", status: "fighting it", active: true, processId: "event:cold" });
    expect(threads.find((t) => t.id === "event:chest")).toMatchObject({ title: "Chest workout", kind: "training", status: "repairing", active: true });
    expect(threads[0].id).toBe("event:cold");
  });

  it("follows food and drink by where they are", () => {
    const tr = simulate({ ...base, intakes: [coffee, pizza] });
    const at = (id: string, t: number) => threadsAt(tr, t).find((x) => x.id === id);
    expect(at("intake:pizza", hm(17))).toMatchObject({ title: "Ate pizza", kind: "food", status: "in stomach", since: "15 min ago", active: true });
    expect(at("intake:coffee", hm(17))).toMatchObject({ title: "Drank coffee", kind: "drink", status: "fading", since: "9 h ago" });
    expect(at("intake:coffee", hm(8, 35))?.status).toBe("absorbing");
    expect(at("intake:coffee", hm(9, 15))?.status).toBe("working");
    expect(at("intake:pizza", hm(12))).toMatchObject({ status: "later", since: "at 16:45", active: false });
    expect(at("intake:pizza", hm(29))?.status).toBe("digested");
  });

  it("puts illness first, then what needs attention, then the most recent", () => {
    const tr = simulate({ ...base, intakes: [coffee, pizza], events: [cold] });
    expect(threadsAt(tr, hm(17)).map((t) => t.id)).toEqual(["event:cold", "intake:pizza", "intake:coffee"]);
    const tense = simulate({ ...base, intakes: [coffee, { ...pizza, at: hm(14, 10) }], events: [exam] });
    expect(threadsAt(tense, hm(14, 20)).map((t) => t.id)).toEqual(["event:exam", "intake:pizza", "intake:coffee"]);
  });

  it("merges a sitting into one thread with a plain title", () => {
    const bar: Intake = { ...NO_NUTRIENTS, id: "bar", label: "Sugar bar", at: pizza.at - 5, grams: 50, waterMl: 3, carbsG: 31, sugarG: 27, fatG: 12, proteinG: 4, fiberG: 1 };
    const threads = threadsAt(simulate({ ...base, intakes: [bar, pizza] }), hm(17));
    expect(threads.map((t) => t.id)).toEqual(["meal:bar"]);
    expect(threads[0]).toMatchObject({ title: "Ate sugar bar and pizza", processId: "meal:bar", kind: "food" });
  });

  it("gives alcohol and pills their own lines, and plain water none", () => {
    const ibuprofen = { id: "ibuprofen", label: "Ibuprofen", at: hm(13), doseMg: 400, tmaxMin: 90, halfLifeH: 2, volumeLPerKg: 0.15, bioavailability: 0.9, targets: [{ organ: "brain" as const, effect: "blocks the signal that makes pain" }], source: "test" };
    const beer = { ...NO_NUTRIENTS, id: "beer", label: "Beer", at: hm(13), grams: 500, waterMl: 460, carbsG: 18, alcoholG: 20, liquid: true };
    const tr = simulate({ ...base, intakes: [beer, water], substances: [ibuprofen] });
    const threads = threadsAt(tr, hm(14));
    expect(threads.find((t) => t.id === "intake:beer")?.processId).toBe("alcohol:beer");
    expect(threads.find((t) => t.id === "substance:ibuprofen")).toMatchObject({ kind: "substance", processId: "substance:ibuprofen" });
    expect(threads.find((t) => t.id === "intake:water")).toBeUndefined();
  });
});

describe("the tools", () => {
  const state: BodyState = { body, intakes: [], activities: base.activities, substances: [], events: [], cycle: null, now: hm(12), system: "overview", process: null, focus: null, focusMuscle: null, whatIf: null, assumptions: {} };
  const args = { id: "cold", label: "Cold", preset: "illness", from: hm(8), until: null, intensity: 0.4, muscles: [], symptoms: ["cough"], source: "", custom: null };

  it("passes a food's fructose share through, and leaves fibre out of the energy it traces", () => {
    const apples = { id: "apples", label: "Two apples", at: hm(9), grams: 364, water_ml: 310, carbs_g: 50, sugar_g: 38, fat_g: 0, protein_g: 0, fiber_g: 9, caffeine_mg: 0, alcohol_g: 0, liquid: false, fructose_share: 0.6, assumption: "Two medium apples" };
    const parsed = ACTION_SCHEMAS.log_intake.parse(apples);
    expect(reduce(state, { name: "log_intake", args: parsed }).intakes[0].fructoseShare).toBe(0.6);
    expect(traceLine({ name: "log_intake", args: parsed })).toContain("164 kcal");
    const { fructose_share: _unused, ...plainFood } = apples;
    expect(reduce(state, { name: "log_intake", args: ACTION_SCHEMAS.log_intake.parse(plainFood) }).intakes[0].fructoseShare).toBeUndefined();
  });

  it("hides a line when the food it follows is removed", () => {
    const showing: BodyState = { ...state, process: "meal:bar", intakes: [{ ...pizza, id: "bar" }] };
    expect(reduce(showing, { name: "remove_intake", args: { id: "bar" } }).process).toBeNull();
  });

  it("logs and ends an event through the reducer", () => {
    const logged = reduce(state, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse(args) });
    expect(logged.events).toHaveLength(1);
    expect(logged.events[0]).toMatchObject({ id: "cold", until: null, symptoms: ["cough"] });
    const ended = reduce(logged, { name: "end_event", args: ACTION_SCHEMAS.end_event.parse({ id: "cold", at: hm(13) }) });
    expect(ended.events[0].until).toBe(hm(13));
    const replaced = reduce(logged, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, intensity: 0.9 }) });
    expect(replaced.events).toHaveLength(1);
    expect(replaced.events[0].intensity).toBe(0.9);
  });

  it("stores and traces the clinical label, whatever Claude typed", () => {
    const typed = ACTION_SCHEMAS.log_event.parse({ ...args, id: "s", label: "Hot night", preset: "sex", symptoms: [] });
    expect(reduce(state, { name: "log_event", args: typed }).events[0].label).toBe("Sexual activity");
    expect(traceLine({ name: "log_event", args: typed })).not.toContain("Hot");
  });

  it("tells Claude which ids exist when one is wrong", () => {
    expect(() => reduce(state, { name: "end_event", args: { id: "nope", at: 10 } })).toThrow(/Known ids: none/);
  });

  it("validates per preset, naming what to fix", () => {
    const parse = (patch: object) => ACTION_SCHEMAS.log_event.safeParse({ ...args, ...patch });
    expect(parse({}).success).toBe(true);
    expect(parse({ preset: "training", symptoms: [] }).success).toBe(false);
    expect(parse({ preset: "training", symptoms: [], muscles: [{ group: "chest", load: 1 }] }).success).toBe(true);
    expect(parse({ preset: "stress" }).success).toBe(false);
    expect(parse({ from: hm(9), until: hm(8) }).success).toBe(false);
    expect(parse({ preset: "custom", symptoms: [] }).success).toBe(false);
    expect(parse({ custom: { systems: ["immune"], effects: [], feelings: [], stops: [] } }).success).toBe(false);
    const failed = parse({ preset: "training", symptoms: [] });
    if (failed.success) throw new Error("Should have failed");
    expect(failed.error.issues[0].path).toEqual(["muscles"]);
  });

  it("accepts days before today, and keeps a custom story's words short", () => {
    const story = { systems: ["circulation"], effects: [{ channel: "heartRate", amount: 40, rise_min: 10, half_life_min: 10 }], feelings: [], stops: [{ organ: "heart", muscle: null, label: "Skin", after_min: 0, say: "Blood moves to your skin.", routes: [] }] };
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, from: -hm(48) }).success).toBe(true);
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, preset: "custom", symptoms: [], custom: story }).success).toBe(true);
    const tooLong = { ...story, stops: [{ ...story.stops[0], say: "word ".repeat(26) }] };
    expect(ACTION_SCHEMAS.log_event.safeParse({ ...args, preset: "custom", symptoms: [], custom: tooLong }).success).toBe(false);
  });

  it("turns a custom story into the model's own shape", () => {
    const story = { systems: ["circulation"], effects: [{ channel: "heartRate", amount: 40, rise_min: 10, half_life_min: 10 }], feelings: [], stops: [{ organ: "heart", muscle: null, label: "Skin", after_min: 3, say: "Blood moves to your skin.", routes: ["arch"] }] };
    const logged = reduce(state, { name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, preset: "custom", symptoms: [], custom: story }) });
    expect(logged.events[0].custom?.effects[0]).toMatchObject({ riseMin: 10, halfLifeMin: 10 });
    expect(logged.events[0].custom?.stops[0]).toMatchObject({ afterMin: 3, routes: ["arch"] });
  });

  it("traces events in one readable line, even from yesterday", () => {
    expect(traceLine({ name: "log_event", args: ACTION_SCHEMAS.log_event.parse({ ...args, from: -360 }) })).toBe("log_event Cold, illness, 18:00, ongoing");
    expect(traceLine({ name: "end_event", args: { id: "cold", at: hm(13) } })).toBe("end_event cold, 13:00");
  });

  it("hands the SDK schemas it can convert for Claude", () => {
    for (const schema of [ACTION_SCHEMAS.log_event, ACTION_SCHEMAS.end_event]) {
      const json = z.toJSONSchema(z.object(schema.shape));
      expect(JSON.stringify(json)).toContain("properties");
    }
    expect(Object.keys(ACTION_SCHEMAS.log_event.shape)).toEqual(["id", "label", "preset", "from", "until", "intensity", "muscles", "symptoms", "source", "custom"]);
  });

  it("opens with one short caption, with no lead-in and at most two sentences", () => {
    const day = simulate({ ...base, intakes: [coffee, { ...pizza }, { ...NO_NUTRIENTS, id: "bar", label: "Sugar bar", at: pizza.at, grams: 50, waterMl: 3, carbsG: 31, sugarG: 27, fatG: 12, proteinG: 4, fiberG: 1 }] });
    const lines = openingReply(day, hm(17));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty("head");
    expect(lines[0].text.match(/[.!?](\s|$)/g)?.length).toBeLessThanOrEqual(2);
    expect(words(lines[0].text)).toBeLessThan(30);
    expect(lines[0].text).toMatch(/^The meal is mostly still in your stomach and your coffee is fading\./);
    expect(lines[0].text).not.toMatch(/\*\*/);
  });

  it("gives Claude events, threads and the new numbers", () => {
    const tr = withEvents(flu, { ...chestDay, from: hm(8), until: hm(9) });
    const r = readout(tr, hm(12));
    expect(r.events.map((e) => e.id)).toEqual(["flu", "chest"]);
    expect(r.threads.map((t) => t.id)).toContain("event:flu");
    expect(r.processes.map((p) => p.id)).toContain("event:chest");
    expect(r.blood.temperature_c).toBeGreaterThan(37.5);
    expect(["moderate", "strong"]).toContain(r.blood.immune_activity);
    expect(r.blood.inflammation).toBe(levelWord(value(tr, "inflammation", hm(12))).toLowerCase());
    expect(Object.keys(r.muscles)).toEqual(expect.arrayContaining(["chest", "triceps"]));
    expect(JSON.stringify(r)).not.toMatch(/NaN|null,"until"/);
  });
});

describe("determinism", () => {
  const everything: Scenario = { ...base, intakes: [coffee, pizza], events: [chestDay, flu, exam, shortNight, sex, sauna] };

  it("gives identical curves and strings for the same input, every time", () => {
    const a = simulate(everything);
    const b = simulate(everything);
    for (const key of Object.keys(a.series) as (keyof typeof a.series)[]) expect(b.series[key]).toEqual(a.series[key]);
    expect(JSON.stringify(assess(b, hm(17)))).toBe(JSON.stringify(assess(a, hm(17))));
    expect(JSON.stringify(processesAt(b, hm(17)))).toBe(JSON.stringify(processesAt(a, hm(17))));
    expect(JSON.stringify(threadsAt(b, hm(17)))).toBe(JSON.stringify(threadsAt(a, hm(17))));
  });

  it("does not care what order events were logged in", () => {
    const a = simulate(everything);
    const b = simulate({ ...everything, events: [...(everything.events ?? [])].reverse() });
    expect(b.series.hr).toEqual(a.series.hr);
    expect(b.series.glucose).toEqual(a.series.glucose);
  });

  it("leaves the model exactly as it was with no events", () => {
    const withoutList = simulate({ body, activities: base.activities, substances: [], intakes: [pizza] });
    const emptyList = simulate({ ...base, intakes: [pizza] });
    expect(emptyList.series.glucose).toEqual(withoutList.series.glucose);
    expect(emptyList.series.temperature).toEqual(withoutList.series.temperature);
    expect(Math.max(...emptyList.series.stressLevel)).toBe(0);
  });
});

describe("every minute of every kind of event", () => {
  const SCENARIOS: Record<string, Scenario> = {
    training: { ...base, events: [chestDay] },
    "training yesterday": { ...base, events: [{ ...chestDay, from: -hm(6), until: -hm(5) }] },
    "a whole body session with no end given": { ...base, events: [{ ...chestDay, until: null, muscles: MUSCLE_GROUPS.map((group) => ({ group, load: 0.7 })) }] },
    "a cold": { ...base, events: [cold] },
    flu: { ...base, events: [flu] },
    "illness with no symptoms named": { ...base, events: [{ ...cold, symptoms: [] }] },
    sex: { ...base, events: [sex] },
    stress: { ...base, events: [exam] },
    "ongoing stress": { ...base, events: [{ ...exam, until: null }] },
    "a short night": { ...base, events: [shortNight] },
    custom: { ...base, events: [sauna] },
    "all of it at once": { ...base, intakes: [coffee, pizza], events: [chestDay, flu, exam, shortNight, sex, sauna] },
  };
  const minutes: number[] = [];
  for (let t = hm(6); t <= hm(26); t += 3) minutes.push(t);

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const tr = simulate(scenario);

    it(`writes nothing broken: ${name}`, () => {
      for (const t of minutes) {
        const a = assess(tr, t);
        const texts = [a.headline, ...a.notable.map((n) => n.text), ...a.readings.flatMap((r) => [r.display, r.verdictWord, r.why, r.forecast ?? "", r.scale.typicalLabel]), ...a.feelings.flatMap((f) => [f.label, f.word, f.cause, f.when ?? ""]), ...Object.values(a.systems).map((s) => s.word)];
        for (const p of processesAt(tr, t)) texts.push(p.title, p.headline, ...p.stops.flatMap((s) => [s.label, s.reading, s.say]));
        for (const thread of threadsAt(tr, t)) texts.push(thread.title, thread.since, thread.status);
        for (const text of texts) expect(text, text).not.toMatch(/NaN|undefined|Infinity|null|\bthe the\b/);
        for (const r of a.readings) expect(Number.isFinite(r.value), r.id).toBe(true);
      }
    });

    it(`keeps numbers in range and lines well formed: ${name}`, () => {
      for (const t of minutes) {
        const a = assess(tr, t);
        for (const s of Object.values(a.systems)) {
          expect(s.level).toBeGreaterThanOrEqual(0);
          expect(s.level).toBeLessThanOrEqual(1);
        }
        for (const f of a.feelings) expect(f.intensity).toBeLessThanOrEqual(1);
        for (const p of processesAt(tr, t)) {
          expect(p.stops.filter((s) => s.state === "here").length, p.id).toBe(p.active ? 1 : 0);
          p.stops.forEach((s, i) => {
            expect(s.number).toBe(i + 1);
            expect(s.share).toBeGreaterThanOrEqual(0);
            expect(s.share).toBeLessThanOrEqual(1);
            expect(s.flow).toBeGreaterThanOrEqual(0);
            expect(s.flow).toBeLessThanOrEqual(1);
            if (s.from !== null) expect(p.stops.slice(0, i).map((x) => x.id)).toContain(s.from);
          });
        }
      }
    });

    it(`keeps the copy short and plain: ${name}`, () => {
      for (const t of minutes) {
        const a = assess(tr, t);
        for (const r of a.readings) expect(words(r.why), r.why).toBeLessThanOrEqual(10);
        for (const f of a.feelings) expect(words(f.cause), f.cause).toBeLessThanOrEqual(10);
        for (const s of Object.values(a.systems)) expect(words(s.word), s.word).toBeLessThanOrEqual(3);
        for (const p of processesAt(tr, t)) {
          expect(words(p.headline), p.headline).toBeLessThanOrEqual(18);
          for (const s of p.stops) expect(words(s.say), s.say).toBeLessThanOrEqual(25);
        }
        for (const thread of threadsAt(tr, t)) expect(words(thread.status), thread.status).toBeLessThanOrEqual(2);
        const all = [a.headline, ...a.readings.map((r) => r.why), ...a.feelings.map((f) => f.cause)].join(" ");
        expect(all).not.toMatch(/\bnot just\b|\brather than\b|\bbut not\b|\bnot only\b/i);
      }
    });
  }
});

it("keeps the training tired feeling on the scale params say", () => {
  const resolved = resolveEvent(chestDay, { body, anthro });
  expect(resolved.feelings[0].amount).toBeCloseTo(TRAINING.tired.atZero + TRAINING.tired.gain * 0.8);
  expect(ENERGY.mets.sitting).toBeGreaterThan(1);
  expect(MUSCLE_RECOVERY.sorenessPeakH).toBeGreaterThanOrEqual(24);
});
