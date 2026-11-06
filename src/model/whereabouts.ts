import { caffeineLedgerAt, intakeFlowsAt, ledgerAt, Trajectory } from "./engine/trajectory";
import type { OrganId } from "./ids";
import { PROCESS } from "./params";
import { foodKcalOf, Intake } from "./scenario";

export interface Whereabouts {
  id: string;
  label: string;
  at: number;
  unit: "kcal" | "mg";
  total: number;
  places: { key: string; label: string; amount: number; share: number; organ: OrganId | null }[];
}

const PLACE_LABEL: Record<string, { label: string; organ: OrganId | null }> = {
  stomach: { label: "Stomach", organ: "stomach" },
  intestine: { label: "Intestine", organ: "small_intestine" },
  blood: { label: "Blood", organ: "heart" },
  liver: { label: "Liver", organ: "liver" },
  muscle: { label: "Muscle", organ: "muscle" },
  fat: { label: "Fat", organ: "fat" },
  burned: { label: "Burned", organ: null },
  colon: { label: "Colon", organ: "large_intestine" },
  cleared: { label: "Cleared by liver", organ: "liver" },
};

// Whether something from yesterday is still on its way anywhere, or has long since arrived.
function stillMoving(tr: Trajectory, intake: Intake, t: number): boolean {
  const food = ledgerAt(tr, intake.id, t);
  const caffeine = caffeineLedgerAt(tr, intake.id, t);
  return (food ? food.stomach + food.intestine + food.blood : 0) > foodKcalOf(intake) * PROCESS.heldInStomachShare || (caffeine ? caffeine.stomach + caffeine.intestine + caffeine.blood : 0) > intake.caffeineMg * PROCESS.heldInStomachShare;
}

// "Where is my pizza right now?" — reads straight from the model's conserved ledgers.
export function whereabouts(tr: Trajectory, t: number): Whereabouts[] {
  const out: Whereabouts[] = [];
  for (const intake of tr.scenario.intakes) {
    if (intake.at > t) continue;
    if (intake.at < 0 && !stillMoving(tr, intake, t)) continue;
    const kcal = foodKcalOf(intake);
    const caffeine = caffeineLedgerAt(tr, intake.id, t);
    if (caffeine && kcal < 30) {
      const places = (["stomach", "intestine", "blood", "cleared"] as const).map((key) => ({ key, amount: caffeine[key] }));
      out.push(entry(intake.id, intake.label, intake.at, "mg", caffeine.dose, places));
      continue;
    }
    const l = ledgerAt(tr, intake.id, t);
    if (!l) continue;
    const places = (["stomach", "intestine", "blood", "liver", "muscle", "fat", "burned", "colon"] as const).map((key) => ({ key, amount: l[key] }));
    out.push(entry(intake.id, intake.label, intake.at, "kcal", kcal, places));
  }
  return out;
}

function entry(id: string, label: string, at: number, unit: "kcal" | "mg", total: number, places: { key: string; amount: number }[]): Whereabouts {
  return {
    id,
    label,
    at,
    unit,
    total,
    places: places
      .filter((p) => p.amount > total * 0.004)
      .map((p) => ({ ...p, label: PLACE_LABEL[p.key].label, organ: PLACE_LABEL[p.key].organ, share: p.amount / total }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// The intakes behind a rate right now, biggest first, leaving out the ones barely contributing.
function contributors(intakes: Intake[], rateOf: (intake: Intake) => number, floor: number): string[] {
  const rated = intakes.map((intake) => ({ intake, rate: rateOf(intake) })).filter((r) => r.rate > 0);
  const total = rated.reduce((sum, r) => sum + r.rate, 0);
  if (total < floor) return [];
  return rated
    .filter((r) => r.rate >= total * PROCESS.contributorShare)
    .sort((a, b) => b.rate - a.rate)
    .map((r) => r.intake.label);
}

export function arrivingFoods(tr: Trajectory, t: number, nutrient: "carbs" | "fat"): string[] {
  const rateOf = (intake: Intake) => {
    const flows = intakeFlowsAt(tr, intake.id, t);
    if (!flows) return 0;
    return nutrient === "carbs" ? flows.carbsAbsorbedPerMin : flows.fatAbsorbedPerMin;
  };
  return contributors(tr.scenario.intakes.filter((i) => i.at <= t), rateOf, PROCESS.arrivingAboveGPerMin);
}

export function foodsInStomach(tr: Trajectory, t: number): string[] {
  const rateOf = (intake: Intake) => {
    const held = ledgerAt(tr, intake.id, t)?.stomach ?? 0;
    return held > foodKcalOf(intake) * PROCESS.heldInStomachShare ? held : 0;
  };
  return contributors(tr.scenario.intakes.filter((i) => i.at <= t), rateOf, 1);
}
