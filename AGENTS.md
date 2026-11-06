# Working in Bodylang

Bodylang is a local app for one person. A per-minute physiology model (`src/model`) computes a whole day from what the person logged, a 3D body and panels (`src/scene`, `src/ui`) draw that result, and Claude reaches the model through the Vite dev server (`server/`). `README.md` says how to run it and where each file is. `PLAN.md` holds the product design.

Most of this code is written by agents, so the repository checks what an agent would forget. When you add something, the compiler or a test should tell you what is missing. If you find a place where neither does, add the check.

## Commands

Run this before every commit. It runs the type check, the format check and all tests, in about 20 seconds. `vitest` strips types, so a test run alone proves nothing about them.

```bash
pnpm check
```

To write formatting changes:

```bash
pnpm format
```

To run the app for testing, use a second server with its own data folder. The person's real days live in `~/.bodylang/days`, and a test must never touch them. Port 5183, which `pnpm dev` uses, is their own server and may also feed a wallpaper. Anything that calls Claude needs `ANTHROPIC_API_KEY` in the server's environment. `pnpm check` and `?demo` don't. The port is strict, so if 5199 is taken, another session is using it and you should pick another.

```bash
BODYLANG_DATA=/tmp/bodylang-test pnpm exec vite --port 5199
```

## Rules

- **Saved days.** Never read or write `~/.bodylang/days`. A saved file is a `DayDoc` (`src/model/day.ts`) with `version: 1`, and it stores `Body`, `Intake`, `ActivitySpan`, `CustomSubstance`, `BodyEvent` and `Cycle` under their own field names. Renaming any of those fields would lose saved days, so it needs a forward migration: raise the version and convert the old shape in `parseDayDoc`, which today rejects every other version. `dayDocSchema` in the same file also names those fields, behind a cast that hides them from the compiler, and `server/tell.ts` validates requests with it.
- **The look.** Colours, type, spacing and every tuned constant in the scene stay as they are unless a maintainer asks. A colour change needs a maintainer's approval on a mock. `WALL_FPS` in `src/wall.ts` stays 90.
- **Tests.** Test backend logic and complicated things. Write no component tests, DOM tests or screenshot suites. When a component holds logic worth testing, move that logic into a plain function and test the function.
- **Money.** A Tell costs about $0.03 and an Ask about $0.10. You can run those to check your work. Builds are off unless the server has `BODYLANG_BUILDS=1`. A real process build costs about $0.80 and takes minutes, so it needs a go-ahead from the person you work for. A build that passes commits to the checked-out branch from any server, including one on port 5199, because `BODYLANG_DATA` moves only the days and the builds folder. `tools/speed-bench.mjs` defaults to a $12 budget, so ask first and pass `--budget`.
- **Failures.** Add no fallback or retry paths. Let a failure show, in words that say what to do about it.
- **Git.** Several agent sessions may share this checkout, so `HEAD` can move while you work. Run `git status` and `git log -3` before you commit, check `git diff --cached` for what another session staged, and commit with explicit paths: `git commit -m "..." -- <paths>`. Never use `commit -a`.
- **Commit messages.** Write one plain sentence in the style of `git log`, saying what is now true. Add no `Co-Authored-By` trailer and no generated-with line.

## How a sentence becomes a picture

The person types "An hour ago I had a coffee".

```text
src/ui/tell.ts        POST /api/tell with the text, the BodyState and the mode
server/routes.ts      checks the request, then loads the handler
server/tell.ts        runs the Claude turn
server/tellTurn.ts    the tools Claude can call        server/tellPrompt.ts  the prompts
   Claude calls       find_foods, log_food, show_system, read_body, reply
   each change        reduce(state, action), then sends the action to the page
src/store.ts          the same reduce on the page, then simulate(day) gives a Trajectory
src/model/*           pure readers of the trajectory at a minute: assess, processesAt, processLanes, threadsAt, readout
src/scene, src/ui     draw what the readers return
```

`reduce` in `src/actions/reduce.ts` is how anything gets logged, for Claude, the demo and the browser alike. The store also writes a day directly for the measurement sliders (`setBody`), applying a what-if, loading a saved file and leaving Ask. Claude turns are stateless: each request carries the whole state and replays through `reduce`. A `BodyState` has three parts: `day` is what happened and gets saved, `now` is the clock, and `view` is where the person is looking. Ask mode runs the same tools on a copy of the day, and leaving Ask restores the original objects.

The dev server loads server files per request through `ssrLoadModule`, so editing one never restarts the server. `vite.config.ts` may import server code as types only. A runtime import would make every model file a config dependency, and each edit would restart the server and strand the wallpaper on a dead page.

