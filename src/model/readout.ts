import { CAFFEINE } from "./params";
import { muscleStateAt } from "./events";
import { MUSCLE_GROUPS } from "./muscleGroups";
import { processesAt } from "./processes/processes";
import { Trajectory, value } from "./engine/trajectory";
import { threadsAt } from "./threads";
import type { OrganId } from "./ids";
import { forecast } from "./forecast";
import { formatClock, inSentence, levelWord } from "./words";
import { peakIndex } from "./curve";

export interface ReplyLine {
  text: string;
  organ?: OrganId;
  unverified?: string[]; // numbers in the text that the model never returned, so Claude added them
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// The scripted opening answer: one short caption, because the body and the panels carry the rest.
export function openingReply(tr: Trajectory, now: number): ReplyLine[] {
  const f = forecast(tr, now);
  const coffee = tr.scenario.intakes.find((i) => i.caffeineMg > 0 && i.at <= now);
  const inStomach = value(tr, "stomachKcal", now) > 25;
  const parts: string[] = [];
  if (inStomach) parts.push("the meal is mostly still in your stomach");
  if (coffee) parts.push(`your ${inSentence(coffee.label)} is fading`);
  const first = parts.length ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts[1] ? ` and ${parts[1]}` : ""}.` : "Nothing much is going on.";
  const second = f.sleepiest ? ` You may feel sleepy near ${formatClock(f.sleepiest.at)}.` : "";
  return [{ text: `${first}${second}`, organ: inStomach ? "stomach" : undefined }];
}

const level = (x: number) => levelWord(x).toLowerCase();

export function readout(tr: Trajectory, now: number) {
  const f = forecast(tr, now);
  const round = (x: number, d = 1) => Number(x.toFixed(d));
  const v = (n: Parameters<typeof value>[1]) => value(tr, n, now);
  return {
    now: formatClock(now),
    body: { ...tr.scenario.body, bmi: round(tr.anthro.bmi), lean_kg: round(tr.anthro.leanKg), blood_l: round(tr.anthro.bloodVolumeL) },
    blood: {
      glucose_mmol_l: round(v("glucose") / 18.016),
      insulin_times_rest: round(v("insulin") / 8),
      triglycerides_mg_dl: round(v("tg"), 0),
      caffeine_mg_l: round(v("caffeine"), 2),
      alcohol_g_l: round(v("alcohol"), 2),
      adenosine_a1_receptors_blocked: pct(v("occupancy")),
      caffeine_felt_effect: level(v("caffeineFelt")),
      temperature_c: round(v("temperature")),
      systolic_mm_hg: round(v("systolic"), 0),
      stress: level(v("stressLevel")),
      inflammation: level(v("inflammation")),
      immune_activity: level(v("immune")),
      feel_good_chemicals: level(v("reward")),
      fluid_balance_ml: round(v("fluidBalance"), 0),
    },
    organs: {
      stomach_ml: round(v("stomachMl"), 0),
      stomach_kcal: round(v("stomachKcal"), 0),
      emptying_kcal_per_min: round(v("emptyingKcalPerMin")),
      intestine_kcal: round(v("gutKcal"), 0),
      absorbing_sugar_g_per_h: round((v("carbAbsorbMgMin") / 1000) * 60, 0),
      liver_glycogen_g: round(v("liverGlycogen"), 0),
      heart_bpm: round(v("hr"), 0),
      blood_to_gut: pct(v("flowGut")),
      blood_to_muscle: pct(v("flowMuscle")),
      muscle_sugar_uptake_g_per_h: round(v("muscleUptakeGMin") * 60, 0),
      bladder_ml: round(v("bladderMl"), 0),
      kcal_per_hour: round(v("kcalPerHour"), 0),
    },
    feelings: {
      full: level(v("fullness")),
      alert: level(v("alertness")),
      sleepy: level(v("drowsy")),
      jittery: level(v("jitter")),
      hungry: level(v("hunger")),
      low_sugar: level(v("crash")),
    },
    forecast: {
      glucose_peak: f.glucosePeak ? { at: formatClock(f.glucosePeak.at), mmol_l: round(f.glucosePeak.value / 18.016) } : null,
      glucose_settles_at: f.glucoseSettles ? formatClock(f.glucoseSettles) : null,
      sleepiest_at: f.sleepiest ? formatClock(f.sleepiest.at) : null,
      stomach_half_empty_at: f.stomachHalf ? formatClock(f.stomachHalf) : null,
      stomach_empty_at: f.stomachEmpty ? formatClock(f.stomachEmpty) : null,
      triglyceride_peak_at: f.tgPeak ? formatClock(f.tgPeak.at) : null,
      caffeine_at_bedtime_mg_l: round(f.caffeineAtBedMgL, 2),
      caffeine_half_life_range_h: `${CAFFEINE.halfLifeH.low} to ${CAFFEINE.halfLifeH.high}`,
    },
    other_substances: [...tr.substances.values()].map(({ substance, series }) => {
      const peakAt = peakIndex(series, 0);
      const minute = Math.max(0, Math.min(series.length - 1, Math.floor(now)));
      return { id: substance.id, label: substance.label, blood_mg_l: round(series[minute], 2), peak_at: formatClock(peakAt), peak_mg_l: round(series[peakAt], 2) };
    }),
    muscles: Object.fromEntries(
      MUSCLE_GROUPS.map((group) => {
        const s = muscleStateAt(tr.muscleEvents, group, now);
        return [group, { work: level(s.work), fatigue: level(s.fatigue), soreness: level(s.soreness), repair: level(s.repair), active: s.work + s.fatigue + s.soreness + s.repair > 0 }] as const;
      }).filter(([, s]) => s.active),
    ),
    events: tr.events.map((e) => ({ id: e.id, label: e.label, preset: e.preset, from: formatClock(e.from), until: e.until === null ? "still going on" : formatClock(e.until), intensity: e.intensity, evidence: e.evidence, source: e.source })),
    // What the person sees on the top level, one line per thing they told the body about.
    threads: threadsAt(tr, now).map((t) => ({ id: t.id, title: t.title, since: t.since, status: t.status, active: t.active, process_id: t.processId })),
    // Ids Claude can pass to show_process, with what each one says right now.
    processes: processesAt(tr, now).map((p) => ({ id: p.id, title: p.title, system: p.system, active: p.active, headline: p.headline })),
  };
}

