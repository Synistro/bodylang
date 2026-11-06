import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { dayContentSchema, DayContent } from "../src/model/day";
import { readout } from "../src/model/narrate";
import { simulate } from "../src/model/simulate";
import { formatClock } from "../src/model/words";
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

const NAME_MOST_CHARS = 60;

const NAME_PROMPT = `You give a question a short name, for a narrow bar at the top of a health app. The question was dictated, so fix words that were clearly misheard, such as "muscle sorrow" for muscle soreness.

Answer with only the name: 2 to 5 words saying what the question is about, in the language of the question, starting with a capital. No quotes and no punctuation at the end.

For example, "Can you explain how muscle sorrow works? I know that sportsmen don't feel it as much" is named Why athletes feel less soreness, and "what would happen to my blood sugar if I ate a big bowl of pasta right now" is named A bowl of pasta now.`;

// What comes back as a name, or null if it isn't one, in which case the question itself stays on screen.
export function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/^["'“”]+|["'“”.?!]+$/g, "").trim();
  return name && !name.includes("\n") && name.length <= NAME_MOST_CHARS ? name : null;
}

const nameRequestSchema = z.object({ text: z.string().min(1).max(4000) });

// Runs beside the answer to an Ask, and has no tools, so all it can do is come up with a few words.
export async function handleNameQuestion(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const { text } = nameRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  let answer = "";
  const run = query({
    prompt: `<question>\n${text}\n</question>`,
    options: { model: MODEL, effort: "low", maxTurns: 1, systemPrompt: NAME_PROMPT, tools: [], settingSources: [], persistSession: false, permissionMode: "dontAsk", env: cleanEnvironment() },
  });
  for await (const message of run) {
    if (message.type === "result" && message.subtype === "success") answer = message.result;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ name: cleanName(answer) }));
}

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
