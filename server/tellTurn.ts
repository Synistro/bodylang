import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Action, ACTION_SCHEMAS } from "../src/actions/schemas";
import { BodyState, reduce } from "../src/actions/reduce";
import { simulate } from "../src/model/engine/simulate";
import { ORGANS } from "../src/model/ids";
import { processesAt } from "../src/model/processes/processes";
import { readout } from "../src/model/readout";
import { whereabouts } from "../src/model/whereabouts";
import { formatClock } from "../src/model/words";
import { BuildStatus, TellEvent } from "../src/wire";
import { startBuild } from "./extend";
import { combineIngredients, Food, foodById, foodLine, nutrientsOf, searchFoods, sourceOf } from "./foods";
import { NumberBook, unverifiedNumbers } from "./numberCheck";
import { actionToolsFor, ACTION_DESCRIPTIONS, Depth, Mode, renderContext, REPLY_WORDS_UNDER, systemPromptFor, TellPlan, ToolAction } from "./tellPrompt";
import { traceTrack } from "./track";

export interface TellInput {
  text: string;
  state: BodyState;
  mode: Mode;
  depth: Depth;
  history: { asked: string; answered: string }[];
  date: string | null;
}

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

// Claude's own numbers are always marked as its estimate, so the marking is not its to choose.
const OWN_ESTIMATE_SHAPE = ACTION_SCHEMAS.log_intake.omit({ source: true }).shape;

const answer = (text: string) => ({ content: [{ type: "text" as const, text }] });
const refusal = (text: string) => ({ ...answer(text), isError: true });

const minuteFields = (args: object) => Object.entries(args).flatMap(([key, value]) => (["at", "from", "until", "bed", "wake"].includes(key) && typeof value === "number" ? [value] : []));

