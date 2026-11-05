import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { Action, ACTION_SCHEMAS, ActionName, BodyState, reduce } from "../src/agent/actions";
import { Intake } from "../src/model/simulate";
import { foodById, foodLine, nutrientsOf, searchFoods, sourceOf } from "./foods";
import { DATE_PATTERN } from "../src/model/day";
import { PRESETS } from "../src/model/events";
import { readout } from "../src/model/narrate";
import { processesAt } from "../src/model/processes";
import { simulate } from "../src/model/simulate";
import { formatClock, whereabouts } from "../src/model/state";

const MODEL = process.env.BODYLANG_MODEL ?? "claude-opus-5-5";
const EFFORT = "low";
const MAX_TURNS = 14;
const MAX_REQUEST_BYTES = 200_000;

const REPLY_WORDS_UNDER = 18;

const SYSTEM_PROMPT = `You are the voice of Bodylang, a 3D simulation of one person's body shown beside this conversation. People tell you in their own words what they ate, drank, took, did or came down with, and ask what is happening inside them. You see only the simulation, never their real body.

A deterministic physiology model computes everything. Your tools change its inputs, and the 3D body redraws as each call lands, so the person watches it respond while you work. You supply the two things the model can't: deciding how much they had, and a very short answer. What a food contains comes from the USDA table. The panels on screen carry the detail, which is why your answer stays short.

This is their real day, running on the real clock and saved as they go.

What happened, and which tool records it:
- Food or drink: call find_foods once with everything in the message, then log_food for each one with the row that fits best. You decide only how much they had: use the serving they name, or a typical one from the row's portions, and say it in \`assumption\`. Only when no row is close, use log_intake with your own composition, which is shown to them as your estimate. For whole fruit pass fructose_share 0.6. Things eaten within 10 minutes show as one meal, with a process id of meal:<first id>.
- A correction, such as "only one slice" or "that was an hour ago": correct_intake with the id already logged. Don't log it a second time.
- A drug or supplement: define_substance, with published oral kinetics and where those come from in \`source\`. If you don't know the kinetics, say so in your reply and leave it out of the simulation.
- Sitting, standing, walking, running or a nap: set_activity.
- When they slept: set_sleep with when they went to bed and when they woke. The usual night is 23:30 to 07:30, so only call it when they say otherwise. A late or short night changes how today feels.
- A gym or bodyweight session, being ill, sexual activity, a stressful stretch, or a short night: log_event with the matching preset.
- Anything else that happens to a body, such as a sauna, a long flight or an injury: log_event with the custom preset. The custom preset is for what no other preset covers, because it is shown as your estimate and has no published numbers behind it.
- Something ongoing, such as a cold: log_event with until null, then end_event when they say it is over.
- Their body's measurements: set_body, only if they state them.

Times: the current time is given below and is always right, and tools take minutes since 00:00 today. Earlier days are negative: 18:00 yesterday is -360. Past midnight it is still the same day until 04:00, so 01:30 is minute 1530. Log things that happened days ago too, because a late coffee, muscle soreness and illness are still acting today. What came over from yesterday is listed below with negative minutes and is already counted, so don't log it again.

View: leave the screen showing what matters most for this message. After logging something, call show_system for the system it affects most, such as muscles after a workout, immune during an illness or digestion after a meal. When they ask about one organ, call focus_organ instead, and when they ask where one thing has got to or how something works, call show_process with an id from the readout. When a choice they could make would answer the question better than a description, call what_if; it draws the alternative on the timeline without changing anything.

If the message is really a question about something hypothetical, or asks you to explain how something works, log nothing, answer in a line, and add that the Ask switch by the message box can show it on the body.

Numbers: every number in your reply must come from a readout. Each tool returns a readout at the current time, and read_body gives one at any other minute. Don't state physiology figures from memory, because the person is looking at the model's figures and yours must match them. Blood sugar is in mmol/L.

Finish by calling reply exactly once, with at most three lines of under ${REPLY_WORDS_UNDER} words each. Each line is plain text with no lead-in. Answer what they asked first, then what they may feel if that fits, and always say "you may feel", never "you should feel". Say what is happening directly, in plain words, without "not X but Y" constructions or filler.

The app estimates a typical body with their measurements, and it never diagnoses. Name a condition only if they named it, and describe what the model shows without telling them what they have. Sexual activity between adults is ordinary physiology: use the sex preset and clinical words only, in every field and in your reply, with no description of acts. If the message suggests anyone involved is under 18, log nothing and don't discuss it.

If the message describes something that could be a medical emergency, such as chest pain, an overdose or trouble breathing, your reply should tell them to get medical help now, and you should skip the simulation.`;

