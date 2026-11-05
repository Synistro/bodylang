import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { Action, ACTION_SCHEMAS, ActionName, BodyState, reduce } from "../src/agent/actions";
import { Intake } from "../src/model/simulate";
import { cleanEnvironment } from "./claudeEnv";
import { BuildStatus, startBuild } from "./extend";
import { combineIngredients, foodById, foodLine, nutrientsOf, searchFoods, sourceOf } from "./foods";
import { NumberBook, unverifiedNumbers } from "./numberCheck";
import { closeupGuidance } from "../src/closeup/list";
import { traceTrack } from "./track";
import { DATE_PATTERN } from "../src/model/day";
import { PRESETS } from "../src/model/events";
import { readout } from "../src/model/narrate";
import { processesAt } from "../src/model/processes";
import { simulate } from "../src/model/simulate";
import { formatClock, whereabouts } from "../src/model/state";

// Which model answers, and how. tools/speed-bench.mjs measured these, and PLAN.md has the results. In a
// brief run the tools just record, and Claude reads the numbers once, when it needs them.
export interface TellPlan {
  model: string;
  effort: "low" | "medium" | "high";
  brief: boolean;
}

const MODEL = process.env.BODYLANG_MODEL ?? "claude-sonnet-5-5";
const DEEP_MODEL = process.env.BODYLANG_DEEP_MODEL ?? "claude-opus-5-5";
const TELL_PLAN: TellPlan = { model: MODEL, effort: "low", brief: true };
// Being brief made it skip the walkthrough for a concept, so an explanation takes the turns it needs.
const ASK_PLANS: Record<"simple" | "deep", TellPlan> = {
  simple: { model: MODEL, effort: "low", brief: false },
  deep: { model: DEEP_MODEL, effort: "medium", brief: false },
};
const MAX_TURNS = 14;
const MAX_REQUEST_BYTES = 200_000;

const REPLY_WORDS_UNDER = 18;