| Word | Meaning |
|---|---|
| Trajectory | The result of one `simulate` run: every curve for the whole day |
| Series | One named per-minute curve in a trajectory, such as `glucose`. Listed in `SERIES` in `src/model/engine/trajectory.ts` |
| Channel | A per-minute push from events onto the loop in `src/model/engine/simulate.ts`, such as `heartRate` |
| Ledger | Where one thing you ate is at each minute, in kcal: stomach, intestine, blood, liver, muscle, fat, burned, colon |
| System | One section in the left list, with its own page. `SYSTEMS` in `src/model/systems.ts` lists them, and an id can differ from its title: `immune` is "Illness & recovery" |
| Reading | One value on a system's page with its typical band and verdict |
| Process | A numbered line through the body, such as a meal's route |
| Thread | One row per thing the person told it, such as pizza or a cold |
| Lane | One row of the day chart |
| Close-up | An organ's animated drawing in the right panel, driven by levels from 0 to 1 |
| What-if | An alternative activity drawn on the day chart without changing the day, from the `what_if` tool in Tell |
| Tell, Ask | Tell changes your day. Ask works on a copy. Simple and Deep are Ask's two depths |
| Walkthrough | The steps of an Ask answer, which Claude gives through the `guide` tool. Each step moves the view and the time and shows its words |
| Composed drawing | A close-up Claude designs for one answer from layers and actors, with code doing the layout |
| Readout | What Claude reads: `readout(trajectory, minute)` in `src/model/readout.ts`, a summary of the body at one minute |
| Build | A separate Claude session that writes a new process in a throwaway git worktree, started by the `add_process` tool, which exists only with `BODYLANG_BUILDS=1` |
| Gate | The checks a build must pass before its two files land: `server/extendCheck.ts`, `src/model/extensions/check.ts`, then every test |
| Demo | `?demo`, which replays a scripted day with no Claude call and saves nothing |
| Wallpaper | The same page at `?wall`, shown as a desktop wallpaper by the Plash app |
| Evidence grade | `A`, `B` or `C` beside a number or line, for how strong its source is |

## Layers

`src/layers.test.ts` fails on an import in the wrong direction and on any import cycle, counting type imports. Test files are exempt.

| Part | May import |
|---|---|
| `src/model` | nothing else in `src` |
| `src/look.ts`, `src/closeup` | `model` |
| `src/actions` | `closeup`, `model` |
| `src/wire.ts`, `src/wall.ts` | nothing else in `src` |
| `src/scene` | `look`, `model`, `wall` |
| `src/store.ts` | `actions`, `look`, `model`, `wire` |
| `src/ui` | all of the above |
| `src/main.tsx` | `ui` |
| `server/` | `actions`, `closeup`, `model`, `wire` |

## Adding things

Start by adding the name to its list, then run `pnpm exec tsc --noEmit`. Each recipe below says what the compiler will ask for and what you must remember yourself. The compiler lists were measured by doing it.

Adding a reading, curve, line or organ moves the golden test on every day, because it hashes those lists. Regenerate it as your last step and read the diff. A new curve adds a line, which is fine. The existing `series`, `channel` and `ledger` lines should stay the same unless you meant to change the model.

### An event preset

1. Add the name to `PRESETS` in `src/model/events/types.ts`.
2. The compiler then asks for `endOf` in `src/model/events/muscles.ts`, `resolveEvent` and `PRESET_FACTS` in `src/model/events/presets.ts`, the headline in `src/model/processes/event.ts`, and the status word in `src/model/threads.ts`.
3. Nothing asks for its numbers: put them in a block in `src/model/params.ts`, with sources.
4. Add a `- <preset>:` line to `log_event` in `ACTION_DESCRIPTIONS` in `server/tellPrompt.ts`. A test in `server/tellTurn.test.ts` fails without it.
5. Update what nothing checks: the list under "What happened, and which tool records it" in `SYSTEM_PROMPT` in `server/tellPrompt.ts`, which names the presets and gives examples of custom events, and the `intensity` text and per-preset rules of `log_event` in `src/actions/schemas.ts`.
6. Nothing asks for its tests either: add a day using the preset to `SCENARIOS` in `src/model/testScenarios.ts`, regenerate the golden test, and pin its published numbers in `src/model/published.test.ts`.

### A reading