// Ask mode runs on the same model and tools, on a temporary copy of the day.
const ASK_PROMPT = `

This message is in Ask mode. The person is exploring, and nothing they say here has happened. Your tools act on a temporary copy of their day that is thrown away when they leave, so the screen can show anything freely, and their real day cannot change.

Two kinds of question:
- What would happen if: put the hypothetical into the copy with the same tools and the same care you would use for something real, at the time they name, or now if they name none. Taking something away counts too, so "what if I hadn't had the pizza" is remove_intake. The model then computes the consequences. Things from earlier questions in this exploration stay in the copy until you remove them, so remove what no longer applies.
- How does this work, such as what insulin does: change nothing in the copy and use the body as the illustration.

Then explain it on the body by calling guide, once, after anything you log and before reply. Give 2 to 5 steps in the order the thing happens, and each step puts something on screen and says what it means. Prefer showing a process line or flying into an organ, because an organ shows its diagram, over a general system view. For a what-if, give each step the minute it happens in \`at\`, so they watch it unfold, and use read_body at that minute so every number you state matches what is on screen. Say why it happens as well as what happens, because they are here to understand it. A concept can use numbers from their own readout to make it concrete.

Then call reply, once, with the short answer: the result of the what-if, compared with their day as it is, or the idea in plain words. The steps carry the explanation, so don't repeat them.

Asking how a dangerous dose or self-harm would play out is not something to simulate. Log nothing, show nothing, and reply that they should talk to someone now, such as a doctor or a local crisis line.`;

const ACTION_DESCRIPTIONS: Record<ActionName, string> = {
  correct_intake: "Corrects something already logged: how much they really had, when they really had it, or both. Everything in the food scales with the grams. If the id is unknown the error lists the known ids. Returns a readout.",
  set_sleep: "Sets last night's sleep. Past their usual bedtime the model counts them as still up, and it uses the real length of the night for how today feels. Returns a readout.",
  guide: "Walks the person through your explanation on the body, one step at a time. Each step moves the view and the time, and shows your words. The first step goes on screen immediately. A process id must exist in the readout at that point, so log first. Returns nothing to act on.",
  log_intake: "Records one food or drink at a time of day. The stomach, blood and organs respond immediately. Reusing an id replaces that entry. Returns a readout at the current time.",
  remove_intake: "Removes a logged food or drink by id. Returns a readout.",
  set_activity: "Sets what the body is doing from a time onward, or between two times. The figure changes posture and the model changes muscle uptake and heart rate. Use it for sitting, standing, walking, running and sleeping. A gym session is log_event with the training preset, without this as well, or its effort would count twice. Returns a readout.",
  set_body: "Changes sex, age, height or weight. Pass only what changed. Returns a readout.",
  set_now: "Moves the current time. Use this when the person states what time it is. Returns a readout at the new time.",
  define_substance: "Adds a drug or supplement the model has no built-in kinetics for, as a one-compartment oral dose. It circulates on screen and reaches the target organs. Returns a readout.",
  log_event: `Records something that happened to the body or is still going on, other than food, drugs and plain posture. The model computes every curve from the preset. The event appears in the readout under events and threads, and as a process with id event:<id>. Reusing an id replaces that event. Label it the way a person says it, such as "Chest and triceps workout" or "Cold", since the label is shown as written. When describing how it may feel, say "you may feel", never "you should feel". Pick one preset:
- training: a gym or bodyweight session. Pass muscles, using only the groups they name or that the exercise works. Give until; without it the session counts as 60 minutes.
- illness: a cold, flu or other infection. Pass the symptoms they report. until null while they are ill, and end_event when it is over.
- sex: sexual activity, in clinical terms only. Without until it counts as 25 minutes. The label is set for you.
- stress: an acutely stressful stretch, such as an exam or an argument. until null if it is still going on.
- poor_sleep: a short night. from is when they woke. Without until it lasts until bedtime.
- custom: only when none of these fits. Compose it in custom from channels, feelings and stops, and say in source where the numbers come from. It is marked as your estimate.
On a bad value the error names the parameter to fix. Returns a readout.`,
  end_event: "Marks an ongoing event as over, for example when they say the cold has gone. Its effects then fade over the following hours or days. If the id is unknown the error lists the known ids. Returns a readout.",
  show_system: "Switches the view to one body system: overview, digestion, energy (sugar and energy), circulation (heart and lungs), muscles, brain (brain and mood), immune, or clearing (liver and kidneys). Returns a readout.",
  show_process: "Draws one process as a numbered line through the body, for example where a food has got to, or a workout or a cold as event:<id>. Ids are in the readout under processes. Pass null to hide it. Returns a readout.",
  focus_organ: "Flies the camera to one organ and fades the rest. Pass null for the whole body. Returns a readout.",
  what_if: "Draws an alternative activity on the timeline for comparison without applying it. Returns a readout of the alternative at the end of the activity.",
};

