import { cycleDay, cyclePhase, liningShare, lutealShare } from "../cycle";
import { ALCOHOL, CYCLE, DAY, FEEL, GLUCOSE, INSULIN, KIDNEY, PROCESS, REFERENCE } from "../params";
import { intakeFlowsAt, SeriesName, Trajectory, value } from "../engine/trajectory";
import { alcoholVolumeL } from "../engine/anthropometrics";
import { OrganId } from "../ids";
import { howMuch, hoursWord, inSentence, levelWord, startCase } from "../words";
import type { RouteId } from "../ids";
import { clamp01 } from "../curve";
import { caffeineHalfLifeH, caffeineTotals } from "./dose";
import { Draft, Process, clock, flowRate, hasStarted, numbered, peakAfter, percent, postureAt, shareOf } from "./line";

export function insulinProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const fold = v("insulin") / INSULIN.baselineUUPerMl;
  const mgDl = v("glucose");
  const mmol = (x: number) => (x / REFERENCE.mgDlPerMmolGlucose).toFixed(1);
  const posture = postureAt(tr, t);
  const rising =
    value(tr, "glucose", t + REFERENCE.trendWindowMin) - value(tr, "glucose", t - REFERENCE.trendWindowMin) > 1;
  const toMuscle = v("muscleUptakeGMin");
  const fromInsulin = v("insulinUptakeGMin") * GLUCOSE.muscleShare;
  const pulledByWork = toMuscle - fromInsulin;
  const toFat = v("insulinUptakeGMin") * GLUCOSE.fatShare;
  const toLiver = v("liverUptakeGMin");
  const leaving = toMuscle + toFat + toLiver;
  const movedByInsulin = fromInsulin + toFat + toLiver;
  const moving = posture === "walking" || posture === "running";
  const peak = peakAfter(tr, "glucose", t);
  const notableWork = pulledByWork * 60 >= PROCESS.sugarLeavingAboveGPerH;
  const gPerHour = (x: number) => `${Math.round(x * 60)} g/h`;
  const full = PROCESS.fullFlow.sugarGPerMin;
  const notable = (x: number) => x * 60 >= PROCESS.sugarLeavingAboveGPerH;
  const insulinUp = fold > REFERENCE.insulin.atRestBelowFold;
  // Working muscle pulls sugar in without insulin, so a walk alone leaves this line at rest.
  const active = fold > PROCESS.insulinActiveAboveFold || notable(movedByInsulin);

  const stops: Draft[] = [
    {
      id: "sugar",
      organ: "heart",
      label: "Blood sugar",
      reading: `${mmol(mgDl)} mmol/L`,
      share: clamp01((mgDl - tr.anthro.baselineGlucose) / PROCESS.sugarExcessFullMgDl),
      flow: flowRate(v("glucoseAbsorbMgMin") / 1000, full),
      say:
        active && peak.ahead && peak.value - mgDl >= 2
          ? `Your blood sugar is rising, and should peak near ${clock(peak.at)}. This rise is what sets off insulin.`
          : "Your blood sugar is steady. Your body holds it in a narrow range.",
      routes: [],
    },
    {
      id: "pancreas",
      organ: "pancreas",
      label: "Pancreas",
      reading: `${fold.toFixed(1)}×`,
      share: clamp01((fold - 1) / (REFERENCE.insulin.afterFoodTypicalFold.high - 1)),
      flow: flowRate(v("insulinSecretion"), PROCESS.fullFlow.insulinSecretion),
      say: insulinUp
        ? "Your pancreas senses the sugar and releases insulin, the signal that tells your cells to take it in."
        : "Your pancreas keeps a trickle of insulin going, waiting for sugar to rise.",
      routes: ["arch", "descending", "to_gut"],
    },
    {
      id: "liver",
      organ: "liver",
      label: "Liver",
      reading: gPerHour(toLiver),
      share: shareOf(toLiver, leaving),
      flow: flowRate(toLiver, full),
      say: notable(toLiver)
        ? "Insulin reaches your liver first. It stops releasing sugar and starts storing it for later."
        : "Your liver is slowly releasing stored sugar, which keeps your blood and brain fuelled between meals.",
      routes: ["pancreas_portal"],
    },
    {
      id: "muscle",
      organ: "muscle",
      label: "Muscle",
      reading: gPerHour(toMuscle),
      share: shareOf(toMuscle, leaving),
      flow: flowRate(toMuscle, full),
      say:
        moving || notableWork
          ? "Moving muscles pull sugar in with hardly any insulin, which is why a walk after food helps."
          : notable(toMuscle)
            ? `Insulin opens your muscles to sugar${posture === "sitting" ? ". They take it slowly while you sit, far faster if you walk" : ""}.`
            : "Your muscles are taking almost no sugar. Insulin or movement would open them.",
      from: "liver",
      routes: ["liver_out", "arch", "descending", "leg_L"],
    },
    {
      id: "fat",
      organ: "fat",
      label: "Fat tissue",
      reading: gPerHour(toFat),
      share: shareOf(toFat, leaving),
      flow: flowRate(toFat, full),
      say: insulinUp
        ? "Fat tissue takes a small share. Insulin also tells it to hold on to its fat."
        : "With insulin at rest, your fat tissue releases a little fat for fuel.",
      from: "liver",
      routes: ["liver_out", "arch", "descending"],
    },
  ];

  let here: string | null = null;
  if (active)
    here = rising && fold < PROCESS.insulinStartingFold ? "pancreas" : toLiver >= toMuscle ? "liver" : "muscle";
  const headline = !active
    ? "Insulin is at rest. Your liver keeps your blood sugar steady"
    : rising
      ? "Insulin is climbing, following your blood sugar"
      : `Insulin is bringing sugar down, moving most of it into your ${toLiver >= fromInsulin ? "liver" : "muscles"}`;
  return {
    id: "insulin",
    title: "Insulin",
    system: "energy",
    substance: "insulin",
    active,
    headline,
    stops: numbered(stops, here, "ahead", true),
  };
}

