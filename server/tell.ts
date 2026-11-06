import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { BodyState } from "../src/actions/reduce";
import { DATE_PATTERN } from "../src/model/day";
import { PRESETS } from "../src/model/events/types";
import { BuildStatus, TellEvent } from "../src/wire";
import { claudeDefaults } from "./claude";
import { openEventStream, readJson } from "./http";
import type { Notify } from "./http";
import { planFor, TellPlan } from "./tellPrompt";
import { startTurn, TellInput } from "./tellTurn";

const MAX_TURNS = 14;
const MAX_REQUEST_BYTES = 200_000;

const bodyStateShape = z.object({
  body: z.object({ sex: z.enum(["male", "female"]), age: z.number(), heightCm: z.number(), weightKg: z.number() }),
  intakes: z.array(z.object({ id: z.string(), label: z.string(), at: z.number() })),
  activities: z.array(z.object({ from: z.number(), posture: z.string() })),
  substances: z.array(z.object({ id: z.string(), label: z.string(), at: z.number(), doseMg: z.number() })),
  events: z.array(z.object({ id: z.string(), label: z.string(), preset: z.enum(PRESETS), from: z.number(), until: z.number().nullable() })),
  cycle: z.object({ start: z.number(), lengthDays: z.number(), periodDays: z.number() }).nullable(),
  now: z.number(),
  assumptions: z.record(z.string(), z.string()),
});

const requestSchema = z.object({
  text: z.string().min(1).max(4000),
  state: z.custom<BodyState>((v) => bodyStateShape.safeParse(v).success, "Not a body state"),
  mode: z.enum(["tell", "ask"]).default("tell"),
  depth: z.enum(["simple", "deep"]).default("simple"),
  history: z.array(z.object({ asked: z.string().max(4000), answered: z.string().max(4000) })).max(10).default([]),
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
}

export async function handleTell(req: IncomingMessage, res: ServerResponse, { buildChanged }: Notify) {
  const input = requestSchema.parse(await readJson(req, MAX_REQUEST_BYTES));
  const stream = openEventStream(res);
  const measured = await runTell(input, planFor(input.mode, input.depth), stream.send, stream.stopped, buildChanged);
  console.log(`[bodylang] ${measured.subtype} in ${measured.totalMs} ms, first thing on screen at ${measured.firstActionMs ?? "-"} ms, ${measured.turns} turns, $${measured.costUsd.toFixed(4)}`);
  res.end();
}

// One message, from the sentence to the answer, with each change sent on as it happens.
export async function runTell(input: TellInput, plan: TellPlan, emit: (event: TellEvent) => void, abort: AbortController, buildChanged: (status: BuildStatus) => void): Promise<TellMeasure> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const measure: TellMeasure = { subtype: "success", totalMs: 0, firstOutputMs: null, firstActionMs: null, replyMs: null, turns: 0, costUsd: 0 };
  const send = (event: TellEvent) => {
    if (event.type === "action" && measure.firstActionMs === null) measure.firstActionMs = elapsed();
    if (event.type === "reply" && measure.replyMs === null) measure.replyMs = elapsed();
    emit(event);
  };
  const turn = startTurn(input, plan, send, buildChanged);
  try {
    const run = query({
      prompt: turn.prompt,
      options: {
        ...claudeDefaults(),
        model: plan.model,
        effort: plan.effort,
        maxTurns: MAX_TURNS,
        systemPrompt: turn.systemPrompt,
        allowedTools: ["mcp__body__*"],
        mcpServers: { body: createSdkMcpServer({ name: "body", version: "0.0.0", tools: turn.tools }) },
        abortController: abort,
      },
    });
    for await (const message of run) {
      if (message.type === "assistant" && measure.firstOutputMs === null) measure.firstOutputMs = elapsed();
      if (message.type === "result") {
        measure.turns = message.num_turns;
        measure.costUsd = message.total_cost_usd;
        measure.subtype = message.subtype;
        if (message.subtype !== "success") send({ type: "error", message: `Claude stopped early: ${message.subtype}.` });
      }
    }
    if (!turn.replied()) console.warn("[bodylang] finished without calling reply");
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[bodylang] bridge error", reason);
    send({ type: "error", message: `Claude Code could not run: ${reason}` });
    measure.subtype = "error";
  }
  send({ type: "done" });
  measure.totalMs = elapsed();
  return measure;
}