// One message's tools, and the state they change. Nothing here calls Claude, so every tool can be run directly.
export function startTurn({ text, state: initial, mode, depth, history, date }: TellInput, plan: TellPlan, send: (event: TellEvent) => void, buildChanged: (status: BuildStatus) => void) {
  let state = initial;
  let replied = false;
  let guided = false;
  let remindedToGuide = false;

  const trajectory = () => simulate(state.day);

  // Everything Claude has been given, to check the numbers it states against.
  const book = new NumberBook();
  const told = (result: string) => {
    book.add(result);
    return answer(result);
  };
  const report = (at = state.now, also: Record<string, unknown> = {}) => {
    const tr = trajectory();
    return told(JSON.stringify({ ...also, ...readout(tr, at), where_things_are: whereabouts(tr, at).map((w) => ({ id: w.id, label: w.label, unit: w.unit, total: Math.round(w.total), places: w.places.map((p) => `${p.label} ${Math.round(p.share * 100)}%`) })) }));
  };
  const afterLogging = () => (plan.brief ? answer("Recorded.") : report());

  // Applies an action to this turn's day and sends it on to the page. A time it just recorded is on the chart,
  // so saying it back adds nothing of its own.
  const apply = (action: Action) => {
    state = reduce(state, action);
    for (const minute of minuteFields(action.args)) book.add(formatClock(minute));
  };

  const processIdsNow = () => processesAt(trajectory(), state.now).map((process) => process.id);

  async function runAction(name: ToolAction, args: unknown) {
    const parsed = ACTION_SCHEMAS[name].safeParse(args);
    if (!parsed.success) return refusal(`${name} was not applied. ${z.prettifyError(parsed.error)}`);
    const action = { name, args: parsed.data } as Action;
    if (action.name === "log_intake") action.args.source = { kind: "estimate" };
    if (action.name === "show_process" && action.args.id !== null) {
      const known = processIdsNow();
      if (!known.includes(action.args.id)) return refusal(`show_process was not applied. No process ${action.args.id}. Known ids: ${known.join(", ")}`);
    }
    if (action.name === "guide") {
      const known = processIdsNow();
      const unknown = action.args.steps.flatMap((step) => (step.process !== null && !known.includes(step.process) ? [step.process] : []));
      if (unknown.length) return refusal(`guide was not applied. No process ${unknown.join(", ")}. Known ids: ${known.join(", ")}`);
    }
    const track = action.name === "log_event" ? action.args.custom?.track : null;
    if (track) track.crossed = traceTrack(track.aim, track.from, state.day.body.sex);
    try {
      apply(action);
    } catch (e: unknown) {
      return refusal(`${name} was not applied. ${e instanceof Error ? e.message : String(e)}`);
    }
    if (action.name === "guide") for (const step of action.args.steps) step.unverified = unverifiedNumbers(step.say, book);
    send({ type: "action", name, args: action.args });
    if (action.name === "guide") {
      guided = true;
      return answer("On screen. Now call reply.");
    }
    if (action.name === "what_if" && state.view.whatIf) {
      const alternative = simulate({ ...state.day, activities: state.view.whatIf.activities });
      return told(JSON.stringify({ alternative: action.args.label, ...readout(alternative, action.args.until) }));
    }
    if (track) return report(state.now, { this_line_crosses: track.crossed?.map((part) => part.name) ?? [] });
    return afterLogging();
  }

  const actionTools = actionToolsFor(mode).map((name) => tool(name, ACTION_DESCRIPTIONS[name], name === "log_intake" ? OWN_ESTIMATE_SHAPE : ACTION_SCHEMAS[name].shape, (args: unknown) => runAction(name, args)));

  // A food from the table reaches the page as an ordinary log_intake, with the composition filled in here.
  const logIntake = (args: Extract<Action, { name: "log_intake" }>["args"]) => {
    const logged: Action = { name: "log_intake", args };
    apply(logged);
    send({ type: "action", name: logged.name, args: logged.args });
    return afterLogging();
  };

  const nutrientArgs = (n: ReturnType<typeof nutrientsOf>) => ({ grams: n.grams, water_ml: n.waterMl, carbs_g: n.carbsG, sugar_g: n.sugarG, fat_g: n.fatG, protein_g: n.proteinG, fiber_g: n.fiberG, caffeine_mg: n.caffeineMg, alcohol_g: n.alcoholG });

  const logFood = (args: z.infer<typeof LOG_FOOD>) => {
    const food = foodById(args.fdc_id);
    if (!food) return refusal(`log_food was not applied. No food ${args.fdc_id}. Use an id find_foods returned.`);
    return logIntake({ id: args.id, label: args.label, at: args.at, ...nutrientArgs(nutrientsOf(food, args.servings * args.serving_grams)), liquid: args.liquid, fructose_share: args.fructose_share, assumption: args.assumption, serving: { label: args.serving_label, grams: args.serving_grams }, source: sourceOf(food) });
  };

  const logDish = (args: z.infer<typeof LOG_DISH>) => {
    const parts = args.ingredients.flatMap((part) => {
      const food = foodById(part.fdc_id);
      return food ? [{ food: food as Food, grams: part.grams }] : [];
    });
    const unknown = args.ingredients.filter((part) => !foodById(part.fdc_id)).map((part) => part.fdc_id);
    if (unknown.length) return refusal(`log_dish was not applied. No food ${unknown.join(", ")}. Use ids find_foods returned.`);
    const { nutrients, source } = combineIngredients(parts);
    return logIntake({ id: args.id, label: args.label, at: args.at, ...nutrientArgs(nutrients), liquid: args.liquid, assumption: args.assumption, serving: { label: args.serving_label, grams: nutrients.grams / args.servings }, source });
  };

  const tools = [
    ...actionTools,
    tool(
      "find_foods",
      'Looks foods up in the USDA FoodData Central table. Call it once with everything in the message, in generic food words, because the table has few brands: "cola" for a Coke, "pizza cheese", "beer". Returns up to 6 rows per query, each with an id for log_food, its composition and the portions the table knows. If nothing fits, search again with another word before estimating.',
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
        return result.started ? answer("Started. Tell them it is being added and will appear on the body once its tests pass.") : refusal(`Not started. ${result.reason}`);
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
              organ: z.enum(ORGANS).optional().describe("The organ this line is about; hovering the line highlights it"),
            }),
          )
          .min(1)
          .max(3),
      },
      async ({ lines }) => {
        if (mode === "ask" && !guided && !remindedToGuide) {
          remindedToGuide = true;
          return refusal("Not shown. They asked in Ask to see it on the body, so call guide first, then reply. If this is a reply where nothing should be shown, such as telling them to get help, call reply again as it is.");
        }
        const long = lines.filter((line) => line.text.trim().split(/\s+/).length >= REPLY_WORDS_UNDER);
        if (long.length) return refusal(`Not shown. Shorten to under ${REPLY_WORDS_UNDER} words: ${long.map((line) => `"${line.text}"`).join(", ")}. Call reply again.`);
        replied = true;
        send({ type: "reply", lines: lines.map((line) => ({ ...line, unverified: unverifiedNumbers(line.text, book) })) });
        return answer("Shown to the person. Your turn is over.");
      },
    ),
  ];

  const prompt = renderContext(state, text, mode, history, date);
  book.add(prompt);
  return { tools, prompt, systemPrompt: systemPromptFor(mode, depth, plan), state: () => state, replied: () => replied };
}
