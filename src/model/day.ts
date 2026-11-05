import { z } from "zod";
import type { Cycle } from "./cycle";
import type { BodyEvent } from "./events";
import { DAY } from "./params";
import { ActivitySpan, Body, CustomSubstance, Intake, Posture, postureAt } from "./simulate";

// What is written to disk for one date. It holds everything still acting on the body that day, so
// yesterday's late coffee is in today's file, with a negative minute.
export interface DayDoc {
  version: 1;
  date: string; // YYYY-MM-DD, the day this belongs to, which runs from DAY.rolloverMin to the same time next morning
  body: Body;
  intakes: Intake[];
  activities: ActivitySpan[];
  substances: CustomSubstance[];
  events: BodyEvent[];
  cycle: Cycle | null;
  assumptions: Record<string, string>;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const nutrientAmount = z.number().finite().min(0);
const intakeSchema = z.looseObject({
  id: z.string().min(1),
  label: z.string(),
  at: z.number().finite(),
  grams: nutrientAmount,
  waterMl: nutrientAmount,
  carbsG: nutrientAmount,
  sugarG: nutrientAmount,
  fatG: nutrientAmount,
  proteinG: nutrientAmount,
  fiberG: nutrientAmount,
  caffeineMg: nutrientAmount,
  alcoholG: nutrientAmount,
});
const substanceSchema = z.looseObject({ id: z.string().min(1), label: z.string(), at: z.number().finite(), doseMg: z.number().positive(), tmaxMin: z.number().positive(), halfLifeH: z.number().positive(), volumeLPerKg: z.number().positive(), bioavailability: z.number(), targets: z.array(z.unknown()) });
const eventSchema = z.looseObject({ id: z.string().min(1), label: z.string(), preset: z.string(), from: z.number().finite(), until: z.number().finite().nullable(), intensity: z.number(), muscles: z.array(z.unknown()), symptoms: z.array(z.unknown()) });

const dayDocSchema = z.object({
  version: z.literal(1),
  date: z.string().regex(DATE_PATTERN),
  body: z.object({ sex: z.enum(["male", "female"]), age: z.number(), heightCm: z.number(), weightKg: z.number() }),
  intakes: z.array(intakeSchema),
  activities: z.array(z.object({ from: z.number().finite(), posture: z.enum(["sleeping", "sitting", "standing", "walking", "running"]) })),
  substances: z.array(substanceSchema),
  events: z.array(eventSchema),
  cycle: z.object({ start: z.number().finite(), lengthDays: z.number().positive(), periodDays: z.number().positive() }).nullable().default(null),
  assumptions: z.record(z.string(), z.string()),
});

// A day without its date, for anything that reads a day as it stands.
export const dayContentSchema = dayDocSchema.omit({ version: true, date: true });
export type DayContent = Omit<DayDoc, "version" | "date">;

// The fields are checked here, where a file comes in. Events carry a nested story the reducer built, so
// past their common fields they are taken as the app wrote them.
export function parseDayDoc(raw: unknown): DayDoc {
  return dayDocSchema.parse(raw) as unknown as DayDoc;
}

const pad = (n: number) => String(n).padStart(2, "0");

const dateText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Which day it is and which minute of it. Past midnight it is still yesterday until the rollover, so
// 01:30 reads as minute 1530 of the day that began the morning before.
export function clockAt(date: Date): { date: string; minute: number } {
  const minute = date.getHours() * 60 + date.getMinutes();
  if (minute >= DAY.rolloverMin) return { date: dateText(date), minute };
  const before = new Date(date);
  before.setDate(date.getDate() - 1);
  return { date: dateText(before), minute: minute + 1440 };
}

const utcDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export const daysBetween = (from: string, to: string) => Math.round(utcDay(to) - utcDay(from));

const USUAL_POSTURE: Posture = "standing";

// A night and a morning nobody has said anything about.
export const typicalDayFromYesterday = (): ActivitySpan[] => [
  { from: -1440, posture: "sleeping" },
  { from: DAY.wakeMin - 1440, posture: USUAL_POSTURE },
  { from: DAY.sleepMin - 1440, posture: "sleeping" },
  { from: DAY.wakeMin, posture: USUAL_POSTURE },
];

export function firstDay(date: string, body: Body): DayDoc {
  return { version: 1, date, body, intakes: [], activities: typicalDayFromYesterday(), substances: [], events: [], cycle: null, assumptions: {} };
}

// What was logged keeps its name in the new day, while a new coffee can use the id "coffee" again.
const carriedId = (id: string, date: string) => (id.includes("@") ? id : `${id}@${date}`);

// Yesterday as it ended: with no word on the night, the usual bedtime stands, and it is written down
// because the rule that fills it in only applies to today.
function activitiesAfter(doc: DayDoc, days: number): ActivitySpan[] {
  if (days > 1) return typicalDayFromYesterday();
  const shift = days * 1440;
  const sorted = [...doc.activities].sort((a, b) => a.from - b.from);
  const spans = sorted.some((span) => span.from >= DAY.sleepMin) ? sorted : [...sorted, { from: DAY.sleepMin, posture: "sleeping" as const }];
  const shifted = spans.map((span) => ({ ...span, from: span.from - shift })).filter((span) => span.from >= -1440);
  return [...shifted, { from: DAY.wakeMin, posture: USUAL_POSTURE }];
}

// The file for a later date, starting from an earlier one. Every minute moves back by the days that
// passed, and what can no longer matter is dropped.
export function carryOver(doc: DayDoc, date: string): DayDoc {
  const days = daysBetween(doc.date, date);
  if (days <= 0) return doc;
  const shift = days * 1440;
  const intakes = doc.intakes.filter((i) => i.at - shift >= -DAY.intakeCarryDays * 1440).map((i) => ({ ...i, id: carriedId(i.id, doc.date), at: i.at - shift }));
  const assumptions: Record<string, string> = {};
  for (const kept of doc.intakes) {
    const said = doc.assumptions[kept.id];
    if (said !== undefined && kept.at - shift >= -DAY.intakeCarryDays * 1440) assumptions[carriedId(kept.id, doc.date)] = said;
  }
  return {
    version: 1,
    date,
    body: doc.body,
    intakes,
    assumptions,
    cycle: doc.cycle && { ...doc.cycle, start: doc.cycle.start - shift },
    activities: activitiesAfter(doc, days),
    substances: doc.substances.filter((s) => s.at - shift >= -DAY.substanceCarryDays * 1440).map((s) => ({ ...s, id: carriedId(s.id, doc.date), at: s.at - shift })),
    events: doc.events
      .filter((e) => e.until === null || e.from - shift >= -DAY.eventCarryDays * 1440)
      .map((e) => (e.until === null ? { ...e, from: e.from - shift } : { ...e, id: carriedId(e.id, doc.date), from: e.from - shift, until: e.until - shift })),
  };
}

// Someone talking to you is awake, whatever the usual night says. Past bedtime they never went to
// bed, and are taken to stay up a little longer. Before the usual wake-up they are simply up early.
export function stayAwake(activities: ActivitySpan[], now: number): { posture: Posture; from: number; until: number } | null {
  if (postureAt(activities, now) !== "sleeping") return null;
  if (now < DAY.sleepMin) return now < DAY.wakeMin ? { posture: "sitting", from: now, until: DAY.wakeMin } : { posture: "sitting", from: now, until: now + DAY.stillUpMin };
  const latest = Math.max(DAY.sleepMin, ...activities.filter((span) => span.from <= now).map((span) => span.from));
  return { posture: "sitting", from: latest, until: Math.min(DAY.minutes - 1, now + DAY.stillUpMin) };
}
