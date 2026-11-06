import { type BodyView, type ExtensionState, type ExtensionStop, levelWord, type ProcessExtension } from "./api";

// Every tunable number. Typical levels and timing come from the studies in `source`; the exact
// curve shape, and treating "awake at night" as "lights on", are Claude's estimates.
const params = {
  dayPgMl: 3, // daytime melatonin in blood, pg/mL: near zero
  nightRisePgMl: 60, // how far it climbs above that at night, pg/mL
  onsetHour: 21.5, // half of the rise reached about 2 h before usual bedtime (dim light melatonin onset)
  onsetWidthH: 0.7, // how sharp the evening rise is
  offsetHour: 7.5, // half of the fall reached near the usual waking time
  offsetWidthH: 0.9, // how sharp the morning fall is
  awakeLightCut: 0.5, // share lost while awake at night, taken as being in room light (Gooley 2011 estimate)
  nightFromDrive: 0.5, // clock drive above which the clock is signalling night
  litFromDrive: 0.2, // clock drive above which light while awake is worth naming
  activeAbovePgMl: 10, // above this the line counts as working
  highAbovePgMl: 40, // above this it reads as near its night peak
  trendWindowMin: 30, // compared this far either side to tell rising from falling
  trendPgMl: 2, // a change this large across the window counts as rising or falling
  drowsyScale: 1, // the model's drowsiness drawn as a full line
} as const;

const hourOf = (minute: number) => (((minute / 60) % 24) + 24) % 24;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// What the body clock asks for at this hour, 0 to 1, before light has its say. Hours are counted
// from noon so the night is one unbroken stretch.
function clockDrive(minute: number) {
  const fromNoon = (hourOf(minute) - 12 + 24) % 24;
  const onset = params.onsetHour - 12;
  const offset = params.offsetHour + 12;
  return sigmoid((fromNoon - onset) / params.onsetWidthH) * sigmoid((offset - fromNoon) / params.offsetWidthH);
}

// The model's posture curve is 0 while asleep.
const awake = (view: BodyView, minute: number) => view.value("posture", minute) > 0.5;

const lightCut = (view: BodyView, minute: number) => (awake(view, minute) ? params.awakeLightCut : 0);

function level(view: BodyView, minute: number) {
  return params.dayPgMl + params.nightRisePgMl * clockDrive(minute) * (1 - lightCut(view, minute));
}

const clockTime = (minute: number) => {
  // From the minute itself, because hourOf(182) * 60 comes to 181.99999 and would read 03:01.
  const total = Math.floor(((minute % 1440) + 1440) % 1440);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

function at(view: BodyView, minute: number): ExtensionState {
  const drive = clockDrive(minute);
  const cut = lightCut(view, minute);
  const signal = clamp01(drive * (1 - cut));
  const pg = level(view, minute);
  const before = level(view, minute - params.trendWindowMin);
  const after = level(view, minute + params.trendWindowMin);
  const rising = after - before > params.trendPgMl;
  const falling = before - after > params.trendPgMl;
  const night = drive >= params.nightFromDrive;
  const lit = cut > 0 && drive >= params.litFromDrive;
  const share = clamp01((pg - params.dayPgMl) / params.nightRisePgMl);
  const active = pg >= params.activeAbovePgMl;
  const high = pg >= params.highAbovePgMl;
  const drowsy = clamp01(view.value("drowsy", minute) / params.drowsyScale);
  const asleep = !awake(view, minute);
  const pgText = `${Math.round(pg)} pg/mL`;

  const stops: ExtensionStop[] = [
    {
      id: "clock",
      organ: "brain",
      label: "Body clock",
      reading: clockTime(minute),
      share: clamp01(drive),
      flow: signal,
      say: lit
        ? "Light reaching your eyes tells the body clock it is still day, so it holds back the night signal."
        : night
          ? "In darkness, the body clock above your eyes signals that it is night."
          : "In daylight, the body clock keeps the night signal switched off.",
      routes: [],
    },
    {
      id: "relay",
      organ: null,
      label: "Neck relay",
      reading: night && !lit ? "Signalling" : "Quiet",
      share: signal,
      flow: signal,
      say: "The clock's message travels down the spinal cord to a nerve cluster in your neck, then back up to the pineal.",
      routes: ["to_neck"],
    },
    {
      id: "pineal",
      organ: "brain",
      label: "Pineal gland",
      reading: rising ? "Rising" : falling ? "Falling" : active ? "Making" : "Resting",
      share,
      flow: signal,
      say: active
        ? "This small gland deep in the brain turns serotonin into melatonin and releases it straight into the blood."
        : "The pineal gland makes almost no melatonin while the clock says it is day.",
      routes: ["carotid"],
    },
    {
      id: "blood",
      organ: "heart",
      label: "In blood",
      reading: pgText,
      share,
      flow: signal,
      say: high
        ? "Melatonin is near its night peak. It clears within an hour, so your pineal has to keep making it."
        : falling
          ? "Melatonin is falling as morning arrives, and it leaves your blood within an hour."
          : "Melatonin stays close to zero through the day.",
      routes: ["from_brain"],
    },
    {
      id: "sleep",
      organ: "brain",
      label: "Sleepiness",
      reading: asleep ? "Asleep" : levelWord(drowsy),
      share: asleep ? share : drowsy,
      flow: share,
      say: asleep
        ? active
          ? "Melatonin tells your body clock it is night and helps cool you. The model's temperature has its own rhythm."
          : "You are asleep while the body clock says it is day, so melatonin stays low."
        : active
          ? "Melatonin quiets the clock's wake signal, and you may feel sleepier. The model's sleepiness comes from time awake."
          : "With little melatonin about, the body clock keeps pushing you to stay awake.",
      routes: ["arch", "carotid"],
    },
  ];

  let here: string | null = null;
  if (active) here = lit ? "clock" : rising ? "pineal" : falling ? "blood" : "sleep";

  const headline = !active
    ? lit
      ? "Light while awake at night is holding melatonin down."
      : "Daytime: the pineal gland is resting, melatonin near zero."
    : lit
      ? "Melatonin is held lower by light while you are awake."
      : rising
        ? "Darkness is here, so melatonin is rising."
        : falling
          ? "Morning is near, so melatonin is falling."
          : "Melatonin stays high through the night.";

  return { active, headline, here, stops };
}

export const extension: ProcessExtension = {
  id: "melatonin",
  title: "Melatonin",
  system: "energy",
  evidence: "C",
  source:
    "Timing: melatonin starts rising about 2 hours before usual sleep (dim light melatonin onset; Lewy and Sack 1989; Burgess and Fogg 2008), peaks around 02:00 to 04:00 and falls near waking (Arendt, Rev Reprod 1998). Night levels of roughly 40 to 100 pg/mL and daytime levels near zero are typical adult values that vary widely between people; 60 pg/mL is Claude's mid estimate. A half-life under an hour follows Claustrat et al., Sleep Med Rev 2005. The pathway from the clock (suprachiasmatic nucleus) through the spinal cord and the neck's superior cervical ganglion to the pineal is standard anatomy. Room light during the usual sleep hours cut melatonin by more than half in most people in Gooley et al., JCEM 2011. The model has no light sensor, so being awake at night is taken to mean lights on, and the size of that cut, and the curve's shape, are Claude's estimates. The model's own sleepiness and temperature come from time awake and its daily rhythm, and do not respond to melatonin. Age, which lowers night melatonin, the timing of your own body clock, and melatonin pills are left out.",
  params,
  at,
};
