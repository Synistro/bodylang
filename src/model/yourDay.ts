import { processesAt } from "./processes";
import type { Trajectory } from "./simulate";

// What is already going on in your day at this minute, by process id. While exploring, anything in here isn't
// news, however true it is, and everything else is what the question added.
export const processIdsOf = (yourDay: Trajectory, minute: number) => new Set(processesAt(yourDay, minute).map((process) => process.id));