1. Add the id to `ReadingId` in `src/model/ids.ts`.
2. The compiler then asks for `READINGS` in `src/model/assess/assess.ts` and `READING_INPUTS` in `src/model/origin.ts`.
3. Write its spec in `src/model/assess/readings/<group>.ts`, and put its typical band in `REFERENCE` in `params.ts`.
4. Put it in a system's `readings` or `more` in `src/model/systems.ts`. A test in `src/model/assess/assess.test.ts` fails if it is on no page. Nothing checks these two: add it to `ALL_READINGS` in that test file so the whole-day tests cover it, and to `readout` in `src/model/readout.ts` if Claude should be able to state it.
5. If it needs a new curve, add the name to `SERIES` in `engine/trajectory.ts` and write it in `recordSeries` in `engine/simulate.ts`. The compiler says nothing here. `engine.test.ts` fails on a curve that stays at zero on every day in `SCENARIOS`.

### A process

- **One that reads curves the model already has:** add one file, `src/model/extensions/<id>.ts`, that exports `extension` and follows `api.ts`, with `<id>.test.ts` beside it. The gate wants at least three tests there, using the real model through `simulate`. The app finds it by itself. `contract.test.ts` holds a small working sample and everything the contract checks, and `thyroid.ts` is a real one. It cannot change any number on screen, so prefer this form.
- **A line that runs all day:** add the id to `BodyLineId` in `src/model/ids.ts`, and the compiler asks for its row in `BODY_LINES` in `processes/bodyLines.ts`. Write the builder in `processes/body.ts` and add it to `PROCESS_BUILDERS` in `processes/processes.ts`. Nothing checks that last step.

### A tool Claude can call

A tool that leaves the day and the view alone, such as `find_foods`, `read_body` or `add_process`, is one `tool(...)` entry in `startTurn` in `server/tellTurn.ts`, tested in `server/tellTurn.test.ts`. If it returns numbers Claude may state, return them through `told`, a helper in that function, or the number check will mark them as invented. A tool that changes the day or the view is an action:

1. Add its schema to `ACTION_SCHEMAS` in `src/actions/schemas.ts`.
2. The compiler then asks for `reduce` in `actions/reduce.ts`, `traceLine` in `actions/trace.ts` and `ACTION_DESCRIPTIONS` in `server/tellPrompt.ts`.
3. Say when to use it in `SYSTEM_PROMPT` in `server/tellPrompt.ts`, in the list under "What happened, and which tool records it". Nothing checks this.
4. Test the reducer in `src/actions/reduce.test.ts`, and the tool in `server/tellTurn.test.ts`, which calls tools the way Claude would with no Claude in the room.

### An organ

1. Add it to `ORGANS` in `src/model/ids.ts`.
2. The compiler then asks for `ORGAN_NAME` and `ORGAN_HOME` in `model/systems.ts`, `TARGET_ROUTES` and `TARGET_SYSTEM` in `processes/dose.ts`, `FOCUS_VIEWS` and the anchor `switch` in `scene/stage.ts`, `FIGURES` in `ui/insets/OrganInset.tsx`, `STORIES` in `ui/insets/organStory.ts`, and `EVERY_ORGAN` in `closeup/organs.test.ts`.
3. `closeup/organs.test.ts` then fails until the organ has a close-up. Follow the next recipe.
4. Nothing asks for these: the mesh (`src/scene/anatomy.ts`, `ORGANS` in `pipeline/build_atlas.py`, `public/assets/`), `MESHES` in `server/track.ts` so an injury's path can cross it, the `organs` of a system in `SYSTEMS` in `model/systems.ts`, the `ORGANS` list in `scene/stage.ts`, and how brightly it lights on the body in `scene/organStates.ts`.

### A part with no organ of its own, such as a gland

Nothing asks for any of this. Add it to `ORGANS` in `pipeline/build_atlas.py` and rebuild, to `PARTS` and `PART_NAMES` in `src/scene/anatomy.ts`, and to `MESHES` in `server/track.ts`. To light it on a page, add it to that view's `parts` in `scene/stage.ts`, and to `PART_LABELS` if the page should name it. To make a process stop on it, add the stop's label to `GLAND_OF_STOP` in `anatomy.ts`. `scene/anatomy.test.ts` fails if no process uses that label any more.

### A close-up

1. Write `src/closeup/<organ>.ts` with `defineCloseup`. Each level runs from 0 to 1 and has a meaning in words. Nothing in this file draws, because the server loads it to check a walkthrough.
2. Add it to both `CLOSEUPS` and `closeupSpec` in `src/closeup/list.ts`.
3. Draw it in `src/ui/insets/<Organ>Inset.tsx` and add it to `FIGURES`. Use the shared parts in `src/ui/insets/parts/`, and have each caption read its level, so a caption matches what a walkthrough step set.

### A server route, or something that crosses to the browser

Add one row to `ROUTES` in `server/routes.ts`. Define every shape both sides read in `src/wire.ts` as a zod schema, and let the handler throw `BadRequest` for bad input.

## How to know you changed nothing

