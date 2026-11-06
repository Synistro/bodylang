import type { MuscleState } from "../../model/events/types";
import { MUSCLE_RECOVERY, REFERENCE } from "../../model/params";

// Where a muscle is in recovery, in one plain sentence. `peakAhead` says soreness is still to come.
export function recoverySentence(now: MuscleState, peakAhead: boolean, worked: boolean): string {
  const r = REFERENCE.muscleState;
  if (now.work >= r.workingFrom) return "Working now, pulling in sugar from your blood.";
  if (peakAhead && now.soreness >= r.soreFrom) return "Healing its tiny tears, with soreness still building.";
  if (peakAhead && now.repair >= r.repairingFrom) return "Rebuilding fast, with soreness still to come.";
  if (now.soreness >= r.soreFrom) return "Past its worst, with the tiny tears closing.";
  if (now.repair >= r.repairingFrom) return "Nearly healed, still rebuilding.";
  if (now.fatigue >= r.tiredFrom) return "Still a little short of full strength.";
  if (now.soreness >= MUSCLE_RECOVERY.activeAbove || now.repair >= MUSCLE_RECOVERY.activeAbove)
    return "Almost back to normal.";
  return worked ? "Fully recovered." : "Rested, with nothing logged lately.";
}
