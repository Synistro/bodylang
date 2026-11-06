import { useEffect, useMemo, useRef } from "react";
import { Origin, processOrigin } from "../model/origin";
import { ProcessStop, StopState } from "../model/processes/line";
import { currentProcesses, getState, setUi, useStore } from "../store";
import { organHover, scrollBehavior, useMinute } from "./hooks";
import { removeAddedProcess } from "./ProcessBuild";
import { Play } from "./icons";
import { isNumeric } from "./marks";
import { showMuscle, showOrgan } from "./navigation";
import { sourced } from "./sources";
import { parseProcessId } from "../model/ids";

// Shared with the scene through the store's cache, so both read one list per minute.
function useProcesses() {
  const tr = useStore((s) => s.trajectory);
  const minute = useMinute();
  return useMemo(() => currentProcesses(getState()), [tr, minute]);
}

interface RailLine {
  depth: number;
  state: StopState;
}

interface StopRow {
  stop: ProcessStop;
  depth: number;
  // Set when this stop splits off an earlier one, so the line bends in from that stop's column.
  branchFrom: number | null;
  incoming: boolean;
  outgoing: RailLine | null;
  through: RailLine[];
}

// Turns the flat stop list into a drawn line: which column each stop sits in, and which segments
// pass behind each row on their way to a later branch.
function layoutStops(stops: ProcessStop[]): StopRow[] {
  const indexOf = new Map(stops.map((s, i) => [s.id, i]));
  const parentIndex = (i: number) => {
    const from = stops[i].from;
    return from === null ? i - 1 : (indexOf.get(from) ?? i - 1);
  };
  const isBranch = (i: number) => {
    const from = stops[i].from;
    if (from === null) return false;
    return parentIndex(i) !== i - 1 || stops.filter((s) => s.from === from).length > 1;
  };
  const depths: number[] = [];
  stops.forEach((_, i) => {
    const parent = parentIndex(i);
    depths[i] = parent < 0 ? 0 : depths[parent] + (isBranch(i) ? 1 : 0);
  });
  const rows: StopRow[] = stops.map((stop, i) => ({
    stop,
    depth: depths[i],
    branchFrom: isBranch(i) ? depths[parentIndex(i)] : null,
    incoming: i > 0 && !isBranch(i),
    outgoing: null,
    through: [],
  }));
  stops.forEach((stop, i) => {
    const parent = parentIndex(i);
    if (parent < 0) return;
    const line: RailLine = { depth: depths[parent], state: stop.state };
    rows[parent].outgoing = rows[parent].outgoing ?? line;
    for (let k = parent + 1; k < i; k++) {
      if (!rows[k].through.some((t) => t.depth === line.depth)) rows[k].through.push(line);
    }
  });
  return rows;
}

function StopItem({
  row,
  spotlight,
  touring,
  origin,
}: {
  row: StopRow;
  spotlight: number | null;
  touring: boolean;
  origin: Origin;
}) {
  const { stop } = row;
  const on = spotlight === stop.number;
  const el = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (on) el.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [on]);

  // First click puts the stop in the spotlight. A click on the spotlit stop goes inside it.
  const press = () => {
    if (!on || touring) setUi({ stop: stop.number });
    else if (stop.muscle) showMuscle(stop.muscle);
    else if (stop.organ) showOrgan(stop.organ);
  };

  return (
    <li ref={el} className="stop" data-on={on || undefined} data-state={stop.state} style={{ "--depth": row.depth }}>
      <span className="stop-rail" aria-hidden="true">
        {row.through.map((line) => (
          <i
            key={line.depth}
            className="stop-line"
            data-part="through"
            data-state={line.state}
            style={{ "--at": line.depth }}
          />
        ))}
        {row.incoming ? (
          <i className="stop-line" data-part="in" data-state={stop.state} style={{ "--at": row.depth }} />
        ) : null}
        {row.branchFrom !== null ? (
          <i className="stop-elbow" data-state={stop.state} style={{ "--at": row.branchFrom }} />
        ) : null}
        {row.outgoing ? (
          <i className="stop-line" data-part="out" data-state={row.outgoing.state} style={{ "--at": row.depth }} />
        ) : null}
      </span>
      <button
        type="button"
        className="stop-button"
        aria-pressed={on}
        aria-label={`Stop ${stop.number}, ${stop.label}${stop.reading ? `, ${stop.reading}` : ""}`}
        onClick={press}
        {...organHover(stop.organ)}
      >
        <span className="stop-face" data-state={stop.state} data-on={on || undefined}>
          {stop.number}
        </span>
        <span className="stop-label">{stop.label}</span>
        {stop.reading && stop.state !== "passed" ? (
          <span className="stop-reading" data-numeric={isNumeric(stop.reading) || undefined} {...sourced(origin)}>
            {stop.reading}
          </span>
        ) : null}
      </button>
      {on && !touring && stop.say ? (
        <p className="stop-say" {...sourced(origin)}>
          {stop.say}
        </p>
      ) : null}
    </li>
  );
}

// One process: its numbered line and the walkthrough. Its sentence is under the clock.
export function ProcessDetail({ processId }: { processId: string }) {
  const processes = useProcesses();
  const spotlight = useStore((s) => s.stop);
  const touring = useStore((s) => s.touring);
  const process = processes.find((p) => p.id === processId);
  const tr = useStore((s) => s.trajectory);
  const rows = useMemo(() => (process ? layoutStops(process.stops) : []), [process]);
  if (!process) return null;
  const origin = processOrigin(tr, process);
  return (
    <div>
      <ol className="stops" aria-label={`Stops of ${process.title}`}>
        {rows.map((row) => (
          <StopItem key={row.stop.id} row={row} spotlight={spotlight} touring={touring} origin={origin} />
        ))}
      </ol>
      {rows.length > 1 && !touring ? (
        <button
          type="button"
          className="action walk"
          onClick={() => setUi({ touring: true, stop: process.stops[0].number })}
        >
          <Play weight="fill" />
          Walk me through it
        </button>
      ) : null}
      {parseProcessId(process.id).kind === "ext" ? (
        <button type="button" className="link remove-process" onClick={() => void removeAddedProcess(process.id)}>
          Remove this process
        </button>
      ) : null}
    </div>
  );
}