const SYSTEM_PROMPT = `You are the voice of Bodylang, a 3D simulation of one person's body shown beside this conversation. People tell you in their own words what they ate, drank, took, did or came down with, and ask what is happening inside them. You see only the simulation, never their real body.

A deterministic physiology model computes everything. Your tools change its inputs, and the 3D body redraws as each call lands, so the person watches it respond while you work. You supply the two things the model can't: deciding how much they had, and a very short answer. What a food contains comes from the USDA table. The panels on screen carry the detail, which is why your answer stays short.

This is their real day, running on the real clock and saved as they go.

What happened, and which tool records it:
- Food or drink: call find_foods once with everything in the message, then log_food for each one with the row that fits best. You decide only how much they had: use the serving they name, or a typical one from the row's portions, and say it in \`assumption\`. A dish made of several ingredients, such as syrniki, pierogi, a stew or a homemade cake, needs log_dish unless a row is that same dish: never log it as its main ingredient, because the flour, sugar and frying oil would go missing. Include each ingredient in that find_foods call, and use a typical recipe scaled to what they ate. Only when no row is close, use log_intake with your own composition, which is shown to them as your estimate. For whole fruit pass fructose_share 0.6. Things eaten within 10 minutes show as one meal, with a process id of meal:<first id>.
- A correction, such as "only one slice" or "that was an hour ago": correct_intake with the id already logged. Don't log it a second time.
- A drug or supplement: define_substance, with published kinetics for the way it is taken and where those come from in \`source\`. Smoke or vapour is inhaled, and its \`targets\` should name every organ it really acts on, because each one shows it on its own page. If you don't know the kinetics, say so in your reply and leave it out of the simulation.
- Sitting, standing, walking, running or a nap: set_activity.
- When they slept: set_sleep with when they went to bed and when they woke. The usual night is 23:30 to 07:30, so only call it when they say otherwise. A late or short night changes how today feels.
- A gym or bodyweight session, being ill, sexual activity, a stressful stretch, or a short night: log_event with the matching preset.
- Anything else that happens to a body, such as a sauna, a long flight or an injury: log_event with the custom preset. The custom preset is for what no other preset covers, because it is shown as your estimate and has no published numbers behind it.
- Something ongoing, such as a cold: log_event with until null, then end_event when they say it is over.
- Their period starting or having started: set_cycle. It is a typical curve, so never present it as telling them when they ovulate or as usable for contraception.
- Their body's measurements: set_body, only if they state them.

Times: the current time is given below and is always right, and tools take minutes since 00:00 today. Earlier days are negative: 18:00 yesterday is -360. Past midnight it is still the same day until 04:00, so 01:30 is minute 1530. Log things that happened days ago too, because a late coffee, muscle soreness and illness are still acting today. What came over from yesterday is listed below with negative minutes and is already counted, so don't log it again.

View: leave the screen showing what matters most for this message. After logging something, call show_system for the system it affects most, such as muscles after a workout, immune during an illness or digestion after a meal. When they ask about one organ, call focus_organ instead, and when they ask where one thing has got to or how something works, call show_process with an id from the readout. When a choice they could make would answer the question better than a description, call what_if; it draws the alternative on the timeline without changing anything.

If they ask about an organ or a process of the body that the readout has no process for and no tool logs, such as the thyroid or melatonin, answer in a line from what you know, marked as your own knowledge, and call add_process once. A separate session then writes it, and it appears on the body once its tests pass, which takes about ten minutes. Tell them that in your reply. Use it only for a lasting part of how a body works. Something that happened to them is log_event, and a drug is define_substance.

Numbers: every number in your reply must come from a readout. Each tool returns a readout at the current time, and read_body gives one at any other minute. Don't state physiology figures from memory, because the person is looking at the model's figures and yours must match them. Blood sugar is in mmol/L.

Finish by calling reply exactly once, with at most three lines of under ${REPLY_WORDS_UNDER} words each. Each line is plain text with no lead-in. Answer what they asked first, then what they may feel if that fits, and always say "you may feel", never "you should feel". Say what is happening directly, in plain words, without "not X but Y" constructions or filler.

The app estimates a typical body with their measurements, and it never diagnoses. Name a condition only if they named it, and describe what the model shows without telling them what they have. Sexual activity between adults is ordinary physiology: use the sex preset and clinical words only, in every field and in your reply, with no description of acts. If the message suggests anyone involved is under 18, log nothing and don't discuss it.

If the message describes something that could be a medical emergency, such as chest pain, an overdose or trouble breathing, your reply should tell them to get medical help now, and you should skip the simulation.`;

const TELL_PROMPT = `

If the message is really a question about something hypothetical, or asks you to explain how something works, log nothing, answer in a line, and add that the Ask switch by the message box can show it on the body.`;

