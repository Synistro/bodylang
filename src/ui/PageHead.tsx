import { useMemo } from "react";
import { MUSCLE_LABEL } from "../model/muscleGroups";
import { modelOrigin, Origin, processOrigin, SENTENCE_ORIGIN } from "../model/origin";
import { systemById } from "../model/systems";
import { getState, selectedProcess, useStore } from "../store";
import { assessmentAt, useMinute } from "./hooks";
import { muscleStory, organStory } from "./insets/organStory";
import { ORGAN_NAME } from "./organ";
import { sourced } from "./SourceTip";

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
  let origin: Origin = SENTENCE_ORIGIN;
  if (focus === "muscle" && focusMuscle) {
    const story = muscleStory(focusMuscle, tr, minute);
    title = MUSCLE_LABEL[focusMuscle];
    sentence = story.doing;
    origin = modelOrigin(story.evidence, story.source);
  } else if (focus) {
    const story = organStory(focus, tr, minute);
    title = ORGAN_NAME[focus];
    sentence = story.doing;
    origin = modelOrigin(story.evidence, story.source);
  } else if (process) {
    title = process.title;
    sentence = process.headline;
    origin = processOrigin(tr, process);
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
      {title ? (
        <p className="page-sentence" {...sourced(origin)}>
          {sentence}
        </p>
      ) : (
        <h1 className="page-headline" {...sourced(origin)}>
          {sentence}
        </h1>
      )}
    </header>
  );
}
