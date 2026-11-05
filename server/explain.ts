import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { dayContentSchema, DayContent } from "../src/model/day";
import { readout } from "../src/model/narrate";
import { simulate } from "../src/model/simulate";
import { formatClock } from "../src/model/state";
import { cleanEnvironment } from "./claudeEnv";

const MODEL = process.env.BODYLANG_EXPLAIN_MODEL ?? "claude-haiku-5-5";
const MAX_REQUEST_BYTES = 200_000;

// Someone selected a few words on screen, wanting to know what they mean. This session has no tools at
// all, so it can only talk: it can't change the day, and nothing it says is saved.
const SYSTEM_PROMPT = `You explain terms inside Bodylang, a 3D simulation of one person's body. They selected a few words in the text on screen because they want to know what those words mean. They have no medical training.

Your first answer says what the selected words are, as used in the sentence around them, in one plain sentence of under 25 words. Start directly with the explanation. Spell out an abbreviation first, such as "TRH (thyrotropin-releasing hormone) is the signal...".

If they ask a follow-up, answer that, in under 50 words unless they ask for more.

Write plain text with no markdown, lists or headings. Don't offer further help or end on a question.

Their numbers below come from the simulation of a typical body with their measurements. Use them only when they ask about themselves, and use no other number about them. General facts are from your own knowledge. Say "you may feel", never "you should feel". Never diagnose them or recommend a dose. If they describe an emergency or wanting to harm themselves, tell them to get help now.`;

const turnSchema = z.object({ role: z.enum(["you", "claude"]), text: z.string().max(2000) });

const requestSchema = z.object({
  term: z.string().min(1).max(300),
  around: z.string().max(1200),
  page: z.string().max(200),
  turns: z.array(turnSchema).max(20),
  now: z.number(),
  day: dayContentSchema,
});

export type ExplainRequest = Omit<z.infer<typeof requestSchema>, "day"> & { day: DayContent };

// What the model is told for one question, as one document it can read top to bottom.
export function renderExplainPrompt({ term, around, page, turns, now, day }: ExplainRequest): string {
  const { body, intakes, activities, substances, events, cycle } = day;
  const numbers = readout(simulate({ body, intakes, activities, substances, events, cycle }), now);
  const said = turns.map((turn) => `${turn.role === "you" ? "They asked" : "You answered"}: ${turn.text}`).join("\n");
  return `<simulation time="${formatClock(now)}">
${JSON.stringify(numbers)}
</simulation>

They are looking at: ${page || "the whole body"}.
The text around what they selected: ${around}
They selected: ${term}
${said ? `\n${said}\n` : ""}
${turns.at(-1)?.role === "you" ? "Answer what they just asked." : "Explain what they selected."}`;
}

async function readRequest(req: IncomingMessage): Promise<ExplainRequest> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request too large");
    chunks.push(buffer);
  }
  // Past their common fields, a day's events are taken as the app wrote them, as they are from a day file.
  return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))) as unknown as ExplainRequest;
}

export async function handleExplain(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const request = await readRequest(req);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });
  const started = performance.now();
  let firstMs: number | null = null;
  try {
    const run = query({
      prompt: renderExplainPrompt(request),
      options: {
        model: MODEL,
        effort: "low",
        maxTurns: 1,
        systemPrompt: SYSTEM_PROMPT,
        tools: [],
        includePartialMessages: true,
        settingSources: [],
        persistSession: false,
        permissionMode: "dontAsk",
        env: cleanEnvironment(),
        abortController,
      },
    });
    for await (const message of run) {
      if (message.type === "stream_event" && message.event.type === "content_block_delta" && message.event.delta.type === "text_delta") {
        firstMs ??= Math.round(performance.now() - started);
        send({ type: "text", text: message.event.delta.text });
      }
      if (message.type === "result") {
        console.log(`[bodylang] explained "${request.term}": first words at ${firstMs ?? "-"} ms, done at ${Math.round(performance.now() - started)} ms, $${message.total_cost_usd.toFixed(4)}`);
        if (message.subtype !== "success") send({ type: "error", message: `Claude stopped early: ${message.subtype}.` });
      }
    }
  } catch (e: unknown) {
    if (!abortController.signal.aborted) send({ type: "error", message: `Claude Code could not run: ${e instanceof Error ? e.message : String(e)}` });
  }
  send({ type: "done" });
  res.end();
}