// Claude's own numbers are always marked as its estimate, so the marking is not its to choose.
const OWN_ESTIMATE_SHAPE = ACTION_SCHEMAS.log_intake.omit({ source: true }).shape;

const LOG_FOOD = z.object({
  id: ACTION_SCHEMAS.log_intake.shape.id,
  label: ACTION_SCHEMAS.log_intake.shape.label,
  at: ACTION_SCHEMAS.log_intake.shape.at,
  fdc_id: z.number().int().describe("The id of the row from find_foods"),
  serving_label: z.string().min(1).describe("What one serving is, in the singular, in the words they would use, such as slice, cup or handful"),
  serving_grams: z.number().positive().describe("Grams in one serving, from the row's portions if one fits"),
  servings: z.number().positive().describe("How many servings they had"),
  liquid: ACTION_SCHEMAS.log_intake.shape.liquid,
  fructose_share: ACTION_SCHEMAS.log_intake.shape.fructose_share,
  assumption: z.string().describe("The portion in a few words, shown to the person, such as Two medium slices"),
});

type Mode = "tell" | "ask";
const HIDDEN_TOOLS: Record<Mode, ActionName[]> = { tell: ["guide", "set_now"], ask: ["what_if", "set_now"] };

const dayName = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

function renderContext(state: BodyState, text: string, mode: Mode, history: { asked: string; answered: string }[], date: string | null) {
  const clock = (m: number) => `${formatClock(m)} (minute ${m})`;
  const logged = (i: Intake) => {
    const where = i.source?.kind === "table" ? `USDA: ${i.source.name}` : i.source?.kind === "estimate" ? "your estimate" : null;
    return `- ${i.label} (id ${i.id}) at ${clock(i.at)}, ${Math.round(i.grams)} g${state.assumptions[i.id] ? `, ${state.assumptions[i.id]}` : ""}${where ? `, ${where}` : ""}`;
  };
  const list = (items: Intake[]) => (items.length ? items.map(logged).join("\n") : "- nothing yet");
  const fromYesterday = state.intakes.filter((i) => i.at < 0);
  const intakes = `${list(state.intakes.filter((i) => i.at >= 0))}${fromYesterday.length ? `\n\nYesterday, already counted:\n${list(fromYesterday)}` : ""}`;
  const activities = [...state.activities].sort((a, b) => a.from - b.from).map((a) => `- from ${clock(a.from)}: ${a.posture}`).join("\n");
  const substances = state.substances.length ? state.substances.map((s) => `- ${s.label} (id ${s.id}), ${s.doseMg} mg at ${clock(s.at)}`).join("\n") : "- none";
  const events = state.events.length
    ? state.events.map((e) => `- ${e.label} (id ${e.id}, ${e.preset}), from ${clock(e.from)}, ${e.until === null ? "still going on" : `until ${clock(e.until)}`}`).join("\n")
    : "- none";
  const earlier = history.length ? `\n\nEarlier in this exploration:\n${history.map((h) => `They asked: ${h.asked}\nYou answered: ${h.answered}`).join("\n")}` : "";
  return `<simulation${mode === "ask" ? ' kind="temporary copy of their day"' : ""}>
${date ? `Today is ${dayName(date)}. ` : ""}Current time: ${clock(state.now)}. Tools take times as minutes since 00:00.
Body: ${state.body.sex}, ${state.body.age} years, ${state.body.heightCm} cm, ${state.body.weightKg} kg.

Already logged today:
${intakes}

Other substances:
${substances}

Events:
${events}

Activity:
${activities}
</simulation>${earlier}

The person ${mode === "ask" ? "asks" : "says"} (their words, dictated, so expect homophones and missing punctuation):
<message>
${text}
</message>`;
}

