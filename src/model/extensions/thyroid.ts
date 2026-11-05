import type { BodyView, ExtensionState, ExtensionStop, ProcessExtension } from "./api";

// Every tunable number. Typical adult levels are mid-range reference values; the couplings to the
// clock, to night waking and to illness are Claude's estimates shaped on the studies in `source`.
const params = {
  tshMeanMuL: 1.5, // typical adult TSH, mU/L
  tshSwing: 0.35, // share TSH swings above and below its mean across the day
  tshPeakHour: 2.5, // night surge, about 02:00 to 03:00
  trhLeadH: 1, // TRH from the hypothalamus leads TSH (estimate)
  nightWakeBoost: 0.3, // extra TSH when awake at night, since sleep damps the surge
  nightFromHour: 22,
  nightUntilHour: 6,
  freeT4NgDl: 1.2, // typical free T4, ng/dL; half-life about a week, so nearly flat in a day
  freeT3PgMl: 3.2, // typical free T3, pg/mL
  t3Swing: 0.08, // small daily swing of T3
  t3LagH: 1.5, // T3 follows TSH by about 90 minutes
  illnessT3Drop: 0.3, // share T3 falls at full inflammation (estimate for a short illness)
  illnessTshDrop: 0.25, // share TSH falls at full inflammation (estimate)
  illnessT4Drop: 0.08, // share free T4 falls at full inflammation (estimate)
  illnessFrom: 0.15, // inflammation above which conversion is the place to watch
  surgeFromShare: 0.5, // TSH above this share of its swing counts as the night rise
  hrScaleBpm: 180, // heart rate drawn as a full line
  kcalScale: 600, // burn per hour drawn as a full line
} as const;

const hourOf = (minute: number) => (((minute / 60) % 24) + 24) % 24;
const wave = (minute: number, peakHour: number) => Math.cos((2 * Math.PI * (hourOf(minute) - peakHour)) / 24);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function awakeAtNight(view: BodyView, minute: number) {
  const h = hourOf(minute);
  const night = h >= params.nightFromHour || h < params.nightUntilHour;
  return night && view.value("posture", minute) > 0.5;
}

function at(view: BodyView, minute: number): ExtensionState {
  const inflammation = clamp01(view.value("inflammation", minute));
  const nightBoost = awakeAtNight(view, minute) ? params.nightWakeBoost : 0;

  const trhRel = 1 + params.tshSwing * wave(minute, params.tshPeakHour - params.trhLeadH);
  const tshRel = (1 + params.tshSwing * wave(minute, params.tshPeakHour) + nightBoost) * (1 - params.illnessTshDrop * inflammation);
  const tsh = params.tshMeanMuL * tshRel;
  const t4 = params.freeT4NgDl * (1 - params.illnessT4Drop * inflammation);
  const t3Rel = (1 + params.t3Swing * wave(minute, params.tshPeakHour + params.t3LagH)) * (1 - params.illnessT3Drop * inflammation);
  const t3 = params.freeT3PgMl * t3Rel;
  const hr = view.value("hr", minute);
  const kcal = view.value("kcalPerHour", minute);

  const trhShare = clamp01(trhRel / (1 + params.tshSwing));
  const tshShare = clamp01(tshRel / (1 + params.tshSwing + params.nightWakeBoost));
  const t3Share = clamp01(t3Rel / (1 + params.t3Swing));
  const surging = tshRel > 1 + params.tshSwing * params.surgeFromShare;
  const ill = inflammation >= params.illnessFrom;

  const stops: ExtensionStop[] = [
    {
      id: "hypothalamus",
      organ: "brain",
      label: "Hypothalamus",
      reading: trhRel > 1 ? "TRH higher" : "TRH lower",
      share: trhShare,
      flow: trhShare,
      say: trhRel > 1 ? "A deep part of the brain sends more TRH now, as it does through the night." : "A deep part of the brain sends less TRH in the daytime.",
      routes: [],
    },
    {
      id: "pituitary",
      organ: "brain",
      label: "Pituitary",
      reading: `${tsh.toFixed(2)} mU/L`,
      share: tshShare,
      flow: trhShare,
      say:
        nightBoost > 0
          ? "Being awake at night lets TSH climb higher, since sleep usually holds the night rise down."
          : surging
            ? "The pituitary answers TRH with its night rise in TSH, which calls on the thyroid."
            : "The pituitary releases less TSH now, and it eases off whenever thyroid hormone runs high.",
      routes: [],
    },
    {
      id: "thyroid",
      organ: null,
      label: "Thyroid",
      reading: `T4 ${t4.toFixed(2)} ng/dL`,
      share: clamp01(t4 / params.freeT4NgDl),
      flow: tshShare,
      say: "The gland in your neck uses iodine to make mostly T4. T4 lasts about a week, so it barely moves today.",
      routes: ["to_neck"],
    },
    {
      id: "heart",
      organ: "heart",
      label: "Heart",
      reading: `${Math.round(hr)} bpm`,
      share: clamp01(hr / params.hrScaleBpm),
      flow: t3Share,
      say: "T3 helps set your resting heart pace. This heart rate comes from the model, which doesn't link it to thyroid levels.",
      routes: ["from_brain"],
    },
    {
      id: "liver",
      organ: "liver",
      label: "Conversion",
      reading: `T3 ${t3.toFixed(2)} pg/mL`,
      share: t3Share,
      flow: t3Share,
      say: ill
        ? "During illness the liver and tissues turn less T4 into active T3, so T3 dips for a while."
        : "The liver and other tissues snip one iodine off T4 to make T3, the active form.",
      routes: ["arch", "descending"],
    },
    {
      id: "tissues",
      organ: "muscle",
      label: "Metabolism",
      reading: `${Math.round(kcal)} kcal/h`,
      share: clamp01(kcal / params.kcalScale),
      flow: t3Share,
      say: "T3 sets how fast cells burn fuel. The model's burn rate here ignores the small daily T3 swing.",
      routes: ["arch", "descending"],
      from: "heart",
    },
  ];

  const headline = ill
    ? "Illness is lowering active T3 for now; T4 stays steady."
    : nightBoost > 0
      ? "Awake at night, so TSH is rising higher than in sleep."
      : surging
        ? "TSH is in its night rise; thyroid levels stay steady."
        : "Thyroid hormone is steady, held in place by feedback.";

  return { active: true, headline, here: ill ? "liver" : surging || nightBoost > 0 ? "pituitary" : "thyroid", stops };
}

export const extension: ProcessExtension = {
  id: "thyroid",
  title: "Thyroid",
  system: "energy",
  evidence: "C",
  source:
    "Typical adult TSH, free T4 and free T3 are mid-range laboratory reference values. The night TSH surge near 02:00-03:00, and its rise when sleep is lost, follow Brabant et al. 1990 (J Clin Endocrinol Metab) and Parker et al. 1987. T3 trailing TSH by about 90 minutes follows Russell et al. 2008. The fall of T3 in illness, from slower T4-to-T3 conversion, follows the review by Fliers, Bianco, Langouche and Boelen (Lancet Diabetes Endocrinol 2015). The sizes of the swing and the illness drop are Claude's estimates. The model has no thyroid of its own: these levels follow its clock, posture and inflammation, and its heart rate and burn rate do not respond to them. Iodine intake, slow feedback over weeks and thyroid disease are left out.",
  params,
  at,
};
