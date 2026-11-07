import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { BodyState } from "../src/actions/reduce";
import { DATE_PATTERN, dayContentSchema } from "../src/model/day";
import { BuildStatus, TellEvent } from "../src/wire";
import { openEventStream, readJson } from "./http";
import type { Notify } from "./http";
import { runFailure } from "./llm";
import { runLlm } from "./runLlm";
import { planFor, TellPlan } from "./tellPrompt";
import { startTurn, TellInput } from "./tellTurn";

const MAX_TURNS = 14;
const MAX_REQUEST_BYTES = 200_000;

const bodyStateShape = z.object({
  day: dayContentSchema,
  now: z.number(),
  view: z.looseObject({ system: z.string(), process: z.string().nullable() }),
});

const requestSchema = z.object({
  text: z.string().min(1).max(4000),
  state: z.custom<BodyState>((v) => bodyStateShape.safeParse(v).success, "Not a body state"),
  mode: z.enum(["tell", "ask"]).default("tell"),
  depth: z.enum(["simple", "deep"]).default("simple"),
  history: z
    .array(z.object({ asked: z.string().max(4000), answered: z.string().max(4000) }))
    .max(10)
    .default([]),
  date: z.string().regex(DATE_PATTERN).nullable().default(null),
});

export interface TellMeasure {
  subtype: string;
  totalMs: number;
  firstOutputMs: number | null; // when the first model started answering, which shows what starting up costs
  firstActionMs: number | null; // when something first changed on screen
  replyMs: number | null;
  turns: number;
  costUsd: number;
  usage: string;
}

export async function handleTell(req: IncomingMessage, res: ServerResponse, { buildChanged }: Notify) {
  const input = requestSchema.parse(await readJson(req, MAX_REQUEST_BYTES));
  const stream = openEventStream(res);
  const measured = await runTell(input, planFor(input.mode, input.depth), stream.send, stream.stopped, buildChanged);
  console.log(
    `[bodylang] ${measured.subtype} in ${measured.totalMs} ms, first thing on screen at ${measured.firstActionMs ?? "-"} ms, ${measured.turns} turns, ${measured.usage}`,
  );
  res.end();
}

// One message, from the sentence to the answer, with each change sent on as it happens.
export async function runTell(
  input: TellInput,
  plan: TellPlan,
  emit: (event: TellEvent) => void,
  abort: AbortController,
  buildChanged: (status: BuildStatus) => void,
): Promise<TellMeasure> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const measure: TellMeasure = {
    subtype: "success",
    totalMs: 0,
    firstOutputMs: null,
    firstActionMs: null,
    replyMs: null,
    turns: 0,
    costUsd: 0,
    usage: "",
  };
  const send = (event: TellEvent) => {
    if (event.type === "action" && measure.firstActionMs === null) measure.firstActionMs = elapsed();
    if (event.type === "reply" && measure.replyMs === null) measure.replyMs = elapsed();
    emit(event);
  };
  const turn = startTurn(input, plan, send, buildChanged);
  try {
    const result = await runLlm({
      system: turn.systemPrompt,
      prompt: turn.prompt,
      model: plan.model,
      effort: plan.effort,
      maxTurns: MAX_TURNS,
      tools: turn.tools,
      abort,
      onOutput: () => {
        measure.firstOutputMs = elapsed();
      },
    });
    measure.turns = result.turns;
    measure.costUsd = result.costUsd;
    measure.usage = result.usage;
    measure.subtype = result.subtype;
    if (result.subtype !== "success") send({ type: "error", message: `The LLM stopped early: ${result.subtype}.` });
    if (!turn.replied())
      console.warn(`[bodylang] finished without calling reply. It said: ${result.text.slice(0, 400) || "nothing"}`);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[bodylang] bridge error", reason);
    send({ type: "error", message: runFailure(reason) });
    measure.subtype = "error";
  }
  send({ type: "done" });
  measure.totalMs = elapsed();
  return measure;
}
