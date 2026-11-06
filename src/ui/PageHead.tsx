import { useMemo } from "react";
import { MUSCLE_LABEL } from "../model/muscleGroups";
import { modelOrigin, Origin, processOrigin, SENTENCE_ORIGIN } from "../model/origin";
import { ORGAN_NAME, systemById } from "../model/systems";
import type { Trajectory } from "../model/engine/trajectory";
import { composedOnScreen, getState, selectedProcess, useStore, yourDayWhileAsking } from "../store";
import { assessmentAt, useMinute, useMuscleMinute } from "./hooks";
import { muscleStory, organStory } from "./insets/organStory";
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
  const muscleAt = useMuscleMinute();
  // A drawing Claude composed is about the step, and the step's words are on screen beside it.
  const composed = useStore((s) => composedOnScreen(s) !== null);
  const yourDay = useStore(yourDayWhileAsking);

  const process = useMemo(() => (processId ? selectedProcess(getState()) : null), [processId, tr, minute]);

  // The same question asked of any day, so the words can be compared with your own.
  const headIn = (day: Trajectory): { title: string | null; sentence: string; origin: Origin } => {
    const assessment = assessmentAt(day, minute);
    if (focus === "muscle" && focusMuscle) {
      const story = muscleStory(focusMuscle, day, muscleAt);
      return { title: MUSCLE_LABEL[focusMuscle], sentence: story.doing, origin: modelOrigin(story.evidence, story.source) };
    }
    if (focus === "brain") return { title: systemById("brain").title, sentence: assessment.systems.brain.sentence, origin: SENTENCE_ORIGIN };
    if (focus) {
      const story = organStory(focus, day, minute);
      return { title: ORGAN_NAME[focus], sentence: story.doing, origin: modelOrigin(story.evidence, story.source) };
    }
    if (process) return { title: process.title, sentence: process.headline, origin: processOrigin(day, process) };
    if (system !== "overview") return { title: systemById(system).title, sentence: assessment.systems[system].sentence, origin: SENTENCE_ORIGIN };
    return { title: null, sentence: assessment.headline, origin: SENTENCE_ORIGIN };
  };
  const { title, sentence, origin } = headIn(tr);
  // While exploring, a sentence that would read the same on your day says nothing about the question.
  const says = !composed && !(yourDay && !process && headIn(yourDay).sentence === sentence);

  return (
    <header key={`${system}/${processId}/${focus}/${focusMuscle}`} className="page-head">
      {title ? <h1 className="page-name">{title}</h1> : null}
      {says && title ? (
        <p className="page-sentence" {...sourced(origin)}>
          {sentence}
        </p>
      ) : null}
      {says && !title ? (
        <h1 className="page-headline" {...sourced(origin)}>
          {sentence}
        </h1>
      ) : null}
    </header>
  );
}