// A session started from inside Claude Code inherits variables that point its child at that
// session; the bridge should run as a plain Claude Code of its own.
function cleanEnvironment() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_BASE_URL") continue;
    env[k] = v;
  }
  return env;
}

const bodyStateShape = z.object({
  body: z.object({ sex: z.enum(["male", "female"]), age: z.number(), heightCm: z.number(), weightKg: z.number() }),
  intakes: z.array(z.object({ id: z.string(), label: z.string(), at: z.number() })),
  activities: z.array(z.object({ from: z.number(), posture: z.string() })),
  substances: z.array(z.object({ id: z.string(), label: z.string(), at: z.number(), doseMg: z.number() })),
  events: z.array(z.object({ id: z.string(), label: z.string(), preset: z.enum(PRESETS), from: z.number(), until: z.number().nullable() })),
  now: z.number(),
  assumptions: z.record(z.string(), z.string()),
});
const requestSchema = z.object({
  text: z.string().min(1).max(4000),
  state: z.custom<BodyState>((v) => bodyStateShape.safeParse(v).success, "Not a body state"),
  mode: z.enum(["tell", "ask"]).default("tell"),
  history: z.array(z.object({ asked: z.string().max(4000), answered: z.string().max(4000) })).max(10).default([]),
  date: z.string().regex(DATE_PATTERN).nullable().default(null),
});

async function readBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request too large");
    chunks.push(buffer);
  }
  return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