**The golden test** (`src/golden.test.ts`) hashes what the model computes across every day in `SCENARIOS`. If it fails during a refactor, you moved a number. The failure names the day and what moved, such as `series hr` or `assess`, so trace that curve or reader back to your change. Added processes are mocked out, so they never move it. When a number is meant to change, regenerate it and say in the commit message what moved and why:

```bash
pnpm exec vitest run src/golden.test.ts -u
```

Never pass `--update=false`: in Vitest 5 it writes snapshots too.

**The look** can only be checked by a photograph. A hidden browser pane stops the frame loop and leaves the body blank, so use real WebKit off-screen:

```bash
swiftc tools/webkitshot.swift -o /tmp/webkitshot
```

```bash
/tmp/webkitshot "http://localhost:5199/?demo" 1440 900 14 /tmp/after.png 'window.bodylang.dispatch({name:"show_system",args:{system:"immune"}})'
```

The arguments are the URL, width, height, seconds to wait, output file, and JavaScript to run before the shot, which is how you reach a view. Use `?demo`, because a plain page loads and saves a real day. WebKit keeps the page's stored theme between runs, so a Light click carries over to the next shot.

Photograph the same view before and after your change, and compare by eye or with Pillow's `ImageChops.difference`. The body area differs by animation frame, and a label on the figure can land on either side. The side panels and the day chart should match exactly, except for moving particles in a close-up.

**Claude's behaviour** can only be checked by a live run. Tests call the tools with no Claude, and can only check which names a prompt mentions. After changing a prompt or a tool, send a real Tell and a real Ask on the port 5199 server.

## What must survive

Removing any of these is a product decision for a maintainer, as is removing the shared `reduce` or Ask's copy described above.

- Everything on screen is a pure function of the trajectory and the minute. Scene targets are pure, values ease toward them, and ambient phases such as the heartbeat run on their own clocks.
- `simulate` is bit-deterministic.
- No API key reaches the browser, and a request from another origin is refused (`server/requestGuard.ts`).
- Claude runs on the person's own `ANTHROPIC_API_KEY`, with no fallback to a Claude login (`server/claude.ts`).
- Builds and removing a process stay off unless a person sets `BODYLANG_BUILDS=1`, because each one commits to their checkout.
- Added processes get a read-only `BodyView`, are one file and its test, and land only as one commit after every test passes.
- Numbers carry their sources and evidence grades. Ledgers conserve energy, with fibre's energy counted on top. `published.test.ts` pins the model to published figures.
- `server/numberCheck.ts` marks any number in a reply that the model never returned.
- Close-up levels run from 0 to 1 with meanings in words. Claude gives no positions in composed drawings; code does the layout.

## Paths that break silently when files move

- `tools/speed-bench.mjs` is outside `tsc`, and it builds its own state. `server/routes.test.ts` checks that the files it and `vite.config.ts` load by path exist and that `runTell` is exported, and nothing checks the state's shape.
- Paths relative to the working directory: `server/foods.ts`, `server/track.ts`, `server/extend.ts`.
- What a build is told: `server/extendSession.ts` names `SERIES`, `ROUTE_IDS`, `alertnessProcess` and `contract.test.ts` by file. `extendCheck.test.ts` checks that the paths exist, and nothing checks the names.
- What a build may import: `MODEL_FOR_TESTS` in `server/extendCheck.ts`. `extendCheck.test.ts` checks that those files exist.
- Asset paths: `src/scene/assets.ts` and the output paths at the top of each `pipeline/build_*.py`.

## Writing code here

- The engine is plain step functions over parameter objects. `simulate` takes about 2.5 ms and runs on every change to the day, so keep allocations out of the per-minute loop.
- Use a `Record` keyed by a union for anything per organ, reading or preset, so a missed entry fails to compile. Use `const exhaustive: never` in the default arm of a switch.
- A row in `assess/systemStatus.ts` is `[test, word]` or `[test, word, says]`, and the first row whose test passes wins, so a word and its sentence sit in one row.
- Every physiology number lives in `src/model/params.ts`, with its source. A display threshold sits beside its sentence in the table that uses it.
- Parse where data crosses in, with zod, and trust the types inside. Prefer `import type` for types.
- Write a comment only for why something is the way it is, in plain words.
- Don't add state libraries, slices, dependency injection, barrel files, Express, an ECS or a layer interface. Nothing here needs them.
- Prompts in `server/tellPrompt.ts` and `server/extendSession.ts` keep one paragraph per line. Claude may state only numbers its tools returned, and `server/numberCheck.ts` marks the rest.
- Words on screen and in docs: say what a thing is and does, with no em dashes and no "not X but Y" framing.