function fatTotals(tr: Trajectory, t: number) {
  const totals = { stomach: 0, gut: 0, blood: 0, cleared: 0, absorbingPerMin: 0, eaten: 0 };
  for (const intake of tr.scenario.intakes) {
    const flows = intakeFlowsAt(tr, intake.id, t);
    if (flows && hasStarted(intake.at, t)) {
      totals.stomach += flows.stomachFat;
      totals.gut += flows.gutFat;
      totals.blood += flows.bloodFat;
      totals.cleared += flows.fatCleared;
      totals.absorbingPerMin += flows.fatAbsorbedPerMin;
      totals.eaten += intake.fatG;
    }
  }
  return totals;
}

export function fatRouteProcess(tr: Trajectory, t: number): Process {
  const fat = fatTotals(tr, t);
  const clearingPerMin = Math.max(
    0,
    (fatTotals(tr, t + PROCESS.flowWindowMin).cleared - fatTotals(tr, t - PROCESS.flowWindowMin).cleared) /
      (PROCESS.flowWindowMin * 2),
  );
  const full = PROCESS.fullFlow.fatGPerMin;
  const tg = value(tr, "tg", t);
  const peak = peakAfter(tr, "tg", t, DAY.minutes);
  const grams = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1)} g`;
  const peaking = peak.ahead && peak.value - tg >= 3 ? `, peaking near ${clock(peak.at)}` : "";
  const gPerHour = fat.absorbingPerMin * 60;

  const stops: Draft[] = [
    {
      id: "intestine",
      organ: "small_intestine",
      label: "Small intestine",
      reading: grams(fat.gut),
      share: shareOf(fat.gut, fat.eaten),
      flow: flowRate(fat.absorbingPerMin, full),
      say:
        fat.eaten > 0
          ? "Fat needs bile and enzymes to cross your gut wall, which makes it the slowest part of a meal."
          : "Fat needs bile and enzymes to cross the gut wall, so it moves slowly.",
      routes: ["stomach_out", "duodenum", "jejunum"],
    },
    {
      id: "lymph",
      organ: null,
      label: "Lymph",
      reading: `${gPerHour.toFixed(0)} g/h`,
      // Fat only passes through here, so the model keeps no amount at this stop.
      share: 0,
      flow: flowRate(fat.absorbingPerMin, full),
      say: "Fat is too big for gut blood vessels. It packs into droplets and rides the lymph up your chest.",
      routes: ["lymph"],
    },
    {
      id: "blood",
      organ: "heart",
      label: "Blood",
      reading: grams(fat.blood),
      share: shareOf(fat.blood, fat.eaten),
      flow: flowRate(fat.absorbingPerMin, full),
      say: "Lymph empties into a vein near your neck, so this fat skips your liver at first and reaches your blood late.",
      routes: ["lymph_svc"],
    },
    {
      id: "fat",
      organ: "fat",
      label: "Fat tissue",
      reading: grams(fat.cleared),
      share: shareOf(fat.cleared, fat.eaten),
      flow: flowRate(clearingPerMin, full),
      say: "Your fat tissue pulls meal fat out of your blood, stores most of it and burns a little.",
      routes: ["arch", "descending"],
    },
  ];

  const inTransit = fat.stomach + fat.gut + fat.blood;
  const active = fat.eaten > 0 && inTransit >= PROCESS.fatRouteActiveAboveG;
  let here: string | null = null;
  if (active) {
    if (fat.stomach + fat.gut < fat.blood) here = fat.blood >= fat.cleared ? "blood" : "fat";
    else here = "intestine";
  }
  const headline =
    fat.eaten === 0
      ? "No fat eaten yet"
      : !active
        ? "Meal fat has left your blood"
        : fat.stomach >= fat.eaten * 0.5
          ? "Still in your stomach, and it reaches your blood hours after the sugar"
          : `Meal fat is in your blood${peaking}`;
  return {
    id: "fat-route",
    title: "Fat route",
    system: "energy",
    substance: "fat",
    active,
    headline,
    stops: numbered(stops, here, fat.eaten > 0 ? "passed" : "ahead"),
  };
}

interface BloodBranch {
  id: string;
  organ: OrganId;
  label: string;
  series: SeriesName;
  routes: RouteId[];
  note: (ctx: { moving: boolean; digesting: boolean }) => string;
}

const BLOOD_BRANCHES: BloodBranch[] = [
  {
    id: "gut",
    organ: "small_intestine",
    label: "Gut",
    series: "flowGut",
    routes: ["arch", "descending", "to_gut"],
    note: ({ moving, digesting }) =>
      moving
        ? "Less than usual, because working muscle takes the blood."
        : digesting
          ? "More than usual, to carry away what you absorb."
          : "Its usual share at rest.",
  },
  {
    id: "muscle",
    organ: "muscle",
    label: "Muscle",
    series: "flowMuscle",
    routes: ["arch", "descending", "leg_L", "leg_R"],
    note: ({ moving }) => (moving ? "Working muscles open their vessels wide." : "Resting muscle needs little."),
  },
  {
    id: "brain",
    organ: "brain",
    label: "Brain",
    series: "flowBrain",
    routes: ["arch", "carotid"],
    note: () => "Your brain's supply barely changes.",
  },
  {
    id: "kidneys",
    organ: "kidneys",
    label: "Kidneys",
    series: "flowKidneys",
    routes: ["arch", "descending", "to_kidney_L", "to_kidney_R"],
    note: () => "They filter it and send waste to your bladder.",
  },
];

export function circulationProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const bpm = v("hr");
  const output = v("cardiacOutput");
  const posture = postureAt(tr, t);
  const moving = posture === "walking" || posture === "running";
  const digesting = v("digestion") > 0.05;
  const stops: Draft[] = [
    {
      id: "heart",
      organ: "heart",
      label: "Heart",
      reading: `${Math.round(bpm)} bpm`,
      share: 1,
      flow: flowRate(output, PROCESS.fullFlow.heartLPerMin),
      say: moving
        ? "Your heart is pumping hard to feed your working muscles."
        : digesting
          ? "Your heart is working a little harder, because digesting pulls extra blood to your gut."
          : "Your heart is at its usual pace, sharing blood out by need.",
      routes: [],
    },
    ...BLOOD_BRANCHES.map((branch) => ({
      id: branch.id,
      organ: branch.organ,
      label: branch.label,
      reading: percent(v(branch.series)),
      share: v(branch.series),
      flow: flowRate(v(branch.series) * output, PROCESS.fullFlow.bloodLPerMin),
      say: branch.note({ moving, digesting }),
      from: "heart",
      routes: branch.routes,
    })),
  ];
  const here = moving ? "muscle" : digesting ? "gut" : "heart";
  const headline = moving
    ? `${startCase(howMuch(v("flowMuscle")))} of your blood is going to your muscles`
    : digesting
      ? "More blood than usual is going to your gut"
      : "Your heart is sharing blood out the usual way";
  return {
    id: "circulation",
    title: "Blood flow",
    system: "circulation",
    substance: "other",
    active: true,
    headline,
    stops: numbered(stops, here, "ahead", true),
  };
}

export function alertnessProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName) => value(tr, name, t);
  const occupancy = v("occupancy");
  const mgL = v("caffeine");
  const totals = caffeineTotals(tr, t);
  const before = caffeineTotals(tr, t - PROCESS.flowWindowMin);
  const after = caffeineTotals(tr, t + PROCESS.flowWindowMin);
  const absorbingPerMin = (after.blood + after.cleared - before.blood - before.cleared) / (PROCESS.flowWindowMin * 2);
  const awake = hoursWord(v("hoursAwake"));
  const alertWord = levelWord(v("alertness")).toLowerCase();
  const asleep = postureAt(tr, t) === "sleeping";
  const felt = v("caffeineFelt");
  const working = felt >= PROCESS.caffeineWorkingAboveFelt;
  const blocked = Math.round(occupancy * 100);
  const drains =
    v("mealDip") >= PROCESS.mealPullsAlertnessAbove
      ? "the meal and time awake pull it down"
      : "time awake pulls it down";

  const stops: Draft[] = [
    {
      id: "caffeine",
      organ: "heart",
      label: "Caffeine in blood",
      reading: `${mgL.toFixed(2)} mg/L`,
      share: shareOf(totals.blood, totals.dose),
      flow: flowRate(absorbingPerMin, PROCESS.fullFlow.caffeineMgPerMin),
      say:
        totals.dose > 0
          ? `${startCase(howMuch(shareOf(totals.blood, totals.dose)))} of your caffeine is still in your blood, and it passes easily into your brain.`
          : "No caffeine logged.",
      routes: ["liver_out", "arch"],
    },
    {
      id: "receptors",
      organ: "brain",
      label: "Tired signal blocked",
      reading: `${blocked}%`,
      share: occupancy,
      flow: felt,
      say: working
        ? "Caffeine sits where the tired signal would land. That hides some of your tiredness, and the tiredness keeps building."
        : "Almost none of the tired signal is blocked, so it lands freely.",
      routes: ["carotid"],
    },
    {
      id: "alertness",
      organ: "brain",
      label: "Alertness",
      reading: levelWord(v("alertness")),
      share: v("alertness"),
      flow: 0,
      say: asleep
        ? "You are asleep."
        : `Your alertness is ${alertWord}. ${working ? `Caffeine holds it up, ${drains}.` : `${startCase(drains)}.`}`,
      routes: [],
    },
    {
      id: "pressure",
      organ: "brain",
      label: "Sleep pressure",
      reading: asleep ? "" : `${awake} awake`,
      share: clamp01(v("sleepPressure") / (PROCESS.sleepPressureFullH * FEEL.sleepPressurePerHour)),
      flow: 0,
      say: asleep
        ? "Sleep clears the adenosine you built up during the day."
        : working
          ? `Adenosine has built for ${awake}. Caffeine hides it, so you feel it all when caffeine wears off.`
          : `Adenosine has built for ${awake}. You feel it as tiredness.`,
      routes: [],
    },
  ];
  const headline = asleep
    ? "Asleep, and clearing the day's tiredness"
    : working
      ? `Caffeine hides some of your tiredness after ${awake} awake`
      : `No caffeine at work, tiredness building after ${awake} awake`;
  return {
    id: "alertness",
    title: "Alertness",
    system: "brain",
    substance: "caffeine",
    active: working,
    headline,
    stops: numbered(stops, working ? "caffeine" : null, "ahead", true),
  };
}

export function clearingProcess(tr: Trajectory, t: number): Process {
  const v = (name: SeriesName, at = t) => value(tr, name, at);
  const totals = caffeineTotals(tr, t);
  const caffeinePerHour = totals.blood * (Math.LN2 / caffeineHalfLifeH(tr));
  const caffeine = v("caffeine");
  const alcohol = v("alcohol");
  const bladder = v("bladderMl");
  const change = (v("bladderMl", t + 5) - v("bladderMl", t - 5)) / 10;
  const urinePerMin = change > 0 ? change : KIDNEY.urineMlPerMin;
  const hasAlcohol = alcohol >= PROCESS.clearingActiveAboveGPerL;
  const hasCaffeine = caffeine >= PROCESS.clearingActiveAboveMgL;
  const minute = Math.max(0, Math.min(DAY.minutes, Math.floor(t)));
  const substances = [...tr.substances.values()].filter(
    ({ substance, series }) => hasStarted(substance.at, t) && series[minute] >= PROCESS.clearingActiveAboveMgL,
  );
  const full = PROCESS.fullFlow;
  const ml = `${Math.round(bladder / 10) * 10} ml`;
  const urine = `${Math.round(urinePerMin * 60)} ml`;

  const stops: Draft[] = [
    {
      id: "liver",
      organ: "liver",
      label: "Liver",
      reading: hasAlcohol ? `${alcohol.toFixed(2)} g/L` : hasCaffeine ? `${caffeinePerHour.toFixed(1)} mg/h` : "Quiet",
      share: shareOf(totals.cleared, totals.dose),
      flow: hasAlcohol
        ? flowRate((ALCOHOL.eliminationGPerLPerH * alcoholVolumeL(tr.scenario.body)) / 60, full.alcoholGPerMin)
        : flowRate(caffeinePerHour / 60, full.clearedMgPerMin),
      say: hasAlcohol
        ? "Your liver deals with alcohol first, at a slow, steady pace."
        : hasCaffeine
          ? "Your liver is slowly breaking down caffeine, which can linger for hours."
          : "Your liver has little to clear right now.",
      routes: ["to_liver_art"],
    },
    {
      id: "kidneys",
      organ: "kidneys",
      label: "Kidneys",
      reading: `${urine}/h`,
      share: v("flowKidneys"),
      flow: flowRate(urinePerMin, full.urineMlPerMin),
      say: "Your kidneys filter your blood and send what's left over to your bladder.",
      from: "liver",
      routes: ["liver_out", "arch", "descending", "to_kidney_L", "to_kidney_R"],
    },
    {
      id: "bladder",
      organ: "bladder",
      label: "Bladder",
      reading: ml,
      share: clamp01(bladder / REFERENCE.bladder.capacityMl),
      flow: flowRate(urinePerMin, full.urineMlPerMin),
      say:
        bladder >= REFERENCE.bladder.strongDesireMl
          ? "Your bladder is getting full, and you may feel a strong urge."
          : bladder >= REFERENCE.bladder.firstDesireMl
            ? "Your bladder has filled enough that you may start to notice it."
            : "Your bladder is filling, too little to notice yet.",
      routes: ["to_bladder_L", "to_bladder_R"],
    },
  ];
  const liverBusy = hasAlcohol || hasCaffeine || substances.length > 0;
  const active = liverBusy || bladder >= REFERENCE.bladder.firstDesireMl;
  const here = !active ? null : liverBusy ? "liver" : "bladder";
  const headline = hasAlcohol
    ? "Your liver is dealing with the alcohol first"
    : hasCaffeine
      ? "Your liver is slowly breaking down the caffeine"
      : substances.length
        ? `Your body is working through the ${inSentence(substances[0].substance.label)}`
        : "Nothing much to clear";
  return {
    id: "clearing",
    title: "Liver and kidneys",
    system: "clearing",
    substance: "other",
    active,
    headline,
    stops: numbered(stops, here, "ahead", true),
  };
}

// ---- Anything else that happened, told through its own stops.

const QUIET_FLOW = 0.15;

// The hormones' loop, from the brain down to the uterus. It only exists once a cycle has been logged.
export function cycleProcess(tr: Trajectory, t: number): Process[] {
  const { cycle } = tr;
  if (!cycle) return [];
  const v = (name: SeriesName) => value(tr, name, t);
  const phase = cyclePhase(cycle, t);
  const stops: Draft[] = [
    {
      id: "pituitary",
      organ: "brain",
      label: "Pituitary",
      reading: `${Math.round(v("lh"))} IU/L LH`,
      share: Math.min(1, v("lh") / (CYCLE.hormones.lh.base + CYCLE.hormones.lh.surge.amount)),
      flow: phase === "ovulation" ? 1 : QUIET_FLOW,
      say:
        phase === "ovulation"
          ? "A surge of LH from the base of the brain tells the ripest follicle to release its egg."
          : "The base of the brain keeps releasing a little LH and FSH, which tell the ovaries what to do.",
      routes: [],
    },
    {
      id: "ovaries",
      organ: "ovaries",
      label: "Ovaries",
      reading:
        phase === "luteal"
          ? `${v("progesterone").toFixed(1)} nmol/L progesterone`
          : `${Math.round(v("estradiol"))} pmol/L estrogen`,
      share: lutealShare(cycle, t),
      flow: phase === "period" ? QUIET_FLOW : 0.6,
      say:
        phase === "luteal"
          ? "The follicle that released the egg now makes progesterone, which warms the body a little."
          : "A growing follicle makes estrogen, which rebuilds the lining of the uterus.",
      routes: ["from_brain", "descending"],
    },
    {
      id: "uterus",
      organ: "uterus",
      label: "Uterus",
      reading: `Day ${cycleDay(cycle, t)}`,
      share: liningShare(cycle, t),
      flow: phase === "period" ? 0.8 : 0.4,
      say:
        phase === "period"
          ? "With progesterone gone, the lining sheds. That is the period."
          : phase === "luteal"
            ? "Progesterone keeps the lining ready. If no pregnancy starts, it falls and the lining sheds."
            : "Estrogen is thickening the lining again.",
      routes: [],
    },
  ];
  const here = phase === "period" ? "uterus" : phase === "ovulation" ? "pituitary" : "ovaries";
  const headline = `Day ${cycleDay(cycle, t)} of ${cycle.lengthDays}: ${{ period: "your period", follicular: "the follicular phase", ovulation: "around ovulation", luteal: "the luteal phase" }[phase]}`;
  return [
    {
      id: "cycle",
      title: "Menstrual cycle",
      system: "reproductive",
      substance: "other",
      active: true,
      headline,
      stops: numbered(stops, here, "ahead", true),
    },
  ];
}
