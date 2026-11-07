# Working in Bodylang

Bodylang is a local app for one person. A per-minute physiology model (`src/model`) computes a whole day from what the person logged, a 3D body and panels (`src/scene`, `src/ui`) draw that result, and an LLM reaches the model through the Vite dev server (`server/`). `README.md` says how to run it, `docs/development.md` says where each file is, and `ARCHITECTURE.md` holds the product design.

Most of this code is written by agents, so the repository checks what an agent would forget: when you add something, the compiler or a test should tell you what is missing. Where neither does, add the check.

## Commands

```bash
pnpm check
```

Run it before every commit: type check, Biome format check and all tests, in about 20 seconds. `vitest` alone strips types, so a test run proves nothing about them. `pnpm format` writes the formatting.

To try the app, run a second server with its own data folder. Port 5183 (`pnpm dev`) is the person's own server and may feed their wallpaper, and their real days live in `~/.bodylang/days`. The port is strict, so if 5199 is taken, another session has it and you should pick another.

```bash
BODYLANG_DATA=/tmp/bodylang-test pnpm exec vite --port 5199
```

`?demo` replays a scripted day with no LLM call and saves nothing, while a plain page loads and saves a day in the server's data folder. A Tell or an Ask needs a Claude login or `ANTHROPIC_API_KEY` in the server's environment (the key wins), or `pnpm login:openai` with `BODYLANG_LLM=openai`. `pnpm check` and `?demo` need neither.

To photograph a view, use real WebKit off-screen, because a hidden browser pane stops the frame loop and leaves the body blank. The arguments are URL, width, height, seconds to wait, output file, and JavaScript to run first:

```bash
swiftc tools/webkitshot.swift -o /tmp/webkitshot
```

```bash
/tmp/webkitshot "http://localhost:5199/?demo" 1440 900 14 /tmp/after.png 'window.bodylang.dispatch({name:"show_system",args:{system:"immune"}})'
```

## Rules

