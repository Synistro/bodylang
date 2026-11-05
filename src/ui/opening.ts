import { Action } from "../agent/actions";
import { openingReply } from "../model/narrate";
import { beginExchange, dispatch, getState, setUi, updateExchange } from "../store";

const OPENING_MESSAGE =
  "It's 5 pm. 15 minutes ago I ate a sugar bar with pizza, and I had coffee this morning. Is the coffee still working? What's happening in my body now, where does it all go, and what should I feel? I'm sitting.";

const NOW = 17 * 60;

// The same calls Claude makes for this sentence, replayed so the page opens in a working state
// without spending a model call. Anything typed afterwards goes to Claude for real.
const OPENING_ACTIONS: Action[] = [
  { name: "set_now", args: { at: NOW } },
  { name: "log_intake", args: { id: "coffee", label: "Coffee", at: 510, grams: 250, water_ml: 245, carbs_g: 0, sugar_g: 0, fat_g: 0, protein_g: 0, fiber_g: 0, caffeine_mg: 95, alcohol_g: 0, liquid: true, assumption: "One 250 ml cup at 08:30" } },
  { name: "log_intake", args: { id: "sugar_bar", label: "Sugar bar", at: 1005, grams: 50, water_ml: 3, carbs_g: 31, sugar_g: 27, fat_g: 12, protein_g: 4, fiber_g: 1, caffeine_mg: 0, alcohol_g: 0, liquid: false, assumption: "A 50 g chocolate bar" } },
  { name: "log_intake", args: { id: "pizza", label: "Pizza", at: 1005, grams: 240, water_ml: 110, carbs_g: 72, sugar_g: 8, fat_g: 26, protein_g: 28, fiber_g: 4, caffeine_mg: 0, alcohol_g: 0, liquid: false, assumption: "Two slices, about 240 g" } },
  { name: "set_activity", args: { posture: "sitting", from: 480 } },
];

const STEP_MS = 240;
const SWEEP_MS = 1900;
const SWEEP_FROM = 7 * 60 + 30;

export function playOpening() {
  if (getState().exchanges.length) return;
  const id = beginExchange(OPENING_MESSAGE, true);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finish = () => {
    const s = getState();
    const reply = openingReply(s.trajectory, NOW);
    updateExchange(id, { reply, status: "done" });
  };

  if (reduced) {
    for (const a of OPENING_ACTIONS) dispatch(a, id);
    finish();
    return;
  }

  let i = 0;
  const next = () => {
    if (i < OPENING_ACTIONS.length) {
      dispatch(OPENING_ACTIONS[i++], id);
      if (i === 1) setUi({ t: SWEEP_FROM });
      window.setTimeout(next, STEP_MS);
      return;
    }
    const start = performance.now();
    const sweep = (now: number) => {
      const k = Math.min(1, (now - start) / SWEEP_MS);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setUi({ t: SWEEP_FROM + (NOW - SWEEP_FROM) * eased });
      if (k < 1) requestAnimationFrame(sweep);
      else finish();
    };
    requestAnimationFrame(sweep);
  };
  next();
}