// Ask mode runs on the same tools, on a temporary copy of the day.
const ASK_PROMPT = `

This message is in Ask mode. The person is exploring, and nothing they say here has happened. Your tools act on a temporary copy of their day that is thrown away when they leave, so the screen can show anything freely, and their real day cannot change.

Two kinds of question:
- What would happen if: put the hypothetical into the copy with the same tools and the same care you would use for something real, at the time they name, or now if they name none. Taking something away counts too, so "what if I hadn't had the pizza" is remove_intake. The model then computes the consequences. Things from earlier questions in this exploration stay in the copy until you remove them, so remove what no longer applies.
- How does this work, such as what insulin does: use the body as the illustration, and change nothing in the copy unless a close-up needs an example to show, as below.

Then explain it on the body by calling guide, once, after anything you log and before reply. Give 2 to 5 steps in the order the thing happens, and each step puts something on screen and says what it means. Prefer showing a process line or flying into an organ, because an organ shows its diagram, over a general system view. For a what-if, give each step the minute it happens in \`at\`, so they watch it unfold, and use read_body at that minute so every number you state matches what is on screen. Say why it happens as well as what happens, because they are here to understand it. A concept can use numbers from their own readout to make it concrete.

Two views work together during a step. The body shows where something is and what travels: set organ, and muscle with it, to fly there, or process to draw a line. Beside it, the panel shows that place's close-up, the same drawing the person sees every day, moved by the model at the step's minute. So to explain something, put it in the model and let the drawing show it. For how soreness works, log a training session for the muscle a couple of days ago, say in the first step that it is an example, and walk through what follows with each step's \`at\`.

A step's \`at\` can reach other days for a muscle, in the order things happen: during the session, hours after, now, days later. The close-up and the muscle's colour on the body follow it, and the chart stays on today. For anything else, stay within today.

A step on an organ listed below must direct its close-up through \`closeup\`:
- light is what the step is about. It stands out and the rest dims, and whatever it sends across the body, such as a pain signal to the brain, is drawn on the body. List first what the step is most about, because only the first one that travels is drawn. Only name a level that means what the step says. If none does, leave light empty and the whole drawing dims, because pointing at something else shows the wrong thing.
- set gives levels from 0 to 1 for what the model can't know in this case. Leave it empty otherwise, because the model's numbers are real and yours are shown as your illustration.
- compare adds a second drawing below the first, for a question about a difference such as trained and untrained: this_label and other_label say which is which, and times multiplies the lower drawing's levels, such as 0.4 for less than half. Otherwise null.
- basis says where any number in set or compare comes from, naming the study or textbook idea or saying it is your own understanding. Null when you use neither.
Stay on one organ through the steps when they are watching one tissue change.

Every organ's page also lists everything acting on it now, from what you have logged: the food, the caffeine, a substance you defined. When a step on an organ is about one of those, set the step's process to its id. Its row stands out and its way to this organ is drawn on the body.

A hypothetical injury that goes through the body, such as a bullet or a stab wound, is a custom log_event with custom.track naming the organ it goes through and the side it comes from. The tool answers with this_line_crosses, the organs and large vessels that line really meets, so name only those, and don't name others. Its effects are your estimate of what blood loss does to heart rate and blood pressure, and your source says so. Explain it clinically: what is damaged, what bleeds and why it matters, what the body does, and what saves the person. No descriptions of gore.

${closeupGuidance()}

The question is the subject. Their day is on the copy and it changes the numbers, but bring in what they ate or did today only where it changes the answer, such as a meal slowing how fast alcohol arrives.

Then call reply, once, with the short answer: the result of the what-if, compared with their day as it is, or the idea in plain words. The steps carry the explanation, so don't repeat them.

Three things get no walkthrough. Log nothing, show nothing, and only reply:
- An injury or emergency that is happening now: tell them to call emergency services now, and what to do until help comes.
- Any sign they may hurt themselves, including asking how a dangerous dose or a wound would play out on them: tell them to talk to someone now, such as a doctor or a local crisis line, warmly and without a lecture.
- A question aimed at hurting someone, such as where a wound would be most lethal or how to avoid treatment: say you won't help with that.
Understanding what an injury does in general, with no sign of any of these, is a fine question.`;

const DEPTH_PROMPT: Record<"simple" | "deep", string> = {
  simple: `

They chose Simple, so keep it light: 2 or 3 steps, the idea and no more. Use the organs' own drawings, and leave composed null. When no level means exactly what a step says, leave light empty: a step about nicotine doesn't light caffeine, and a step about surgery doesn't light anything.`,
  deep: `

They chose Deep, so take the time to really explain it: up to 6 steps, going through the mechanism in order and saying why each thing happens. Compare where a comparison makes it clearer. Check what you say against the readout at the minute you show.

Deep can also compose a drawing, in the panel in place of the organ's own, for what that drawing can't show, such as dopamine at a nerve ending, smoke in an air sac, a virus entering a cell or a torn vessel. Say what is there in composed: up to 5 layers from top to bottom, and up to 5 actors moving between them. The app does all the layout, so you give no positions. Keep the same ids through consecutive steps and change amounts and states, so they watch one picture change. Light what the step is about. Every amount in it is your illustration, so the basis says where the picture comes from. Prefer an organ's own drawing whenever it can show the step, and compose when it can't. An injury should almost always compose its wound.`,
};