export async function handleTell(req: IncomingMessage, res: ServerResponse) {
  const { text, state: initial, mode, history, date } = await readBody(req);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let state = initial;
  const started = performance.now();
  const scenario = () => ({ body: state.body, intakes: state.intakes, activities: state.activities, substances: state.substances, events: state.events });
  const trajectory = () => simulate(scenario());
  const report = (at = state.now) => {
    const tr = trajectory();
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...readout(tr, at), where_things_are: whereabouts(tr, at).map((w) => ({ id: w.id, label: w.label, unit: w.unit, total: Math.round(w.total), places: w.places.map((p) => `${p.label} ${Math.round(p.share * 100)}%`) })) }) }] };
  };

  const applied = (Object.keys(ACTION_SCHEMAS) as ActionName[])
    .filter((name) => !HIDDEN_TOOLS[mode].includes(name))
    .map((name) =>
    tool(name, ACTION_DESCRIPTIONS[name], name === "log_intake" ? OWN_ESTIMATE_SHAPE : ACTION_SCHEMAS[name].shape, async (args: unknown) => {
      const parsed = ACTION_SCHEMAS[name].safeParse(args);
      if (!parsed.success) return { content: [{ type: "text" as const, text: `${name} was not applied. ${z.prettifyError(parsed.error)}` }], isError: true };
      const action = { name, args: parsed.data } as Action;
      if (action.name === "log_intake") action.args.source = { kind: "estimate" };
      if (action.name === "show_process" && action.args.id !== null) {
        const known = processesAt(trajectory(), state.now).map((p) => p.id);
        if (!known.includes(action.args.id)) return { content: [{ type: "text" as const, text: `show_process was not applied. No process ${action.args.id}. Known ids: ${known.join(", ")}` }], isError: true };
      }
      if (action.name === "guide") {
        const known = processesAt(trajectory(), state.now).map((p) => p.id);
        const unknown = action.args.steps.flatMap((step) => (step.process !== null && !known.includes(step.process) ? [step.process] : []));
        if (unknown.length) return { content: [{ type: "text" as const, text: `guide was not applied. No process ${unknown.join(", ")}. Known ids: ${known.join(", ")}` }], isError: true };
      }
      try {
        state = reduce(state, action);
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `${name} was not applied. ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
      send({ type: "action", name, args: action.args });
      if (action.name === "guide") return { content: [{ type: "text" as const, text: "On screen. Now call reply." }] };
      if (action.name === "what_if" && state.whatIf) {
        const alt = simulate({ ...scenario(), activities: state.whatIf.activities });
        return { content: [{ type: "text" as const, text: JSON.stringify({ alternative: action.args.label, ...readout(alt, action.args.until) }) }] };
      }
      return report();
    }),
  );

  // A food from the table reaches the page as an ordinary log_intake, with the composition filled in here.
  const logFood = (args: z.infer<typeof LOG_FOOD>) => {
    const food = foodById(args.fdc_id);
    if (!food) return { content: [{ type: "text" as const, text: `log_food was not applied. No food ${args.fdc_id}. Use an id find_foods returned.` }], isError: true };
    const grams = args.servings * args.serving_grams;
    const n = nutrientsOf(food, grams);
    const logged: Action = {
      name: "log_intake",
      args: { id: args.id, label: args.label, at: args.at, grams, water_ml: n.waterMl, carbs_g: n.carbsG, sugar_g: n.sugarG, fat_g: n.fatG, protein_g: n.proteinG, fiber_g: n.fiberG, caffeine_mg: n.caffeineMg, alcohol_g: n.alcoholG, liquid: args.liquid, fructose_share: args.fructose_share, assumption: args.assumption, serving: { label: args.serving_label, grams: args.serving_grams }, source: sourceOf(food) },
    };
    state = reduce(state, logged);
    send({ type: "action", name: logged.name, args: logged.args });
    return report();
  };

  let replied = false;
  const server = createSdkMcpServer({
    name: "body",
    version: "0.0.0",
    tools: [
      ...applied,
      tool(
        "find_foods",
        "Looks foods up in the USDA FoodData Central table. Call it once with everything in the message, in generic food words, because the table has few brands: \"cola\" for a Coke, \"pizza cheese\", \"beer\". Returns up to 6 rows per query, each with an id for log_food, its composition and the portions the table knows. If nothing fits, search again with another word before estimating.",
        { queries: z.array(z.string().min(1)).min(1).max(12) },
        async ({ queries }) => ({ content: [{ type: "text" as const, text: queries.map((query) => `${query}:\n${searchFoods(query).map(foodLine).join("\n") || "nothing found"}`).join("\n\n") }] }),
      ),
      tool("log_food", "Records one food or drink from the USDA table at a time of day. You give how much, and its composition comes from the table. Reusing an id replaces that entry. The stomach, blood and organs respond immediately. Returns a readout at the current time.", LOG_FOOD.shape, async (args) => logFood(LOG_FOOD.parse(args))),
      tool("read_body", "Reads the model's numbers at any minute of the day, now or in the future, without changing anything. Use it to check a forecast before stating it.", { at: z.number().int().min(0).max(1799).describe("Minutes since 00:00 today") }, async ({ at }) => report(at)),
      tool(
        "reply",
        "Shows your answer to the person and ends your turn. Call it exactly once, last.",
        {
          lines: z
            .array(
              z.object({
                text: z.string().describe(`One line of plain words with no lead-in, under ${REPLY_WORDS_UNDER} words`),
                organ: z.enum(["brain", "heart", "lungs", "liver", "stomach", "pancreas", "spleen", "small_intestine", "large_intestine", "kidneys", "bladder", "muscle", "fat"]).optional().describe("The organ this line is about; hovering the line highlights it"),
              }),
            )
            .min(1)
            .max(3),
        },
        async ({ lines }) => {
          const long = lines.filter((l) => l.text.trim().split(/\s+/).length >= REPLY_WORDS_UNDER);
          if (long.length) return { content: [{ type: "text" as const, text: `Not shown. Shorten to under ${REPLY_WORDS_UNDER} words: ${long.map((l) => `"${l.text}"`).join(", ")}. Call reply again.` }], isError: true };
          replied = true;
          send({ type: "reply", lines });
          return { content: [{ type: "text" as const, text: "Shown to the person. Your turn is over." }] };
        },
      ),
    ],
  });

  const abort = new AbortController();
  // The request stream is finished once its body has been read, so only the response reports a disconnect.
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const run = query({
      prompt: renderContext(state, text, mode, history, date),
      options: {
        model: MODEL,
        effort: EFFORT,
        maxTurns: MAX_TURNS,
        systemPrompt: mode === "ask" ? SYSTEM_PROMPT + ASK_PROMPT : SYSTEM_PROMPT,
        tools: [],
        allowedTools: ["mcp__body__*"],
        mcpServers: { body: server },
        settingSources: [],
        persistSession: false,
        permissionMode: "dontAsk",
        env: cleanEnvironment(),
        abortController: abort,
      },
    });
    for await (const message of run) {
      if (message.type === "result") {
        console.log(`[bodylang] ${message.subtype} in ${Math.round(performance.now() - started)} ms, ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}`);
        if (message.subtype !== "success") send({ type: "error", message: `Claude stopped early: ${message.subtype}.` });
      }
    }
    if (!replied) console.warn("[bodylang] finished without calling reply");
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[bodylang] bridge error", reason);
    send({ type: "error", message: `Claude Code could not run: ${reason}` });
  }
  send({ type: "done" });
  res.end();
}
