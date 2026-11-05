import { useMemo } from "react";
import { MUSCLE_LABEL } from "../model/muscleGroups";
import { systemById } from "../model/systems";
import { getState, selectedProcess, useStore } from "../store";
import { assessmentAt, useMinute } from "./hooks";
import { muscleStory, organStory } from "./insets/organStory";
import { ORGAN_NAME } from "./organ";

// The head of the page: the name of what you are looking at, and one sentence on how it is. The
// overview has no name of its own, only the sentence.
export function PageHead() {
  const tr = useStore((s) => s.trajectory);
  const system = useStore((s) => s.body.system);
  const processId = useStore((s) => s.body.process);
  const focus = useStore((s) => s.body.focus);
  const focusMuscle = useStore((s) => s.body.focusMuscle);
  const minute = useMinute();

  const process = useMemo(() => (processId ? selectedProcess(getState()) : null), [processId, tr, minute]);
  const assessment = assessmentAt(tr, minute);

  let title: string | null;
  let sentence: string;
  if (focus === "muscle" && focusMuscle) {
    title = MUSCLE_LABEL[focusMuscle];
    sentence = muscleStory(focusMuscle, tr, minute).doing;
  } else if (focus) {
    title = ORGAN_NAME[focus];
    sentence = organStory(focus, tr, minute).doing;
  } else if (process) {
    title = process.title;
    sentence = process.headline;
  } else if (system !== "overview") {
    title = systemById(system).title;
    sentence = assessment.systems[system].sentence;
  } else {
    title = null;
    sentence = assessment.headline;
  }

  return (
    <header key={`${system}/${processId}/${focus}/${focusMuscle}`} className="page-head">
      {title ? <h1 className="page-name">{title}</h1> : null}
      {title ? <p className="page-sentence">{sentence}</p> : <h1 className="page-headline">{sentence}</h1>}
    </header>
  );
}