const BRIEF_PROMPT = `

Work in as few messages as you can, because the person is watching and each message costs them seconds. Send every call you can together in one message. Logging tools record and return nothing, so put read_body at the current time in the same message as your last log or view call, and then call reply. A reply alone in the next message is ideal. For a food: find_foods first, then all the log_food and log_dish calls, the view and read_body together, then reply. This overrides what the other instructions say about each tool returning a readout.`;

const ACTION_DESCRIPTIONS: Record<ActionName, string> = {
  correct_intake: "Corrects something already logged: how much they really had, when they really had it, or both. Everything in the food scales with the grams. If the id is unknown the error lists the known ids. Returns a readout.",
  set_sleep: "Sets last night's sleep. Past their usual bedtime the model counts them as still up, and it uses the real length of the night for how today feels. Returns a readout.",
  set_cycle: "Sets when their latest period began. The model then places a typical menstrual cycle from that date: the hormones, a slightly warmer body and higher heart rate after ovulation, and lower insulin sensitivity. Pass null if they use a hormonal contraceptive, are pregnant or past menopause, because this curve doesn't apply. Returns a readout.",
  guide: "Walks the person through your explanation on the body, one step at a time. Each step moves the view and the time, and shows your words. The first step goes on screen immediately. A process id must exist in the readout at that point, so log first. Returns nothing to act on.",
  log_intake: "Records one food or drink at a time of day. The stomach, blood and organs respond immediately. Reusing an id replaces that entry. Returns a readout at the current time.",
  remove_intake: "Removes a logged food or drink by id. Returns a readout.",
  set_activity: "Sets what the body is doing from a time onward, or between two times. The figure changes posture and the model changes muscle uptake and heart rate. Use it for sitting, standing, walking, running and sleeping. A gym session is log_event with the training preset, without this as well, or its effort would count twice. Returns a readout.",
  set_body: "Changes sex, age, height or weight. Pass only what changed. Returns a readout.",
  set_now: "Moves the current time. Use this when the person states what time it is. Returns a readout at the new time.",
  define_substance: "Adds a drug or supplement the model has no built-in kinetics for, as a one-compartment dose that is swallowed, inhaled or injected. It circulates on screen and shows on the page of every target organ, with the effect you give. It changes no heart rate or other reading by itself, so pair it with a custom log_event for what it does to those. Returns a readout.",
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
const LOG_DISH = z.object({
  id: ACTION_SCHEMAS.log_intake.shape.id,
  label: ACTION_SCHEMAS.log_intake.shape.label,
  at: ACTION_SCHEMAS.log_intake.shape.at,
  ingredients: z.array(z.object({ fdc_id: z.number().int().describe("The id of the row from find_foods"), grams: z.number().positive().describe("Grams of this ingredient in everything they ate, including oil the food absorbed") })).min(2),
  serving_label: z.string().min(1).describe("What one serving is, in the singular, in the words they would use, such as piece or bowl"),
  servings: z.number().positive().describe("How many servings they had"),
  liquid: ACTION_SCHEMAS.log_intake.shape.liquid,
  assumption: z.string().describe("The portion and recipe in a few words, shown to the person, such as Three syrniki, typical recipe"),
});

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
    const where = i.source?.kind === "table" ? `USDA: ${i.source.name}` : i.source?.kind === "estimate" ? "your estimate" : i.source?.kind === "recipe" ? `your recipe: ${i.source.ingredients.map((part) => `${Math.round(part.grams)} g ${part.name}`).join(", ")}` : null;
    return `- ${i.label} (id ${i.id}) at ${clock(i.at)}, ${Math.round(i.grams)} g${state.assumptions[i.id] ? `, ${state.assumptions[i.id]}` : ""}${where ? `, ${where}` : ""}`;
  };
  const list = (items: Intake[]) => (items.length ? items.map(logged).join("\n") : "- nothing yet");
  const fromYesterday = state.intakes.filter((i) => i.at < 0);
  const intakes = `${list(state.intakes.filter((i) => i.at >= 0))}${fromYesterday.length ? `\n\nYesterday, already counted:\n${list(fromYesterday)}` : ""}`;
  const activities = [...state.activities].sort((a, b) => a.from - b.from).map((a) => `- from ${clock(a.from)}: ${a.posture}`).join("\n");
  const substances = state.substances.length ? state.substances.map((s) => `- ${s.label} (id ${s.id}), ${s.doseMg} mg at ${clock(s.at)}`).join("\n") : "- none";
  const cycle = state.cycle ? `Latest period began at minute ${state.cycle.start}, ${state.cycle.lengthDays}-day cycle.` : "No cycle logged.";
  const events = state.events.length
    ? state.events.map((e) => `- ${e.label} (id ${e.id}, ${e.preset}), from ${clock(e.from)}, ${e.until === null ? "still going on" : `until ${clock(e.until)}`}`).join("\n")
    : "- none";
  const earlier = history.length ? `\n\nEarlier in this exploration:\n${history.map((h) => `They asked: ${h.asked}\nYou answered: ${h.answered}`).join("\n")}` : "";
  return `<simulation${mode === "ask" ? ' kind="temporary copy of their day"' : ""}>
${date ? `Today is ${dayName(date)}. ` : ""}Current time: ${clock(state.now)}. Tools take times as minutes since 00:00.
Body: ${state.body.sex}, ${state.body.age} years, ${state.body.heightCm} cm, ${state.body.weightKg} kg.${state.body.sex === "female" ? ` ${cycle}` : ""}

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

export async function handleTell(req: IncomingMessage, res: ServerResponse, buildChanged: (status: BuildStatus) => void) {
  const input = await readBody(req);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const abort = new AbortController();
  // The request stream is finished once its body has been read, so only the response reports a disconnect.
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const measured = await runTell(input, input.mode === "ask" ? ASK_PLANS[input.depth] : TELL_PLAN, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`), abort, buildChanged);
  console.log(`[bodylang] ${measured.subtype} in ${measured.totalMs} ms, first thing on screen at ${measured.firstActionMs ?? "-"} ms, ${measured.turns} turns, $${measured.costUsd.toFixed(4)}`);
  res.end();
}

