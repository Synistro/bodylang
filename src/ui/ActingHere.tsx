import { useMemo } from "react";
import { actingAt } from "../model/acting";
import { processOrigin } from "../model/origin";
import type { OrganId } from "../model/simulate";
import { processIdsOf } from "../model/yourDay";
import { processOnScreen, useStore, yourDayWhileAsking } from "../store";
import { useMinute } from "./hooks";
import { sourced } from "./SourceTip";

const MOST_ROWS = 4;

// Everything going on at this organ right now, in the order that matters most. The drawing above shows how
// the organ works, and this says what is acting on it today, whatever that turns out to be. While exploring,
// it is what the question added, and anything from your day only if the step names it.
export function ActingHere({ organ }: { organ: OrganId }) {
  const trajectory = useStore((s) => s.trajectory);
  const about = useStore(processOnScreen);
  const yourDay = useStore(yourDayWhileAsking);
  const minute = useMinute();
  // What the step is about always makes the list, first. Three beers are one row.
  const rows = useMemo(() => {
    const alreadyYours = yourDay ? processIdsOf(yourDay, minute) : null;
    const all = actingAt(trajectory, minute, organ).filter((row) => row.process.id === about || !alreadyYours?.has(row.process.id));
    const ordered = [...all.filter((row) => row.process.id === about), ...all.filter((row) => row.process.id !== about)];
    return ordered.filter((row, i) => ordered.findIndex((other) => other.process.title === row.process.title) === i).slice(0, MOST_ROWS);
  }, [trajectory, yourDay, minute, organ, about]);
  if (!rows.length) return null;
  return (
    <ul className="acting" aria-label="What is acting on it now" data-pointed={about !== null && rows.some((row) => row.process.id === about) ? true : undefined}>
      {rows.map(({ process, say, strength }) => (
        <li key={process.id} className="acting-row" data-about={process.id === about || undefined} style={{ "--strength": strength.toFixed(2) }} {...sourced(processOrigin(trajectory, process))}>
          <i className="acting-flow" aria-hidden="true" />
          <span className="acting-words">
            <b>{process.title}</b> {say}
          </span>
        </li>
      ))}
    </ul>
  );
}
