import { z } from "zod";
import { ACTION_SCHEMAS, Action, ActionName } from "../actions/actions";
import { stayAwake } from "../model/day";
import { beginExchange, clearWhatIf, dispatch, enterAsk, getState, leaveAsk, rememberAsked, setAskCancel, updateExchange } from "../store";

const replyEvent = z.object({
  type: z.literal("reply"),
  lines: z.array(z.object({ text: z.string(), organ: z.string().optional(), unverified: z.array(z.string()).optional() })),
});
const actionEvent = z.object({ type: z.literal("action"), name: z.string(), args: z.unknown() });
const errorEvent = z.object({ type: z.literal("error"), message: z.string() });
const doneEvent = z.object({ type: z.literal("done") });
const streamEvent = z.discriminatedUnion("type", [replyEvent, actionEvent, errorEvent, doneEvent]);

function isActionName(name: string): name is ActionName {
  return name in ACTION_SCHEMAS;
}

function parseAction(name: string, args: unknown): Action {
  if (!isActionName(name)) throw new Error(`Unknown action ${name}`);
  return { name, args: ACTION_SCHEMAS[name].parse(args) } as Action;
}

const NAME_FROM_WORDS = 7;
const nameSchema = z.object({ name: z.string().nullable() });

// A long question gets a short name for the bar at the top, asked for beside the answer so neither waits
// for the other. It only tidies the display, so without one the question itself just stays there.
async function nameQuestion(id: number, text: string) {
  if (text.trim().split(/\s+/).length < NAME_FROM_WORDS) return;
  try {
    const response = await fetch("/api/name-question", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok) return;
    const { name } = nameSchema.parse(await response.json());
    if (name) updateExchange(id, { name });
  } catch {
    // The full question is still on screen.
  }
}

// Sends the sentence and the body it is about to the local Claude Code bridge, and applies each tool
// call to the store as it streams back, so the body changes while Claude is still thinking.
//
// In Tell mode that body is your real day. In Ask mode it is a copy, and if you leave before the answer
// is finished, whatever is still on its way is dropped, so it can never land on your real day.
export async function tell(text: string) {
  const { mode } = getState();
  const session = mode === "ask" ? enterAsk() : null;
  if (mode === "tell") leaveAsk();
  // A suggestion belongs to the answer it came with. Claude can offer a new one.
  clearWhatIf();
  const id = beginExchange(text);
  if (session !== null) void nameQuestion(id, text);
  const before = getState();
  const awake = mode === "tell" && before.date ? stayAwake(before.body.activities, before.body.now) : null;
  if (awake) dispatch({ name: "set_activity", args: awake });
  const s = getState();
  const stop = new AbortController();
  if (session !== null) setAskCancel(() => stop.abort());
  const stillAsking = () => session === null || getState().asking?.id === session;
  try {
    const response = await fetch("/api/tell", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, state: s.body, mode, depth: s.depth, history: s.asking?.history ?? [], date: s.date }),
      signal: stop.signal,
    });
    if (!response.ok || !response.body) throw new Error(`The Claude Code bridge answered ${response.status}.`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let replied = false;
    let failed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        if (!chunk.startsWith("data: ")) continue;
        if (!stillAsking()) return;
        const event = streamEvent.parse(JSON.parse(chunk.slice(6)));
        switch (event.type) {
          case "action":
            dispatch(parseAction(event.name, event.args), id);
            break;
          case "reply":
            replied = true;
            updateExchange(id, { reply: event.lines as Exchange["reply"], status: "done" });
            if (session !== null) rememberAsked(text, event.lines.map((line) => line.text).join(" "));
            break;
          case "error":
            failed = true;
            // A late failure adds nothing to an answer that is already on screen.
            if (!replied) updateExchange(id, { status: "error", error: event.message });
            break;
          case "done":
            break;
          default: {
            const exhaustive: never = event;
            throw new Error(`Unhandled event ${String(exhaustive)}`);
          }
        }
      }
    }
    if (!replied && !failed && stillAsking()) updateExchange(id, { status: "error", error: "Claude finished without an answer. Try saying it again." });
  } catch (e: unknown) {
    // Past a failure this page stops following the stream, so the server shouldn't keep working or paying.
    stop.abort();
    // Leaving stops the request on purpose, and there is nothing left to say about it.
    if (!stillAsking()) {
      updateExchange(id, { status: "done" });
      return;
    }
    updateExchange(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (stillAsking()) setAskCancel(null);
    if (!stillAsking()) updateExchange(id, { status: "done" });
  }
}

type Exchange = ReturnType<typeof getState>["exchanges"][number];