export interface TellMeasure {
  subtype: string;
  totalMs: number;
  firstOutputMs: number | null; // when the first model started answering, which shows what starting up costs
  firstActionMs: number | null; // when something first changed on screen
  replyMs: number | null;
  turns: number;
  costUsd: number;
}

type TellInput = Awaited<ReturnType<typeof readBody>>;

// One message, from the sentence to the answer, with each change sent on as it happens.
export async function runTell({ text, state: initial, mode, depth, history, date }: TellInput, plan: TellPlan, emit: (event: unknown) => void, abort: AbortController, buildChanged: (status: BuildStatus) => void): Promise<TellMeasure> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const measure: TellMeasure = { subtype: "success", totalMs: 0, firstOutputMs: null, firstActionMs: null, replyMs: null, turns: 0, costUsd: 0 };
  const send = (event: { type: string; [key: string]: unknown }) => {
    if (event.type === "action" && measure.firstActionMs === null) measure.firstActionMs = elapsed();
    if (event.type === "reply" && measure.replyMs === null) measure.replyMs = elapsed();
    emit(event);
  };

  let state = initial;
  const scenario = () => ({ body: state.body, intakes: state.intakes, activities: state.activities, substances: state.substances, events: state.events, cycle: state.cycle });
  const trajectory = () => simulate(scenario());
  // Everything Claude has been given, to check the numbers it states against.
  const book = new NumberBook();
  const told = (text: string) => {
    book.add(text);
    return { content: [{ type: "text" as const, text }] };
  };
  const recorded = () => ({ content: [{ type: "text" as const, text: "Recorded." }] });
  const report = (at = state.now, also: Record<string, unknown> = {}) => {
    const tr = trajectory();
    return told(JSON.stringify({ ...also, ...readout(tr, at), where_things_are: whereabouts(tr, at).map((w) => ({ id: w.id, label: w.label, unit: w.unit, total: Math.round(w.total), places: w.places.map((p) => `${p.label} ${Math.round(p.share * 100)}%`) })) }));
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
      const track = action.name === "log_event" ? action.args.custom?.track : null;
      if (track) track.crossed = traceTrack(track.aim, track.from, state.body.sex);
      try {
        state = reduce(state, action);
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `${name} was not applied. ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
      // A time it just recorded is on the chart, so saying it back adds nothing of its own.
      for (const [key, minute] of Object.entries(action.args)) if (["at", "from", "until", "bed", "wake"].includes(key) && typeof minute === "number") book.add(formatClock(minute));
      if (action.name === "guide") for (const step of action.args.steps) step.unverified = unverifiedNumbers(step.say, book);
      send({ type: "action", name, args: action.args });
      if (action.name === "guide") {
        guided = true;
        return { content: [{ type: "text" as const, text: "On screen. Now call reply." }] };
      }
      if (action.name === "what_if" && state.whatIf) {
        const alt = simulate({ ...scenario(), activities: state.whatIf.activities });
        return told(JSON.stringify({ alternative: action.args.label, ...readout(alt, action.args.until) }));
      }
      if (track) return report(state.now, { this_line_crosses: track.crossed?.map((part) => part.name) ?? [] });
      return plan.brief ? recorded() : report();
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
    book.add(formatClock(args.at));
    send({ type: "action", name: logged.name, args: logged.args });
    return plan.brief ? recorded() : report();
  };

  const logDish = (args: z.infer<typeof LOG_DISH>) => {
    const parts = args.ingredients.map((part) => ({ food: foodById(part.fdc_id), grams: part.grams }));
    const unknown = args.ingredients.filter((_, index) => !parts[index].food).map((part) => part.fdc_id);
    if (unknown.length) return { content: [{ type: "text" as const, text: `log_dish was not applied. No food ${unknown.join(", ")}. Use ids find_foods returned.` }], isError: true };
    const { nutrients: n, source } = combineIngredients(parts.map(({ food, grams }) => ({ food: food!, grams })));
    const logged: Action = {
      name: "log_intake",
      args: { id: args.id, label: args.label, at: args.at, grams: n.grams, water_ml: n.waterMl, carbs_g: n.carbsG, sugar_g: n.sugarG, fat_g: n.fatG, protein_g: n.proteinG, fiber_g: n.fiberG, caffeine_mg: n.caffeineMg, alcohol_g: n.alcoholG, liquid: args.liquid, assumption: args.assumption, serving: { label: args.serving_label, grams: n.grams / args.servings }, source },
    };
    state = reduce(state, logged);
    book.add(formatClock(args.at));
    send({ type: "action", name: logged.name, args: logged.args });
    return plan.brief ? recorded() : report();
  };

  let replied = false;
  let guided = false;
  let remindedToGuide = false;
  const allTools = [
      ...applied,
      tool(
        "find_foods",
        "Looks foods up in the USDA FoodData Central table. Call it once with everything in the message, in generic food words, because the table has few brands: \"cola\" for a Coke, \"pizza cheese\", \"beer\". Returns up to 6 rows per query, each with an id for log_food, its composition and the portions the table knows. If nothing fits, search again with another word before estimating.",
        { queries: z.array(z.string().min(1)).min(1).max(12) },
        async ({ queries }) => told(queries.map((query) => `${query}:\n${searchFoods(query).map(foodLine).join("\n") || "nothing found"}`).join("\n\n")),
      ),
      tool("log_food", "Records one food or drink from the USDA table at a time of day. You give how much, and its composition comes from the table. Reusing an id replaces that entry. The stomach, blood and organs respond immediately. Returns a readout at the current time.", LOG_FOOD.shape, async (args) => logFood(LOG_FOOD.parse(args))),
      tool("log_dish", "Records one dish made of several ingredients as a single entry at a time of day. You give each ingredient's USDA row and grams, the composition is added up from the table, and it is shown as your recipe. Reusing an id replaces that entry. Returns a readout at the current time.", LOG_DISH.shape, async (args) => logDish(LOG_DISH.parse(args))),
      tool(
        "add_process",
        "Asks a separate Claude session to add a process the model doesn't have. It runs on its own for about ten minutes, and the process appears on the body only if every test passes. You can't write it yourself. Returns whether it started.",
        {
          id: z.string().describe("Lowercase letters and underscores, such as thyroid"),
          title: z.string().max(40).describe("What it is called on screen, such as Thyroid"),
          what: z.string().max(1000).describe("What the person wants to understand, in a sentence or two"),
        },
        async (request) => {
          const result = startBuild(request, buildChanged);
          return { content: [{ type: "text" as const, text: result.started ? "Started. Tell them it is being added and will appear on the body once its tests pass." : `Not started. ${result.reason}` }], isError: !result.started };
        },
      ),
      tool("read_body", "Reads the model's numbers at any minute of the day, now or in the future, without changing anything. Use it to check a forecast before stating it.", { at: z.number().int().min(0).max(1799).describe("Minutes since 00:00 today") }, async ({ at }) => report(at)),
      tool(
        "reply",
        "Shows your answer to the person and ends your turn. Call it exactly once, last.",
        {
          lines: z
            .array(
              z.object({
                text: z.string().describe(`One line of plain words with no lead-in, under ${REPLY_WORDS_UNDER} words`),
                organ: z.enum(["brain", "heart", "lungs", "liver", "stomach", "pancreas", "spleen", "small_intestine", "large_intestine", "kidneys", "bladder", "muscle", "fat", "uterus", "ovaries", "prostate"]).optional().describe("The organ this line is about; hovering the line highlights it"),
              }),
            )
            .min(1)
            .max(3),
        },
        async ({ lines }) => {
          if (mode === "ask" && !guided && !remindedToGuide) {
            remindedToGuide = true;
            return { content: [{ type: "text" as const, text: "Not shown. They asked in Ask to see it on the body, so call guide first, then reply. If this is a reply where nothing should be shown, such as telling them to get help, call reply again as it is." }], isError: true };
          }
          const long = lines.filter((l) => l.text.trim().split(/\s+/).length >= REPLY_WORDS_UNDER);
          if (long.length) return { content: [{ type: "text" as const, text: `Not shown. Shorten to under ${REPLY_WORDS_UNDER} words: ${long.map((l) => `"${l.text}"`).join(", ")}. Call reply again.` }], isError: true };
          replied = true;
          send({ type: "reply", lines: lines.map((line) => ({ ...line, unverified: unverifiedNumbers(line.text, book) })) });
          return { content: [{ type: "text" as const, text: "Shown to the person. Your turn is over." }] };
        },
      ),
  ];

  try {
    const prompt = renderContext(state, text, mode, history, date);
    book.add(prompt);
    const run = query({
      prompt,
      options: {
        model: plan.model,
        effort: plan.effort,
        maxTurns: MAX_TURNS,
        systemPrompt: SYSTEM_PROMPT + (mode === "ask" ? ASK_PROMPT + DEPTH_PROMPT[depth] : TELL_PROMPT) + (plan.brief ? BRIEF_PROMPT : ""),
        tools: [],
        allowedTools: ["mcp__body__*"],
        mcpServers: { body: createSdkMcpServer({ name: "body", version: "0.0.0", tools: allTools }) },
        settingSources: [],
        persistSession: false,
        permissionMode: "dontAsk",
        env: cleanEnvironment(),
        abortController: abort,
      },
    });
    for await (const message of run) {
      if (message.type === "assistant" && measure.firstOutputMs === null) measure.firstOutputMs = elapsed();
      if (message.type === "result") {
        measure.turns += message.num_turns;
        measure.costUsd += message.total_cost_usd;
        measure.subtype = message.subtype;
        if (message.subtype !== "success") send({ type: "error", message: `Claude stopped early: ${message.subtype}.` });
      }
    }
    if (!replied) console.warn("[bodylang] finished without calling reply");
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