- **Saved days.** Never read or write `~/.bodylang/days`. A day file is a `DayDoc` (`src/model/day.ts`, `version: 1`) storing `Body`, `Intake`, `ActivitySpan`, `CustomSubstance`, `BodyEvent` and `Cycle` under their own field names, which a cast in `dayDocSchema` hides from the compiler. Renaming one loses saved days unless you raise the version and convert the old shape in `parseDayDoc`.
- **The look.** Colours, type, spacing and the scene's tuned constants stay unless a maintainer asks, and a colour change needs their approval on a mock. `WALL_FPS` in `src/wall.ts` stays 90.
- **Tests.** Test backend logic and complicated things, with no component, DOM or screenshot tests. Logic worth testing in a component moves into a plain function.
- **Money.** A Tell costs about $0.03 and an Ask about $0.10, and you may run them to check your work. A process build costs about $0.80 and needs the person's go-ahead. Builds run only with `BODYLANG_BUILDS=1`, and a passing one commits to the checked-out branch from any server, 5199 included, because `BODYLANG_DATA` moves only the days and the builds folder. `tools/speed-bench.mjs` defaults to a $12 budget: ask first and pass `--budget`.
- **Failures.** Add no fallback or retry paths. Let a failure show, in words that say what to do about it.
- **Git.** Several sessions share this checkout, so `HEAD` can move while you work. Before committing, run `git status` and `git log -3`, read `git diff --cached` for what another session staged, and commit with explicit paths: `git commit -m "..." -- <paths>`. Never `commit -a`.
- **Commit messages.** One plain sentence saying what is now true, in the style of `git log`, with no `Co-Authored-By` or generated-with line.
- **Words.** Text on screen and in docs says what a thing is and does, with no em dashes and no "not X but Y". An explanation says what is happening, why, and what it means for the person, and leaves grams, kcal and concentrations to the figure shown beside it (a stop's `reading` field): `weighsSomething` in `src/model/words.ts` fails a sentence that states one. A number stays in the words only if it is a time the person can use, a limit they would act on, a surprising comparison, something they can check, or something they asked for. `howMuch` and `aboutClock` say amounts and times the way a person does.

## How it fits together

The person types "An hour ago I had a coffee". `src/ui/tell.ts` posts it with the whole `BodyState` to `/api/tell`, and `server/tell.ts` runs one LLM turn with the tools in `server/tellTurn.ts` and the prompts in `server/tellPrompt.ts`. A tool that changes something is an action: the server applies `reduce(state, action)` (`src/actions/reduce.ts`) and sends the action to the page, where `src/store.ts` applies the same `reduce` and runs `simulate(day)`. That returns a Trajectory, every per-minute curve of the day: the series in `SERIES` (`src/model/engine/trajectory.ts`), the channels events push onto the loop in `engine/simulate.ts` such as `heartRate`, and a ledger per food of where its kcal are. Pure readers in `src/model` read it at a minute, and `src/scene` and `src/ui` draw what they return. The LLM reads it through `readout(trajectory, minute)` in `src/model/readout.ts`.

- `reduce` is how anything gets logged, for the LLM, the demo and the browser alike. The store sets state directly, without `reduce`, only for the measurement sliders (`setBody`), applying a what-if to the day, loading a file and leaving Ask.
- Turns are stateless: each request carries the whole state. A `BodyState` is `day` (what happened, saved), `now` (the clock) and `view` (where the person is looking). Tell changes the day. Ask, at Simple or Deep depth, runs the same tools on a copy of the day, and leaving Ask restores the original objects.
- The dev server loads server files per request through `ssrLoadModule`, so editing one never restarts it. `vite.config.ts` imports server code as types only, because a runtime import makes every model file a config dependency, and each edit would restart the server and strand the wallpaper.
- `src/layers.test.ts` holds which part may import which (`MAY_IMPORT`) and fails on a wrong direction or any import cycle.

The person names what they see on screen. Here is where each thing lives:

| On screen | What it is | Where |
|---|---|---|
| A section in the left list | A system. An id can differ from its title: `immune` is "Illness & recovery" | `SYSTEMS` in `src/model/systems.ts`, `src/ui/Rail.tsx` |
| The right panel | A system's page of readings, each with its typical band and verdict, or an organ's page | `src/ui/SystemPage.tsx`, `src/ui/OrganPage.tsx`, `src/model/assess` |
| The drawing at the top right | A close-up, an organ's animated drawing driven by levels from 0 to 1 | `src/closeup`, `src/ui/insets` |
| The chart at the bottom | The day chart, one lane per row | `src/ui/DayPanel.tsx`, `src/ui/dayChart.ts`, `src/model/lanes.ts` |
| A numbered line on the body | A process, such as a meal's route | `src/model/processes`, `src/scene/processLine.ts` |
| A row per thing told, such as pizza or a cold | A thread | `src/model/threads.ts` |
| A different choice drawn on the day chart under an answer | A what-if, from the `what_if` tool, which leaves the day alone | `src/actions/schemas.ts` |
| The steps of an Ask answer | A walkthrough from the `guide` tool, each step moving the view and the time | `src/ui/Ask.tsx`, `guide` in `src/actions/schemas.ts` |
| The desktop wallpaper | The same page at `?wall`, shown by the Plash app | `src/wall.ts` |

## Adding things

Add the name to its list, run `pnpm exec tsc --noEmit`, and fill in what the compiler asks for. Before adding an event preset, reading, process, tool, organ, gland, close-up or server route, read [`docs/adding.md`](docs/adding.md), which lists the steps nothing checks. A new preset, reading, curve, built-in line or organ moves the golden test, which hashes those lists, so regenerate it last.

## Checking what you changed

- **Numbers.** `src/golden.test.ts` hashes what the model computes on every day in `SCENARIOS`, with added processes mocked out, and a failure names the day and what moved, such as `series hr`. In a refactor, that means you moved a number: trace that curve or reader back to your change and undo it, without regenerating. When one is meant to move, run `pnpm exec vitest run src/golden.test.ts -u`, read the diff (the existing `series`, `channel` and `ledger` lines should stay unless you meant to change the model), and say in the commit message what moved and why. Never pass `--update=false`, which in Vitest 5 writes snapshots too.
- **The look.** Photograph the same view with `webkitshot` before and after, and compare them. The body differs by animation frame, and a label on the figure can land on either side. The side panels and the day chart should match exactly, apart from moving particles in a close-up. WebKit keeps the page's stored theme between runs.
- **The LLM's behaviour.** Tests call the tools with no LLM and can only check which names a prompt mentions. After changing a prompt or a tool, send a real Tell and a real Ask on your test server.

## What must survive

Removing any of these is a product decision for a maintainer, as is removing the shared `reduce` or Ask's copy.

- Everything on screen is a pure function of the trajectory and the minute. Scene targets are pure, values ease toward them, and ambient phases such as the heartbeat run on their own clocks.
- `simulate` is bit-deterministic and takes about 2.5 ms on every change, so keep allocations out of its per-minute loop.
- No key reaches the browser, and `server/requestGuard.ts` refuses requests from another origin.
- The LLM runs on the person's own login or key, which Bodylang never reads or stores (`server/claude.ts`, `server/codex.ts`). A session gets Bodylang's tools and nothing else: `claudeDefaults` keeps a subscription's connectors out, and `lockdownArgs` and `withoutEditsOrSubAgents` remove Codex's shell, file edits, web search, sub-agents and skills. When Codex is updated, check that again by reading the tool list it sends.
- A build is a separate LLM session, started by the `add_process` tool, that writes a new process in a throwaway git worktree. Builds and removing a process stay off without `BODYLANG_BUILDS=1`. An added process gets a read-only `BodyView`, is one file and its test, and lands as one commit only after the gate passes: `server/extendCheck.ts`, `src/model/extensions/check.ts`, then every test.
- Every physiology number lives in `src/model/params.ts` with its source and evidence grade (`A`, `B` or `C`), and a display threshold sits beside its sentence. Ledgers conserve energy, with fibre's counted on top, and `published.test.ts` pins the model to published figures.
- The LLM may state only numbers its tools returned, and `server/numberCheck.ts` marks any other.
- Close-up levels run from 0 to 1 with meanings in words. In a composed drawing the LLM gives no positions, and code does the layout.

## Writing code here

- The engine is plain step functions over parameter objects. Add no state libraries, slices, dependency injection, barrel files, Express, ECS or layer interface.
- Key anything per organ, reading or preset with a `Record` over the union, and put `const exhaustive: never` in a switch's default arm, so a missed entry fails to compile.
- Parse with zod where data crosses in, and trust the types inside. Prefer `import type`.
- Write a comment only for why something is the way it is.
- Prompts in `server/tellPrompt.ts` (which holds `SYSTEM_PROMPT` and `ACTION_DESCRIPTIONS`) and `server/extendSession.ts` keep one paragraph per line.
- When you move a file, search for its path in strings. These resolve paths from the working directory: `server/foods.ts`, `server/track.ts`, `server/extend.ts` and `server/codex.ts`, as do `src/scene/assets.ts` and the output paths atop each `pipeline/build_*.py`. A build is told `SERIES`, `ROUTE_IDS`, `alertnessProcess` and `contract.test.ts` by name in `server/extendSession.ts`, and may import only `MODEL_FOR_TESTS` in `server/extendCheck.ts`. `tools/speed-bench.mjs` is outside `tsc` and builds its own state, which nothing checks.
