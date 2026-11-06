import type { MuscleGroup } from "../model/muscleGroups";
import type { OrganId, SystemId } from "../model/ids";
import { dispatch, getState, setUi } from "../store";

// Four levels, each hidden until asked for: the whole body, one system, one process, one organ.
// These are the only moves between them, shared by the path, Esc, the canvas and the panels.

export const showSystem = (system: SystemId) => dispatch({ name: "show_system", args: { system } });

export const showProcess = (id: string | null) => dispatch({ name: "show_process", args: { id } });

export const showOrgan = (organ: OrganId | null) => dispatch({ name: "focus_organ", args: { organ } });

export const showMuscle = (muscle: MuscleGroup) => dispatch({ name: "focus_organ", args: { organ: "muscle", muscle } });

export function goUp() {
  const s = getState();
  if (s.touring) setUi({ touring: false, stop: null });
  else if (s.view.focus) showOrgan(null);
  else if (s.stop !== null) setUi({ stop: null });
  else if (s.view.process) showProcess(null);
  else if (s.view.system !== "overview") showSystem("overview");
}
