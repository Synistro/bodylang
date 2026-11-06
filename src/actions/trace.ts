import { SEX_LABEL } from "../model/events/types";
import { CYCLE } from "../model/params";
import { formatClock } from "../model/words";
import { Action } from "./schemas";

// One compact line per call, shown under the person's message while the body responds.
export function traceLine(action: Action): string {
  const clock = formatClock;
  switch (action.name) {
    case "log_intake": {
      const a = action.args;
      const kcal = Math.round(Math.max(0, a.carbs_g - a.fiber_g) * 4 + a.fat_g * 9 + a.protein_g * 4 + a.alcohol_g * 7);
      return `log_intake ${a.label}, ${clock(a.at)}, ${a.caffeine_mg > 0 && kcal < 30 ? `${a.caffeine_mg} mg caffeine` : `${kcal} kcal`}`;
    }
    case "correct_intake": {
      const { id, grams, at } = action.args;
      return `correct_intake ${id}${grams === undefined ? "" : `, ${Math.round(grams)} g`}${at === undefined ? "" : `, at ${clock(at)}`}`;
    }
    case "remove_intake":
      return `remove_intake ${action.args.id}`;
    case "set_activity":
      return `set_activity ${action.args.posture}, from ${clock(action.args.from)}`;
    case "set_sleep":
      return `set_sleep ${clock(action.args.bed)} to ${clock(action.args.wake)}`;
    case "set_cycle":
      return action.args.last_start === null
        ? "set_cycle none"
        : `set_cycle period began ${clock(action.args.last_start)}, ${action.args.length_days ?? CYCLE.lengthDays} days`;
    case "set_body":
      return `set_body ${Object.entries(action.args)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`;
    case "set_now":
      return `set_now ${clock(action.args.at)}`;
    case "define_substance":
      return `define_substance ${action.args.label}, ${action.args.dose_mg} mg, half-life ${action.args.half_life_h} h`;
    case "log_event": {
      const a = action.args;
      return `log_event ${a.preset === "sex" ? SEX_LABEL : a.label}, ${a.preset}, ${clock(a.from)}${a.until === null ? ", ongoing" : ` to ${clock(a.until)}`}`;
    }
    case "end_event":
      return `end_event ${action.args.id}, ${clock(action.args.at)}`;
    case "show_system":
      return `show_system ${action.args.system}`;
    case "show_process":
      return `show_process ${action.args.id ?? "none"}`;
    case "focus_organ":
      return `focus_organ ${action.args.muscle ?? action.args.organ ?? "whole body"}`;
    case "guide":
      return `guide, ${action.args.steps.length} steps`;
    case "what_if":
      return `what_if ${action.args.label}`;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
