# Bodylang refactor plan

This plan turns Bodylang into code where each fact lives in one place and adding something means editing one table. The code is healthier than it feels: at commit `9de7357` the typecheck is clean, the 754 tests at the start of the audit all pass, the physiology model has 96% line coverage, and no module imports another in a cycle at runtime. What hurts is that the explanations recompute the engine's formulas by hand, one new reading or organ touches up to 18 files with little help from the compiler, shared types live in the wrong files, and several files hold many jobs under misleading names.

The audit also found 32 bugs, listed in section 3. The most serious are that any web page can start a paid Claude turn through the dev server, and that several numbers on screen are wrong, such as a beer reporting 156 kcal while its ledger holds 58.

## Status

The owner approved this plan on 2026-11-06 with these changes:

- Phases 0 to 4 run end to end. Phases 5, 6 and 7 are out of scope, because the UI, style and colours are good and stay as they are. Their steps below remain as notes for later.
- The UI and UX bugs from those phases (B14, B15, C1 to C8, C10) move into phase 1 as small fixes with no restructuring. C9 stays as it is, because it is the tuned look.
- Phase 8 becomes the agentic development phase: `AGENTS.md`, formatter and docs, so other agents can work here easily.
- Where this plan says to stop for a choice, the executor takes the recommended option and reports it: B1 and decisions 2, 3, 4, 7, 8.

## What was done

Phases 0 to 4 and the agentic development phase are finished: commits `efde15f` onward on `main`. The sections below this one are the plan as written at commit `9de7357`, so their line numbers and file names are from before the work. `AGENTS.md` is the current guide. Phases 5, 6 and 7 did not run, and their steps stay as notes for later.

Proof that nothing moved by accident: the golden test held through every refactor commit, and changed only where a listed bug meant to change a number. A scene digest, since deleted, did the same for the 3D scene. At the end, four views of `?demo` photographed in WebKit before and after the refactor had identical side panels and day charts; the body area and the close-up particles differ only by animation frame.

The plan left these for the owner, and the executor took the recommended option:

| Item | What was picked |
|---|---|
| B1 | Alcohol stays out of the "% left" total (`foodKcalOf`), and `alcoholLedgerAt` tracks it in grams |
| B10 | The bladder warning rows that could never appear were removed, with a comment at `voidAtMl`. Thresholds did not change, so nothing changes on screen |
| C4 | The first `breathe` keyframes were dead and were removed, which leaves the look as it was |
| C9 | Left as it is |
| Decisions 2, 3, 4, 7 | Yes, as recommended |
| Decision 8 | `/api/snapshot` deleted. It can be restored from git |
| Decision 1 | Never answered. A heads-up went to the session that was running, with no reply |

The work differs from the plan in these places:

- **A3** rolls back after a failed commit (`landFiles` in `server/extend.ts`) where the plan wanted a private git index.
- **B7** stops a clock vouching for its parts. The rule that integers match within 0.5 stays.
- **B13** leaves `read_body` at today only, with a line in the prompt that says so.
- **B15** hides the model's caption when a step sets levels (`captionFromModel`). The lungs' cough word under reduced motion stays, because it still says what the drawing means.
- **C2** gives the walkthrough the arrow keys whenever it is open (`s.touring || s.asking?.guideOpen`).
- **C8** fixes the leaked listener. Geometries are still not disposed on a Fast Refresh remount.
- **C10** adds `DrawingBoundary` around a drawing. `parts()` still returns empty for a misnamed part.
- **C11** pins the pipeline's packages in `pipeline/requirements.txt`. No assets were rebuilt, so `anny` and `torch` at those versions have not been run.
- **Theme rename** resets a stored theme once, because `plate` and `xray` became `light` and `dark`. `rememberLook` ignores anything it can't read.
- **Left where they were:** display thresholds stay beside their sentences in the spec tables, `organStates` keeps its 60 numbers because phase 5 did not run, `lanes.ts` stays in `model/`, and the overlapping test sweeps were not merged.

Found at the end and fixed:

- The 30 golden days had no menstrual cycle and no jittery amount of caffeine, so `cycleDay`, `estradiol`, `progesterone`, `lh` and `jitter` were not pinned during the refactor. A direct comparison with the pre-refactor code on three cycle days and one heavy-caffeine day showed every series bit-identical, and the set now has 33 days.
- `remove_intake` left the food's assumption behind in the saved day.

Seen once and not fixed: in one live Tell out of seven, Claude logged an empty entry called `dummy`, removed it, and apologised in its reply. The other six runs of the same sentence were clean, and the cause is unknown.

| Phase | Goal | Commits (estimate) | Changes what you see |
|---|---|---:|---|
| 0 | Safety net, faster tests, dead code removed | 8 | No |
| 1 | Bugs in safety, data and on-screen numbers | 18 | Yes, each one listed |
| 2 | Shared types and layers in the right place, whole-file renames | 10 | No, apart from one reset of the stored theme |
| 3 | Model: engine steps, one formula per fact, tables | 25 | Bugs B2 and B11, plus word changes the owner approves |
| 4 | Server and actions: routes, wire types, testable Claude turn | 10 | Only bug B13, in Claude's answers |
| 5 | Scene: pure logic out of the WebGL class | 10 | Only bugs C5 to C8 |
| 6 | Close-ups: one home per organ | 10 | Only bugs B14, B15, C10 |
| 7 | UI: one `Level` type, chart layout, folders | 12 | Only bugs C1 to C4 |
| 8 | Formatter, repo instructions, docs. Runs after whichever phase is last | 3 | No |

The commit counts are my estimates. They exist to show relative size.

### Words used in this plan

| Word | Meaning |
|---|---|
| Trajectory | The result of one `simulate` run: every curve for the whole day |
| Series | One named per-minute curve in a trajectory, such as `glucose` |
| Channel | A per-minute push from events onto something in the loop, such as `heartRate` |
| Ledger | Where one thing you ate is at each minute, in kcal: stomach, intestine, blood, liver, muscle, fat, burned, colon |
| Reading | One value on a page with its typical band and verdict, such as blood sugar |
| Process | A numbered line through the body, such as a meal's route. Some code calls it a "line" |
| Thread | One row per thing you told it, such as pizza or a cold |
| Lane | One row of the day chart |
| Level | Where you are on screen. `PLAN.md` defines 0 overview, 1 system, 2 thread, 3 organ or muscle |
| Close-up | An organ's animated drawing in the right panel. Its definition names levels from 0 to 1, and its painter writes them into the SVG each frame |
| Composed drawing | A close-up Claude designs from layers and actors, with code doing the layout |
| Build | A separate Claude session that writes a new process as code in a throwaway git worktree. `add_process` is the tool that starts one |
| Gate | The checks a build must pass before its files land: `server/extendCheck.ts`, `src/model/extensions/check.ts`, and the test run in `server/extend.ts` |
| Number check | `server/numberCheck.ts`, which marks any number in Claude's reply that the model never returned |
| Wallpaper | The same page at `?wall`, shown by the Plash app |
| Tell, Ask, Simple, Deep | Tell changes your day. Ask works on a copy of it. Simple and Deep are Ask's two depths |
| The demo | `?demo`, which replays a scripted day with no Claude call and saves nothing |
| Anny | The Python package that builds the body mesh in `pipeline/` |
| The owner | Yahor, who decides what section 9 lists |
| Golden test, digest | The two proofs described in section 6 |

## 1. What was measured

Line coverage comes from a run on a clean copy of commit `2aeedab`, one commit before `9de7357`, with nothing installed into the project.

| Area | Code lines | Test lines | Line coverage | Notes |
|---|---:|---:|---:|---|
| `src/model` and `extensions` | 7,689 | 3,639 | 96% | `simulate.ts` 100%, `assess.ts` 99%, `state.ts` 52% |
| `src/closeup` | 724 | 582 | 100% | |
| `src/agent` | 428 | 0 | 74% | Five model test files exercise `reduce` |
| `server` | 1,408 | 381 | 47% | `server/agent.ts` 0%, and it holds the Claude turn |
| `src/scene` | 5,942 | 478 | 61% | `stage.ts` and `organs.ts` 0%, the other large files 88% to 98% |
| `src/ui` | 5,143 | 260 | 4% | By decision, this stays low |
| `src/ui/insets` | 3,503 | 0 | 0% | By decision, this stays low |
| `pipeline` | 2,627 (Python) | 0 | Not measured | Runs rarely |

Other facts from the same audit:

- `tsc --noEmit` takes under a second and reports nothing.
- The suite takes 92 s, and `src/model/copy.test.ts` alone takes 91 s of that.
- There is 1 `any` in 25,000 lines, and exact duplicate blocks are rare (13 eight-line windows).
- 38 functions are over 60 lines and 14 are over 100. `simulate` is 512 lines.
- Eight model files form an import cycle through types only: `extensions/index.ts`, `state.ts`, `assess.ts`, `systems.ts`, `events.ts`, `simulate.ts`, `extensions/api.ts`, `processes.ts`.
- 64 files import `simulate.ts`. Four of them call `simulate`, 32 use read helpers such as `value`, and 28 import only types.
- 529 lines are over 160 characters. The repo has no formatter, linter or CI, and no git remote for CI to run on.
- Model outputs are identical bit for bit between runs. One `simulate` costs 6 to 29 ms and one `assess` under 0.5 ms, so a large golden test stays cheap.

## 2. What hurts, ranked by how much it slows the next change

**The explanations recompute the engine by hand.** `simulate.ts:713` computes the heart rate as resting rate plus activity plus `HEART.digestionGain * digest` plus caffeine plus event channels. `assess.ts:442` repeats `HEART.digestionGain * c.v("digestion")` to say why the heart is up. `assess.ts:1465` and `:1476` repeat the literals `0.7` and `0.6` from `simulate.ts:753`, and `processes.ts:710-712` rebuilds the uptake split. Change a formula in the loop and the sentence that explains it silently goes wrong. Bug B2 in section 3 is this failure happening already.

**Adding one thing means editing many files.** A custom substance is pure data, and an added process is one file in `src/model/extensions`. Everything else scatters:

| Adding | Places to edit | Fails silently if missed |
|---|---|---|
| Event preset | `PRESETS`, story, `resolveEvent`, end time (`events.ts`); a `params.ts` block; `eventHeadline` (`processes.ts`); `eventStatus`, `EVENT_KIND` (`threads.ts`); `EVENT_READINGS` (`lanes.ts`); `ACTIVITY_ROWS` (`assess.ts`); `actions.ts`; `server/agent.ts` | Several |
| Reading | `ReadingId`, spec, `READINGS`, `READING_ORDER` (`assess.ts`); `SERIES`, compute, record (`simulate.ts`); `REFERENCE`; `systems.ts`; `READING_CHANNELS`, `FOOD_READINGS` (`origin.ts`); `readout` | `READING_ORDER`, `origin.ts` |
| Built-in process | builder, `LINE_SOURCES`, `PROCESS_READINGS`, `LEFT_OUT`, `LIVE_LINES` | Several |
| Organ | 7 files around the close-up, plus 11 more that name organs: `actions.ts`, `server/agent.ts`, `extensions/check.ts`, `state.ts`, `processes.ts`, `simulate.ts`, `systems.ts`, `assess.ts`, `stage.ts`, `scene/organs.ts`, `server/track.ts` | The lists in `actions.ts:19`, `agent.ts:415`, `check.ts:7` |

**Shared types and names sit in misleading places.** This is most of why the structure feels frustrating. The folders are a smaller part of it.

- `OrganId` lives in `simulate.ts`, `RouteId` in `processes.ts`, `ReadingId` in `assess.ts`, `Tint` in `state.ts`, and `BodyState` in `agent/actions.ts`. That placement causes the type cycle and the 64 importers.
- `src/model/state.ts` is a mix of the scene's organ view, a second forecaster and English helpers.
- `src/model/day.ts`, `src/ui/day.ts` and `server/days.ts` hold three different things.
- `ui/Controls.tsx` holds the Header, `ui/Ask.tsx` holds the walkthrough panel `Guide`, `ui/Timeline.tsx` is what everyone calls the day chart, `ui/SourceTip.tsx` has no tip and no JSX, `ui/Build.tsx` is a process being added, and half of `ui/hooks.ts` is not hooks.
- "Stop" means four things: a numbered place on a process (`ProcessStop`), a place the chart's skip buttons land (`viewStops`), a walkthrough step on the chart (`StoryStop`), and the stop in the spotlight (`s.stop`). The theme has four vocabularies: `plate`/`xray`, `light`/`dark`, Paper/Black, and `.plate` as the root class.
- `s.body.body` is the person's measurements inside the state of the body, at 7 sites.

**A few units hold many jobs.** `simulate` keeps 20 `let` pools and about 30 per-minute values in one closure. `server/agent.ts:283` `runTell` is 192 lines with the Claude call inline, so no tool can be tested without paying for Claude. `src/scene/stage.ts` (1,455 lines) holds tunables, view tables, anchors, framing and the frame loop, and its constructor needs WebGL, so a committed test can reach nothing inside it. `src/model/assess.ts` is 2,063 lines of readings, feelings, muscles, system status and headline. `ui/App.tsx` runs scene wiring, playback, pointer picking and keyboard handling.

**The browser and server each guess the protocol.** `src/ui/tell.ts:6-13` defines the stream events in zod while `server/agent.ts` sends `{type: string}`, so a new event field compiles on one side only. Reading a request body exists 5 times, parsing the event stream twice, and a build's status has 3 copies (`extend.ts:29-36`, `Build.tsx:5`, `store.ts:80-83`). Errors have 5 catch blocks and 2 reply shapes, and every error is a 400.

**UI rules have no single home.** The levels have no type, so `PageHead.tsx:31-42`, `Timeline.tsx:43-62`, `StatePanel.tsx:254-263`, `OrganCard.tsx:161-175`, `App.tsx:57-60`, `navigation.ts:17-24` and `Controls.tsx:89` each re-derive the level with their own order of checks. The day's field list is copied by hand in 6 places, and the comparisons at `store.ts:185` and `ui/day.ts:27` fail silently when a field is added. Keyboard handling lives in 6 listeners whose order is implicit, which has already produced bugs C1 and C2.

**Numbers and facts repeat outside `params.ts`.** About 24 tunables sit in the loop, 50 in `assess.ts` and 60 in `organStates`. The next-peak search exists 5 times, the alcohol-present cutoff has 5 values, and a "sitting" is 10 minutes in one file and 15 in another. In the scene, the easing rate `7` is declared 6 times and `1 - exp(-dt*rate)` appears 16 times. One organ's facts repeat across its definition, its drawing and `organStory.ts`: the fat storing threshold of 8, for example, is in both `FAT_OVER.storingFrom` and `organStory.ts:165`.

**The tests have a shape problem.** The model is pinned well, but `hm` is defined 7 times and `none` 8 times, four sweeps over a whole day overlap, and some tests pin exact wording (`assess.test.ts:153-168`, `processes.test.ts:76,88`). 82 of the 91 s in `copy.test.ts` are five `expect` calls per string across 30 scenarios and 601 minutes.

### Things that are fine and should stay

- One hand-written store. `enterAsk`, `leaveAsk`, `goToStep` and `setBodyState` change body, derived values and time together, so slices would fight them.
- Selectors. None allocates, and `assess` and `processesAt` are cheap.
- `params.ts` with sources beside numbers. The bulk of `assess.ts` is uniform specs, which split well along their seams.
- Direct DOM writes in the close-up painters, and one `requestAnimationFrame` loop.
- Plain CSS with data attributes and CSS variables. `app.css` is well organised by screen region, and phase 7 splits it along those regions.
- `buildRoutes` (`flows.ts`) and `finish` (`tract.ts`). They are long, and they read as a table and a numeric kernel.
- The 11 `Stage` members callers use. Callers reach into nothing else, and the unused members go private or get deleted.
- `/api/day`, whose path handling is closed by an anchored date pattern and a parse on write.

## 3. Bugs found

"Ran" means the code was executed during the audit and showed the bug. "Read" means it was found by reading the code and has not been run. Each fix gets its own commit with a test of its logic that fails first. The exceptions are B4 and B5, whose tests become possible in phase 5, and visual parts of a fix, which get a throwaway check.

### A. Safety and data

| Id | What happens | Fix | Where | Evidence |
|---|---|---|---|---|
| A1 | Any web page you visit while `pnpm dev` runs can POST `text/plain` with no CORS preflight and start a paid Claude turn. Claude can then call `add_process` unconfirmed, which starts a build capped at $6 that can end in a commit. | Every POST route requires `application/json` and rejects an `Origin` header naming another site. A missing `Origin` passes, because only browsers send one and JSON already forces their preflight | `server/agent.ts:245-254,394`; explain, name-question, beacon and snapshot routes | Read. Whether browsers block this local request is unverified |
| A2 | The gate is weaker than its comment says. It accepts `[]["con"+"structor"]["con"+"structor"](...)`, `new Image()` and `location`, and a test file can call `vi.importActual("node:child_process")`, which ran a shell command. Tests run with the full environment. Combined with A1, a web page could reach code execution on the Mac. Each link was checked separately and the whole chain was never run. | Test files may import only `it`, `expect` and `describe` from `vitest`. Block `Image` and `location`, and any computed key that is a string expression. A key held in a variable still gets through. Run `tsc` and `vitest` with only `PATH` and `HOME` set. Reword the comment: the gate catches honest mistakes and is no sandbox. A real sandbox needs a container, which this plan leaves out | `server/extendCheck.ts:58`, `server/extend.ts:63` | Ran |
| A3 | A build copies files into the repo before committing. A failed commit, likely with parallel sessions holding `index.lock`, leaves files the app loads, and a retry is refused. | Create the commit first with a private `GIT_INDEX_FILE`, then write the files, so a failed commit leaves nothing | `server/extend.ts:245-247,266` | Read |
| A4 | A pending save survives a reload from another window. An edit followed by a reload within 300 ms writes the reloaded day over the edit. | `put` clears the pending save timer | `src/ui/day.ts:44-53` | Read |
| A5 | A parse failure in the browser does not abort the request, so the server keeps paying while the two states diverge. | A parse failure aborts the request and shows as an error on the exchange | `src/ui/tell.ts:109-115` | Read |
| A6 | Stop cannot reach the running `tsc` or `vitest` in a build, for up to 7 minutes. A dev server restart orphans the worktree. A failed `git rm` on removing a process is ignored. | Pass the abort signal to both commands, remove leftover build worktrees on server start, and show a failed removal | `server/extend.ts:63`, `src/ui/Build.tsx:18-20` | Read |

### B. Wrong on screen

| Id | What happens | Fix | Where | Evidence |
|---|---|---|---|---|
| B1 | Alcohol calories are counted and never tracked. A beer with 13 g carbs and 14 g alcohol reports 156 kcal while its ledger holds 58, so "% left" is wrong while the drink is still in the stomach. | Owner chooses. My pick: leave alcohol out of the "% left" total, because `alcoholLedgerAt` already tracks it in grams | `simulate.ts:325`, `lanes.ts:108` | Ran |
| B2 | A fasted gym session reads "Insulin at 0.8× is bringing sugar down, 8 g/h into muscle". The line subtracts only posture uptake, so training uptake counts as insulin's work. | New series for insulin uptake and exercise uptake, which the line reads | `processes.ts:711` | Ran |
| B3 | A meal of a table food and an estimated food reports its source as USDA, because only the first food is judged. | A meal reports its weakest source, found from its member foods by id | `origin.ts:126-128` | Ran |
| B4 | Immune view goes stale. After logging a cold it lights the spleen alone, when it should light spleen and lungs. The cache key omits trajectory and time. | Add what `composeView` reads to the cache key | `stage.ts:647` | Ran |
| B5 | Reproductive view goes stale after changing sex. A female body lights the prostate. | Same fix as B4 | `stage.ts:647` | Ran |
| B6 | Injury lines ignore the uterus and ovaries, which have no entry in the mesh table. "Through the uterus" finds only the large intestine, and the ovaries find nothing. | Add `uterus`, `ovary_L` and `ovary_R` to `MESHES` and `AIM_MESHES` | `server/track.ts:22-39` | Ran |
| B7 | The number check is weaker than the README says. Adding `17:36` also approves 17 and 36, and integers match within 0.5 across whole readouts. | A clock counts as one token, and a number matches only at its own precision | `server/numberCheck.ts` | Ran |
| B8 | "Absorbing sugar" counts only glucose past the liver. Rice adds up to 49.5 g of 69, judged against the gut's 60 g/h. | New series for all carbohydrate crossing the gut wall, which the reading uses | `simulate.ts:562,783` | Ran |
| B9 | The liver's flow compares g/L/min with g/min: flow 0.005 while clearing 0.82 g/L, so its line is almost invisible. | Compare g/min on both sides | `processes.ts:1015` | Ran |
| B10 | The bladder warning can never appear while awake. Voiding at 380 ml sits below the 400 ml warning, and the awake peak on 10 L of water is 380. | Owner chooses: lower the warning, or raise where voiding happens | `params.ts` `voidAtMl`, `assess.ts:1111,1936` | Ran |
| B11 | A system's word and its sentence can disagree: "Drowsy" beside "Feel-good chemicals are up", "Quiet" beside "Your liver is clearing caffeine". | One table row holds both | `assess.ts` system status | Ran |
| B12 | Claude and the screen use different words for one level, because `levelWord` and the readout's `level` differ. | The readout uses `levelWord` | `assess.ts`, `narrate.ts` | Read |
| B13 | Prompts have drifted from the tools. `read_body` allows minutes 0 to 1799 while steps reach 8 days away, `what_if` is instructed where it is hidden, `show_system` omits reproductive, and `set_now` text is unreachable. | Generate the lists from the tool tables, and test that each prompt names only tools its mode has | `server/agent.ts:60,85,89,138,149,183,406` | Read |
| B14 | A renamed layer in a composed drawing keeps its old word, because the identity omits labels and the memo lasts forever. | `compositionOf` includes labels | `closeup/composed.ts:65`, `ComposedInset.tsx:194` | Read |
| B15 | Six muscle captions can contradict a walkthrough step's `set`. Lungs show the cough word with no cough under reduced motion. | Captions read the level. The cough word follows the same reduced-motion rule as the cough | `MuscleInset.tsx:199`, `LungsInset.tsx:183,209` | Read |

### C. Interaction and small

| Id | What happens | Where | Evidence |
|---|---|---|---|
| C1 | Arrow keys in the explain panel's input change the walkthrough step. They should stay with the input. | `Tour.tsx:43`, `Ask.tsx:67` | Read |
| C2 | With the chart focused, arrows move the step and the time together. They should move the time only. | `Ask.tsx`, `Timeline.tsx:214` | Read |
| C3 | Stored light theme applies only after the meshes load, so light users see dark first. | `App.tsx:184` | Read |
| C4 | `@keyframes breathe` is defined twice, so the build line pulses to 0.25 where 0.55 was written first. Owner picks by eye. | `app.css:322,520` | Read |
| C5 | Reduced motion does not stop heart and lung pulses or the walk. | `stage.ts:1390,1403-1412` | Read |
| C6 | The scene says "Muscle" where the UI says "Muscles", and `MOST_LIT` 7 is overridden by `MOST_NAMES` 6. Keep "Muscles" and 6, which is what shows today. | `stage.ts:347`, `ui/organ.ts` | Read |
| C7 | The sex change stops short, leaving the skin at mix 0.002 while muscles reach 0. It is invisible, and fixing it changes pixels. | `stage.ts:1374` | Ran |
| C8 | Disposing during load leaves a resize listener that pins the whole `Stage`, and geometries are never disposed on a Fast Refresh remount. | `stage.ts:502` | Ran for the listener |
| C9 | Muscle immune cells get grey nuclei because of CSS import order. Leave until the owner chooses, since it is the tuned look today. | `closeup.css:29`, `insets.css:132` | Read |
| C10 | A misnamed part throws inside an effect with no error boundary, which should take the whole app down when that organ opens. `parts()` returns empty silently. | `insets/draw.ts:86-92` | Read, not run |
| C11 | `.venv-pipeline` has no torch or anny, so `build_body.py` and `build_muscles.py` cannot run from it, and Python dependencies are unpinned. | `README.md:86` | Read |

### When each bug gets fixed

| Phase | Bugs |
|---|---|
| 1 | A1 to A6, B1, B3 to B10, B12 |
| 3 | B2, B11 |
| 4 | B13, C11 |
| 5 | C5 to C8, plus tests for B4 and B5 |
| 6 | B14, B15, C10. C9 only with decision 6 |
| 7 | C1 to C4 |

Stopping after phase 4 leaves B14, B15 and C1 to C10 open. Each is a small fix that can land on its own.

### Dead code to delete in phase 0

- `fastClearer` and `slowClearer` (`store.ts:131-132`). Nothing reads them, and they take about 15 of the 15.6 ms each change costs.
- Model: `feelingsAt`, the third clause at `threads.ts:116`, `mmol` in `narrate.ts`, and params `GLUCOSE.brainUseGPerMin`, `GUT.waterRatePerMin`, `CAFFEINE.kidneyShare`, `MUSCLE_RECOVERY.fatigueRiseMin`.
- Scene: `Stage.pick` (the app calls `pickTarget`), `DEFAULT_ROOM`, `measureDefaultInsets`, `defaultInsets`, `Muscles.setBones`, `userData.part`, `vesselRadius`.
- UI: the class name `stagger`, `--i` and the `index` props that feed them, none of which has a CSS rule, `data-view` (`App.tsx:268`), `data-side` (`AtlasKeys.tsx:129`), `hueStyle`, `--wash`, `DAY_FROM`, `DAY_TO`, `DEMO`, `OPENING_MESSAGE`, and the stale comment at `Timeline.tsx:96-97`.
- Close-ups: `ComposedInset.tsx:167,181`, `insets.css:99-100`, the `FIGURES` export.
- Server: `buildStatus`, the identity `vi.mock` at `extend.test.ts:9`, the `+=` leftovers at `agent.ts:458-459`. `/api/snapshot` and `wall.ts:19-32` go if the owner agrees (decision 8).
- `pipeline/__pycache__/build_muscles.cpython-312.pyc`, tracked by mistake.

Series `insulinAction`, `flowHeart`, `muscleGlycogen` and `muscleWork` have no production reader, and an added process can read any series. They stay until phase 3 step 2, which deletes whichever the new uptake series do not need, with the golden file updated in that commit.

## 4. What must survive

Every step of this plan keeps these properties. Removing one is a product decision.

- Everything on screen is a pure function of the trajectory and the minute. `PLAN.md` says "nothing is animated by hand", and the scene shows the true rule: targets are pure, values ease toward them, and ambient phases such as the heartbeat and walking run on their own clocks. Phase 8 corrects that sentence.
- One `reduce` shared by Claude, the demo and the browser, and stateless Claude turns that replay it.
- Ask's copy of the day, which restores the same objects on leaving.
- Vite loads server files per request with `ssrLoadModule`, so a model edit never restarts the server and strands the wallpaper. No key reaches the browser.
- Days live outside the repo. `DayDoc` field names are on disk with `version: 1`, so renaming a field of `Intake`, `BodyEvent` or `CustomStory` needs a forward migration. Saved days must never be lost.
- The extension contract: a read-only `BodyView`, one file per process, error messages that say how to fix the problem, real-git tests.
- Sources and evidence grades beside numbers, conserved ledgers, channels, custom stories and substances as data, and `published.test.ts`.
- Tables where the first row whose test passes gives the sentence, so a test and its sentence are one unit.
- Close-ups: levels from 0 to 1 with meanings in words, schema and guidance generated from them, static SVG plus a painter, Claude giving no positions in composed drawings.
- Every tuned constant, every colour and every pixel, unless a listed bug says otherwise. The look took many rounds of hand tuning.

## 5. Target design

### Layers

A file may import from its own row or any row below it. A small test keeps it that way.

```text
 ui/, main.tsx, closeup/*.tsx
 store.ts, selectors.ts, level.ts, scene/, wall.ts
 wire.ts
 actions/
 closeup/*.ts
 look.ts
 model/
```

`server/` stands beside this stack. It may import `wire.ts`, `actions/`, `closeup/*.ts` and `model/`, and it never imports anything above them.

`.ts` and `.tsx` files in `closeup/` count as two separate rows. A close-up's definition (`closeup/organs/stomach.ts`) has no React, so the server can read it to validate a walkthrough. Its drawing (`closeup/organs/stomach.inset.tsx`) is React and is only reached through the registry in `OrganInset.tsx`.

`src/layers.test.ts`, about 25 lines, parses every import in non-test files, counts `import type` too, and fails on a wrong folder-to-folder direction. It is the one structural check that stays, because agents write most of this code and will not remember the rule.

### Patterns that pay for themselves here

| Pattern | Where | What it replaces |
|---|---|---|
| Descriptor table: one typed record per kind | Event presets, process lines, reading specs, system status | Dispatch scattered across 5 to 10 files |
| Plain step functions over parameter objects | `simulate` | 20 `let`s in one closure |
| Pure core with an imperative shell | Scene looks and views, day chart layout, Claude turn | Logic that needs WebGL, a canvas or a paid call to run |
| Discriminated union | `Level`, wire events, process ids | Repeated conditions and strings parsed at about 20 sites |
| Schema-first wire | `src/wire.ts` | Two guesses at one protocol |
| Route table | `server/routes.ts` | 7 middleware blocks in `vite.config.ts` |
| Factory plus exhaustive registry | Close-ups, which already do this | Stays |

These would be more than the job needs, and the plan leaves them out: a state library or store slices, a state machine library, dependency injection containers, a `Layer` interface or ECS in the scene (nothing iterates layers), an event bus, plugin pipelines for the engine, command classes for actions, Express or tRPC, `.glsl` files, CSS modules, per-organ CSS, barrel files, a copy catalogue, splitting `params.ts`, unifying caffeine, alcohol and custom substances, and Python packaging.

### File tree

Line counts are estimates. File splits and folder moves in `src/ui` come last, because whole-file renames in phase 2 deliver most of the relief first.

```text
src/
  main.tsx
  store.ts              state and transitions, 260
  selectors.ts          what the screens read from the store, 90
  level.ts              Level, levelOf, 40
  wire.ts               request, response and event schemas shared with server/, 90
  look.ts               hues and themes, 50
  wall.ts
  layers.test.ts
  golden.test.ts        with __snapshots__/golden.test.ts.snap

  model/                imports nothing outside this folder
    ids.ts              OrganId, SystemId, RouteId, ReadingId, ORGANS, process id build and parse, 90
    scenario.ts         Body, Intake, ActivitySpan, kcalOf, postureAt, 130
    params.ts           about 1,000 after phase 3
    curve.ts            next peak, first below, clamp01, 60
    words.ts            clock, hours, levelWord, 60
    day.ts              day file schema, real clock, carry-over
    dayEdits.ts         withActivity, withSleep, scaledTo, from actions.ts, 50
    shortText.ts
    systems.ts          plus ORGAN_HOME, from look.ts
    muscleGroups.ts  cycle.ts  threads.ts  acting.ts  origin.ts  yourDay.ts
    readout.ts          what Claude reads, from narrate.ts
    testKit.ts          hm, none, standard bodies
    engine/
      simulate.ts       the loop, step order, 200
      pools.ts          BodyConstants, Pools, Minute, starting values, 120
      gut.ts            ingest, stomach, intestine, substances, caffeine, 200
      glucose.ts        insulin, glucose, stores, fat and protein, energy, 180
      fluids.ts         fluids, stomach volume, digestion, 70
      heart.ts  feel.ts  anthropometrics.ts    about 60 each
      trajectory.ts     Trajectory, SERIES, record, value, ledgerAt and friends, 180
    events/             curves.ts 200, muscles.ts 100, presets.ts 350
    assess/
      assess.ts 60, context.ts 200, spec.ts 120, verdicts.ts 70
      readings/         sugar.ts, heart.ts, gut.ts, others.ts, 250 each
      feelings.ts 220, systemStatus.ts 260, headline.ts 60
    processes/          registry.ts 100, food.ts 210, dose.ts 360, body.ts 360, event.ts 120
    extensions/         api.ts, check.ts, index.ts, thyroid.ts, same files, imports updated

  actions/              was src/agent
    schemas.ts 190, reduce.ts 160, trace.ts 50

  closeup/              replaces src/closeup plus src/ui/insets
    define.ts 85, list.ts 30, story.ts 60, composed.ts 65, composedLayout.ts 85
    OrganInset.tsx 45, closeupInset.tsx 80, ComposedInset.tsx 215
    Plate.tsx, loop.ts, stream.ts, draw.ts, figures.css, parts/
    organs/
      stomach.ts        definition and sentence, server-safe, 45
      stomach.inset.tsx drawing, 300
      ... 16 pairs, median 36 and 90 lines

  scene/                stays flat
    stage.ts 260        renderer, controls, rig, loop, listeners, project, pickTarget
    present.ts 300      the frame, eased values, phases; constructible in Node
    views.ts 230        tables, View, composeView, isFeatured
    looks.ts 260        lookFor, muscle look, food colours; pure
    places.ts 190       anchors, locateStop
    framing.ts 120      framing key, source, workedAzimuth
    interior.ts 70      one sex's organs, stomach and line
    tuning.ts 150       TS numbers, easing rates, draw order
    organStates.ts      from model/state.ts, with Tint
    muscles.ts 480, muscleMaterials.ts 330, stomach.ts 520, stomachShape.ts 250
    figure.ts, anatomy.ts, materials.ts, routes.ts, processLine.ts, camera.ts, lymph.ts, assets.ts

  ui/
    App.tsx 70, Foot.tsx 40, Rail.tsx 130, Header.tsx 70, ViewControls.tsx 20
    boot.ts 60, keyboard.ts 60, navigation.ts 24, hooks.ts 60, sources.ts 24, icons.tsx
    figure/  useStage 70, useBodyPointer 50, freeArea 55, AtlasKeys 190, keyLayout 70, BodyTrace 170
    day/     DayPanel 190, dayPage 50, dayView 121, lanes 570, dayChart 480, chartLayout 330,
             FoodFix 70, portion 45, dayFile 90, usePlayback 25
    page/    PageHead 40, pageHead 40, SystemPage 200, OrganPage 110, ReadingRow 60, MuscleRow 45,
             ProcessPage 70, stopLayout 40, ActingHere 40, marks 35, Swap 17
    talk/    Answer 110, Composer 85, CheckedWords 25, tell 90, events 25, AskBar 25,
             WalkthroughPanel 70, ProcessTour 45, ClaudeGuide 50, Explain 170, ProcessBuild 76, demoOpening 50

server/
  routes.ts 80          table, capped JSON body, JSON-only check, Origin check, one error reply
  tell.ts 70            handler, Claude call, timing
  tellTurn.ts 230       startTurn: state, number book, every tool
  tellPrompt.ts 170     plans, prompts, tool descriptions, renderContext
  claude.ts 25          clean environment, query defaults
  extend.ts 170, extendSession.ts 110, extendCheck.ts
  explain.ts, days.ts, foods.ts, track.ts, numberCheck.ts
  fixtures/             recorded or hand-written Claude tool calls

vite.config.ts 30       mounts /api and loads server/routes.ts per request
pipeline/requirements.txt
```

### Examples of the new shape

**One formula per fact.** The engine and the explanation share one function, and a test proves the parts add up.

```ts
// model/engine/heart.ts
export function heartRateParts(p: HeartInputs) {
  return {
    activity: HEART.byActivity[p.posture],
    digestion: HEART.digestionGain * p.digestion,
    caffeine: HEART.caffeineGainPerMgL * p.caffeineMgL,
    events: p.channelBpm,
  };
}

// the loop adds them up; assess lists them as causes
// test: for every scenario and minute, sum of parts + resting rate === series.hr, capped at max
```

Values a reader cannot recompute, such as how much uptake came from insulin and how much from exercise, become new series. That fixes B2 at the source.

**One step per section of the loop.** The order matches today's order, and the golden test catches any change at Float32 level.

```ts
// model/engine/simulate.ts
for (let i = 0; i < constants.n; i++) {
  const m = minuteInputs(constants, pools, i);
  ingest(pools, m);
  const emptied = emptyStomach(pools, m);
  const absorbed = absorbGut(pools, emptied, constants);
  stepSubstances(pools, constants, i);
  stepFluids(pools, absorbed, m);
  const sugar = stepGlucoseInsulin(pools, absorbed, m, constants);
  stepFatAndProtein(pools, absorbed, sugar, constants);
  const caffeine = caffeineLevels(pools, constants);
  const contents = stepVolumeAndDigestion(pools, emptied);
  const heart = stepHeart(pools, m, caffeine, constants);
  const energy = stepEnergy(pools, absorbed, sugar, m, constants);
  const feeling = stepFeeling(pools, m, caffeine, contents, constants);
  record(out, i, pools, m, sugar, caffeine, contents, heart, energy, feeling);
}
```

**A new event preset is one entry.** The compiler lists anything missing, and the tool schema and prompt read from the same table.

```ts
// model/events/presets.ts
export const PRESET_DEFS = {
  training: { story: trainingStory, endsAt: trainingEnd, headline: trainingHeadline, status: trainingStatus, threadKind: "training", readings: ["muscle:quads"], intensityHelp: "0.3 easy, 0.6 solid, 1 to failure" },
  illness: { /* ... */ },
} satisfies Record<string, PresetDef>;
export const PRESETS = keysOf(PRESET_DEFS); // feeds z.enum in actions/schemas.ts
```

**Levels get a type.** Every reader switches on one value, and adding a level fails to compile until each reader handles it. `PLAN.md`'s level 3 becomes two kinds, organ and muscle, because they read different data.

```ts
// level.ts
export type Level =
  | { kind: "overview" }
  | { kind: "system"; system: Exclude<SystemId, "overview"> }
  | { kind: "thread"; processId: string; stop: number | null }
  | { kind: "organ"; organ: Exclude<OrganId, "muscle"> }
  | { kind: "muscle"; group: MuscleGroup | null };
export function levelOf(view: ViewState): Level { /* focus, then process, then system */ }
```

**The stream has one definition.** A new event field fails to compile on whichever side lags.

```ts
// wire.ts
export const tellEvent = z.discriminatedUnion("type", [replyEvent, actionEvent, errorEvent, doneEvent]);
export type TellEvent = z.infer<typeof tellEvent>;
export const encodeEvent = (event: TellEvent) => `data: ${JSON.stringify(event)}\n\n`;
export async function* readEvents(response: Response): AsyncGenerator<TellEvent> { /* parses with tellEvent */ }
```

**A Claude turn can be tested for free.** The tools are public handlers, so a test replays recorded calls and checks that the browser ends up where the server did.

```ts
// server/tellTurn.test.ts
const turn = startTurn(fixture.input, TELL_PLAN, (e) => events.push(e));
for (const { tool, args } of fixture.calls) {
  await turn.tools[tool].handler(z.object(turn.tools[tool].inputSchema).parse(args), {});
}
expect(replayInBrowser(fixture.input.state, events)).toEqual(turn.state);
```

### Names to change

These need the owner's approval (decision 3). The phase column says when each lands.

| Today | Proposed | Why | Phase |
|---|---|---|---|
| `src/agent/` | `src/actions/` | It holds tool schemas and the reducer, and the Claude bridge is in `server/` | 2 |
| `src/model/narrate.ts` | `readout.ts` | Its main export is `readout` | 2 |
| `src/ui/Timeline.tsx` | `DayPanel.tsx` | Everyone says day chart | 2 |
| `src/ui/StatePanel.tsx`, `OrganCard.tsx` | `SystemPage.tsx`, `OrganPage.tsx` | `PLAN.md` calls these pages | 2 |
| `src/ui/Build.tsx` | `ProcessBuild.tsx` | Says what is being built | 2 |
| `src/ui/SourceTip.tsx` | `sources.ts` | No tip and no JSX | 2 |
| `src/ui/opening.ts` | `demoOpening.ts` | It is the demo | 2 |
| `insets/ImmuneInset.tsx` | `SpleenInset.tsx`, then `spleen.inset.tsx` in phase 6 | It draws the spleen | 2 |
| `scene/flows.ts`, `organs.ts`, `tract.ts` | `routes.ts`, `anatomy.ts`, `stomach.ts` | Each name says what it holds | 2 |
| `plate` and `xray` themes, `.plate` root | `light`, `dark`, `.app` | One vocabulary for themes. A browser with the old stored value starts from the default theme, which `rememberLook` already handles | 2 |
| `process` in code, "line" in places | `process` for the concept in the model. `processLine.ts` keeps its name, because it draws the line | Both are used for one thing | 3 |
| `src/model/state.ts` | Dissolved | A mix, and it collides with the store's state | 2 |
| `s.body.body`, `BodyState` | `s.day.body`, `{ day: DayContent; now: number; view: ViewState }` | See decision 4 | 4 |
| `SexSet` | `Interior` | It holds one sex's organs, stomach and line | 5 |
| "stop" for four things | `ProcessStop` and `StoryStop` stay. `s.stop` becomes `spotlightStop` in phase 5, and `viewStops` becomes `skipStops` in phase 7 | Each says which stop | 5, 7 |
| `src/ui/insets/` | Merged into `src/closeup/` | Seven nouns cover one thing today: closeup, inset, figure, Drawing, Plate, panel, art | 6 |
| `part`, `parts`, `data-part` | `named`, `allNamed`, `data-name` | `Part` also means anatomy | 6 |
| `src/ui/day.ts` | `ui/boot.ts`, `ui/day/dayFile.ts` | Boot and saving, and it clashes with `model/day.ts` | 7 |
| `src/ui/Controls.tsx` | `Header.tsx`, `ViewControls.tsx` | It holds two unrelated things | 7 |
| `src/ui/Ask.tsx`, `Tour.tsx` | `AskBar.tsx`, `ClaudeGuide.tsx`, `ProcessTour.tsx`, shared `WalkthroughPanel.tsx` | Same panel, two sources of steps | 7 |

## 6. How each step proves nothing changed

The owner decided against UI tests: no component tests, no DOM test environment and no screenshot suite in the repo. Test effort goes to backend logic and complicated logic. Logic moved out of components into plain functions gets ordinary tests, because at that point it is logic. Everything visual is proven once with a throwaway comparison kept in `/proofs/`, which never gets committed.

| Area | Committed | Throwaway, never committed |
|---|---|---|
| Model | `golden.test.ts`, invariants, existing tests | |
| Actions, store | Tests on `reduce` and on Ask, moment and step transitions | |
| Server | Turn replay, prompt snapshots, route tests, event stream round trip, `days.test.ts` | One live Tell and one live Ask at the end of phase 4, on port 5199 with a scratch `BODYLANG_DATA` |
| Extension builder | `extend.test.ts` with real git, plus probes for A2 | One real build, about $0.70, with the owner's go |
| Scene | Pure logic: framing, `composeView`, limb routes, stomach shape, body shape solve | Digest harness, then a pixel check |
| Close-ups | Plain logic: clamping, read-back, shared rates, `organStory`, `composedSpec` sweep | Dump of static markup plus painter frames |
| UI | Pure functions: `levelOf`, `chartLayout`, `keyLayout`, `stopLayout`, `portion`, `pageHead` | Static markup, recorded canvas calls, a scripted walk in `tools/webkitshot.swift` |

**The golden test.** `src/golden.test.ts` takes the 30 scenarios from `copy.test.ts`. For each one it hashes every series, ledger and channel separately, and hashes the JSON of `assess`, `processesAt`, threads and lanes at every 30th minute. The hashes live in a Vitest snapshot, keyed by scenario and output, so a failure names the first thing that differs, for example "glucose in scenario pizza_and_coffee". It sits at the top of `src` so that files can move under it.

- A failure you did not intend means the step is wrong. Fix the step and leave the snapshot alone.
- A commit that changes model behaviour on purpose regenerates the snapshot with `vitest -u` and says why in its message, with readable before and after values from a one-off run.

**The scene digest.** `charact.test.ts` runs the real `Stage` in Node with a stubbed renderer and hashes matrices, uniforms, draw ranges, camera, anchors, picks and shader text across 19 states, in about 10 s. Two runs match, and a different time step changes all 19 hashes. It does not cover frustum culling, reduced motion or wallpaper mode. The file is at `/private/tmp/claude-501/-Users-yahorbarkouski--claude-spares-spare-iBBXAj/0dc6ebce-cb9a-41ee-bf94-805166985b85/scratchpad/scene-bench/charact.test.ts`. That folder is temporary, so phase 0 copies it into a git-ignored `/proofs/` folder, and phase 8 deletes that folder. If the file is gone, rebuild it from this description, choosing states that cover each view, theme and sex. Run it with `pnpm vitest run --config proofs/vitest.config.ts`.

**The close-up dump.** Painters write to the DOM, so this uses a small hand-written DOM stub in `/proofs/`, `renderToStaticMarkup` for each `Drawing`, and each `paint` at all levels 0, all levels 1 and the levels a standard day gives at 12:00, with everything lit and each key lit, for one `still` frame plus 120 frames at 1/60 s, with caption words. It needs a temporary patch to reach what `closeupInset` hides, discarded afterwards.

**The scripted walk.** `tools/webkitshot.swift` takes JavaScript to run before its screenshot, as `README.md` describes. A walk dispatches the key and pointer events for the interaction being changed and reads the result from the DOM.

**What the UI decision costs.** Keyboard, pointer and chart gestures have no permanent test, and a throwaway comparison checks markup and canvas calls only. Phase 7 reduces that risk three ways: steps stay small, one key router replaces six listeners, and each step ends with a scripted walk.

## 7. Phases

Line numbers in this section are from commit `9de7357`. They shift as work goes on, so find each section by its content. Each phase ends with `pnpm check` passing.

### Phase 0: Safety net and hygiene

1. Remove the tracked `.pyc`, and add `__pycache__/` and `/proofs/` to `.gitignore`. Keep `node_modules` without a trailing slash, because the build worktree's copy is a symlink (`server/extend.ts:230`).
2. Make `copy.test.ts` fast. Test each string with one `regex.test` and call `expect` only on a failure, which measured 17 s. If the suite still takes over 30 s, sample every 10 minutes, which should reach about 4 s (unverified).
3. Add `src/model/testKit.ts` and delete the 7 copies of `hm` and 8 of `none`.
4. Add `src/golden.test.ts`.
5. Add `src/layers.test.ts` with today's actual folder-to-folder edges as the allowed list.
6. Add `pnpm check`, which runs `tsc --noEmit` and `vitest run`. There is no pre-commit hook that runs the suite, because `server/extend.ts:247` commits through it.
7. Copy the scene digest into `/proofs/` with its own `vitest.config.ts`, exclude that folder from the main config so `pnpm check` works without it, and save the baseline.
8. Delete the dead code in section 3, with golden and digest unchanged.

Done when `pnpm check` takes under 30 s and all of the above is in. The 30 s is a target to report against, and nothing enforces it.

### Phase 1: Bugs

Fix the bugs listed for phase 1 in section 3, A first, one commit each. For model bugs the snapshot changes in the same commit. A1 is fixed in place in each route's body reading here, and phase 4 moves that check into `routes.ts`. B1 and B10 wait for the owner's choice, with a short before and after. B4 and B5 are confirmed with the digest harness, because `Stage` cannot run in a committed test yet.

### Phase 2: Shared types, layers and names

This phase rewrites imports across the whole repo, so it needs a quiet checkout (decision 1). Each step is mechanical, proven by `tsc`, an unchanged golden and, for scene renames, an unchanged digest. After the theme rename, look at both themes with `webkitshot`. Keep each move in its own commit.

1. Create `model/ids.ts`, with one `ORGANS as const` list feeding `z.enum` in `actions.ts:19`, `server/agent.ts:415` and `extensions/check.ts:7`. The other 8 files in section 2 use `Record<OrganId, ...>` tables or lists that either read `ORGANS` or fail to compile.
2. Create `model/scenario.ts` and `model/engine/trajectory.ts`. After this, `simulate.ts` has about 4 importers. It stays at its current path until phase 3 step 3.
3. Move `shortText` into `model/`, which removes the two-way folder link between `agent` and `closeup`. Move `ORGAN_HOME` to `systems.ts`, `WAVE_SPEEDUP` to `params.ts` so a close-up no longer loads Three.js, and `Theme` to `look.ts`, deleting the copies in `stage.ts` and `materials.ts`.
4. Dissolve `model/state.ts`: `organStates` and `Tint` to `scene/organStates.ts`, `whereabouts` and the second forecaster (`state.ts:269`) to `processes.ts`, English helpers to `words.ts`.
5. Apply the approved phase 2 names from section 5, one commit each.
6. Update the references in section 8 with each move. Update `testImports`, the build prompt and `thyroid.ts` together, with no shims, and keep doing so in phase 3. Finish with a sweep of section 8, and add a test that every path named in the build prompt exists.
7. Tighten `layers.test.ts` to the rules in section 5 for the folders that exist, and confirm the type cycle is gone. Tighten it again as `wire.ts`, `level.ts`, `selectors.ts` and the `closeup/` merge land.

### Phase 3: Model

1. Move the stray tunables in the loop and `assess.ts` into `params.ts` with unchanged values, about 75 in all. Mark them as tuned and invent no sources. Golden unchanged. The 60 in `organStates` go to `scene/tuning.ts` in phase 5.
2. Share formula parts between engine and explanations, emit series for what readers cannot recompute, and add invariants: heart causes add up to heart rate minus rest, sleepy causes add up to `drowsy`, and ledgers conserve across all scenarios. Fix B2 here, and delete the unread series the new ones do not need. Files under `model/engine/` start here with these parts functions.
3. Measure `simulate` as a baseline, then extract the loop sections one commit at a time in this order, moving the file to `engine/simulate.ts` first: ingest (`simulate.ts:460-473`), stomach (`:475-500`), gut (`:510-577`), substances (`:579-593`), fluids (`:595-605`), glucose and insulin (`:607-664`), lipid and protein (`:666-687`), caffeine (`:689-693`), volume and digestion (`:695-710`), heart (`:712-723`), energy (`:725-744`), feeling (`:746-761`), record (`:763-840`). Golden unchanged at every commit. Report the cost after.
4. Add `curve.ts` and merge the 5 next-peak searches, 3 first-below searches and the second forecaster, committing each merge that leaves the golden unchanged. Propose values for the alcohol-present cutoffs and the 10 or 15 minute sitting. These change some words, so the golden diff and a readable before and after go to the owner, who approves before that commit. Hold it as a separate patch and continue with step 5.
5. Split `assess.ts`, `processes.ts` and `events.ts` at their seams, golden unchanged:

   | From | Lines | To |
   |---|---|---|
   | `assess.ts` | `9-197` types and verdicts | `assess/spec.ts`, `assess/verdicts.ts` |
   | | `199-506` context, curve search, forecast helpers | `assess/context.ts` |
   | | `508-1334` reading specs, `1657-1740` muscles | `assess/readings/*` |
   | | `1336-1442` registry and build | `assess/assess.ts` |
   | | `1444-1655` feelings | `assess/feelings.ts` |
   | | `1742-1992` system status | `assess/systemStatus.ts` |
   | | `1994-2041` headline | `assess/headline.ts` |
   | `processes.ts` | `12-126` types, numbering, meals; `1222-1289` adapter, registry; `whereabouts` from phase 2 | `processes/registry.ts` |
   | | `128-337` food | `processes/food.ts` |
   | | `339-699` dose engine, caffeine, alcohol, substance | `processes/dose.ts` |
   | | `701-1052` insulin, fat, circulation, alertness, clearing; `1180-1220` cycle | `processes/body.ts` |
   | | `1054-1169` events | `processes/event.ts` |
   | `events.ts` | `1-168` types, curve; `260-312` bouts; `542-621` channels | `events/curves.ts` |
   | | `170-251` muscle state | `events/muscles.ts` |
   | | `314-540` presets with wording | `events/presets.ts` |

6. Move kinds onto descriptor tables: `PresetDef`, a `ProcessDef` holding source, readings and left-out flags, reading spec fields `channels` and `food`, and one row holding a system's word and sentence, which fixes B11. Names such as `LINE_SOURCES` and `LIVE_LINES` become `process` names as they move.
7. Replace process id strings with a typed build and parse, and stop keying logic on display text at `assess.ts:82,2028`, `lanes.ts:563`, `processes.ts:69`, `origin.ts:127`.
8. Clean up tests: merge the four sweeps (`assess.test.ts:378`, `processes.test.ts:331`, `events.test.ts:809`, `copy.test.ts:140`), loosen wording pins, move tool tests (`events.test.ts:676-779`) beside `actions`, add direct tests for forecast and `whereabouts`.

Done when adding a preset, reading or process edits one table plus its own logic, and the compiler points at anything missing.

### Phase 4: Server and actions

1. Extract `startTurn` from `runTell` unchanged. Add hand-written fixtures from `SENTENCES` in `tools/speed-bench.mjs`, and prompt snapshots for three modes: tell, ask at Simple depth, and ask at Deep depth.
2. Move prompts and descriptions to `server/tellPrompt.ts`, byte-identical by snapshot. Replace the six per-action `if`s at `agent.ts:311-346` with one apply path. Generate prompt lists from the same tables, as `closeupGuidance()` already does, which fixes B13 and changes those snapshots on purpose.
3. Add `server/routes.ts` with a capped JSON body, the JSON-only and Origin checks, and one error reply. Shrink `vite.config.ts` to one mount that keeps per-request loading. Existing handler tests stay unchanged.
4. Add `src/wire.ts` and use it on both sides. `tsc` proves agreement.
5. Split `src/actions/actions.ts` into schemas (`18-191`), `reduce` (`251-372`) and trace lines (`375-422`), with day helpers (`214-249`) moving to `model/dayEdits.ts`. Replace the hand-written copies of the day's fields (`store.ts:128,185,273,281`, `ui/day.ts:27`, `Explain.tsx:49`, `server/agent.ts:294`, `server/explain.ts:78`) with one `dayContentOf` function. If decision 4 is yes, split `BodyState` here. The server then needs only the day half.
6. Split `server/extend.ts`, with `extend.test.ts` unchanged.
7. Add `days.test.ts` (nothing tests the real data path today), route tests, a stream round trip and female injury tracks.
8. Add `pipeline/requirements.txt` with current releases pinned, including torch and anny, which fixes C11. Leave the geometry code alone and regenerate no assets.
9. Run one live Tell and one live Ask on port 5199 with `BODYLANG_DATA` in a scratch folder, about $0.10 to $0.40. With the owner's go, run one real build, about $0.70.

### Phase 5: Scene

Save a fresh digest baseline and the pixel "before" at the start. The digest must match after steps 1 to 8, and a step that cannot match stops for review.

1. Make `renderer`, `scene`, `camera` and `controls` on `Stage` private.
2. Move view tables and pure functions into `views.ts` and `looks.ts`: `composeView` `652-667`, `isFeatured` `1242-1255`, `lookFor` `706-783`, `flushOf` `868-878`, `composeMuscleLook` `881-957`, food colours `985-1006`.
3. Extract `places.ts` (`1018-1194`), `framing.ts` (`1269-1361`) and `interior.ts`, and move limb geometry (`603-643`) to `routes.ts`.
4. Split `present.ts` from `stage.ts`, so the frame logic can be constructed in Node without WebGL. Add tests for framing keys, `workedAzimuth` and `composeView`, including regression tests for B4 and B5.
5. Give the stomach a look type and a motion parameter, and move its easing into it. Stop if the digest moves around `closeUp`, because `translateY` runs between render and the next update.
6. Standardise on `setPalette(palette)`, `setSizeScale(unit)` and `update(dt, look, motion)`, with each layer easing itself. Add no shared interface.
7. Split muscle materials and share repeated GLSL by string interpolation. Shader text stays equal once whitespace is collapsed.
8. Add `tuning.ts` with values moved verbatim, including the 60 from `organStates`. GLSL numbers stay in the shaders (decision 5).
9. Run the pixel check, with `requestAnimationFrame` and `performance.now` shimmed in a local copy of `tools/webkitshot.swift` in `/proofs/`. That shim is unbuilt, and identical GPU output between runs is unverified. A difference means investigate before going on.
10. Fix C5 to C8. These change pixels on purpose, so they come after the comparison.

### Phase 6: Close-ups

Build the close-up dump in section 6 at the start. It stays identical after steps 1 to 8.

1. Have `defineCloseup` clamp, and delete the 12 `clamp01` copies.
2. Use one registry and a non-null `closeupOf`, removing the dead guards at `dayView.ts:49` and `actions.ts:88`.
3. Declare `paint` inline, make caption words a pure function, and remove the redundant `still` checks (`HeartInset.tsx:102,128`, `LungsInset.tsx:178`, `StomachInset.tsx:139`, `BladderInset.tsx:44`, `MuscleInset.tsx:166`).
4. Use a `data-lit` convention in the template to replace 38 `setLit` calls and about 30 lookups. A forgotten group can then no longer stay bright.
5. Move sentences into the definitions with shared helpers, so each organ's rates exist once. Text stays byte-identical.
6. Split the long painters at their seams: stomach waves `139-169`, wall `171-232`, pieces `234-268`, lungs' tree builder `38-162`, spleen's two drawings.
7. Move everything into `closeup/organs/`, with approved renames.
8. Concatenate the CSS in cascade order and check both themes with `webkitshot` before and after. Keep the winner in C9 until the owner chooses.
9. Fix B14, B15 and C10: `parts()` throws when nothing matches, skipping lymph at `vessel.tsx:38`, and one error boundary around the drawing shows the error in the panel so the rest of the app keeps working.

After this, a new organ is two files in one folder plus registry entries, the other files read from `ORGANS` or fail to compile, and its mesh comes from `pipeline/`.

### Phase 7: UI

This phase is deliberately lighter. It adds plain function tests and no component tests. A throwaway comparison plus a scripted walk follows each step.

1. Add `level.ts` and replace the 7 derivations. Where a derivation checks in a different order, one `levelOf` would change behaviour, so stop and ask. Share `ReadingRow` and `MuscleRow` between the two pages.
2. Move store rules out of component effects (`Tour.tsx:22-24,36-38`, `Timeline.tsx:166-168`, `FoodFix.tsx:99-101`) into store transitions, with tests.
3. Split `selectors.ts` and pure helpers out of `store.ts`.
4. Separate `chartLayout.ts` from painting in `dayChart.ts`, taking a `measure` function. The chart stops reading hit targets from its last paint (`momentHits`, `stopXs`). The recorded canvas calls stay byte-identical. Test the layout with a fake `measure`.
5. Extract pure logic with tests: `headIn` (`PageHead.tsx:29-43`), `useDayView` (`Timeline.tsx:40-63`), `useLeaves` (`Rail.tsx:32-54`), key placement (`AtlasKeys.tsx:96-106`), `portion` (`FoodFix.tsx:28-39`), `layoutStops`.
6. Add one key router in `ui/keyboard.ts`, fixing C1 and C2. Merge the near-duplicates: the walkthrough panel from `Tour` and `Guide`, the event reader from `tell.ts` and `Explain.tsx`, click-away from `Controls` and `FoodFix`.
7. Break up `App.tsx` into `useStage`, `useBodyPointer`, `usePlayback` and `boot.ts`. Fix C3 and C4.
8. Move into folders and apply the remaining names, last, in one quiet sitting. This includes `lanes.ts` to `ui/day/`, with its tests. CSS splits per folder with shared controls first, because `.more`, `.fix-remove` and `.remove-process` depend on coming after `.link`.

### Phase 8: Finish

Run this after whichever phase is last.

1. Add a short repo `CLAUDE.md`: the layers, how to add a preset, reading, process and organ, the commands, and the properties in section 4.
2. Update `README.md`'s file table and the "nothing is animated by hand" sentence in `PLAN.md`. Delete `/proofs/` once no scene, close-up or UI phase is still planned.
3. Last, add Biome as a formatter only, at its current stable version, and add it to `pnpm check`. Run the reformat as one commit recorded in `.git-blame-ignore-revs`, keeping prompts at one paragraph per line. typescript-eslint is left out because TypeScript 7 has no JS API (from earlier project notes, unverified).

## 8. Rules for whoever executes this

**Stop and ask the owner** at these points, and keep working on anything else meanwhile:

- Any decision in section 9 that is still open when its phase starts.
- B1, B10, C4 and C9, which need a choice.
- Phase 3 step 4, before committing word changes.
- A golden or digest change you did not intend and cannot explain.
- A real build, which costs about $0.70. Live Tell and Ask runs in phase 4 need no extra approval.
- Any colour change, which needs a mock first.

**Paths that break silently when files move.** Update these with the move, and check them after.

- Dev server loader: `vite.config.ts:40,50,60,70,85`, `tools/speed-bench.mjs:164`.
- Reads relative to the working directory: `server/foods.ts:46`, `server/track.ts:54`, `server/extend.ts:198,276`.
- Extension builder: `server/extend.ts:25-26,85,87,91,103-109`, `server/extendCheck.ts:7-8`, `src/model/extensions/index.ts:4`, relative imports in `api.ts` and `check.ts`, and `server/extend.test.ts:27-28,40,53`. Two of these fail with no error: at `extend.ts:87` a moved test file simply matches nothing, and at `:103-109` the prompt names `SERIES`, `ROUTE_IDS`, `alertnessProcess` and `to_neck` by file.
- `testImports` in `server/extendCheck.ts:8` allows `../simulate`, `../params`, `../cycle` and `../processes`, so added processes and their tests must keep compiling after each model move. `thyroid.ts` proves this.
- Assets: `src/scene/assets.ts:53`, `muscles.test.ts:16-21`, `flows.test.ts:14`, `processLine.test.ts:14`, `tract.test.ts:38-39`, `closeup/organs.test.ts:224`, and the output paths in `pipeline/build_body.py:15-17`, `build_organs.py:16-20`, `build_muscles.py:21-25`.

**Other rules.**

- Commit on `main`, the only branch, in the style of `git log`, with no co-author trailer and no generated-with line. The repo has no remote.
- Several sessions may be running on this checkout, so `HEAD` can move. Re-check `git status` and `git log` before committing, commit with explicit paths, never use `commit -a`, and check `git diff --cached` for what another session staged.
- Test with a separate server and data folder: `BODYLANG_DATA=<scratch> pnpm exec vite --port 5199`. Do not touch `~/.bodylang/days`.
- `tsc` runs on `src`, `server` and `vite.config.ts`. `tools/` is outside it, so check `speed-bench.mjs` by hand after moves, or convert it to `.ts` under `tsc`.
- `vitest` strips types, so run `tsc` as well.
- `WALL_FPS` is 90 by the owner's choice.
- A hidden browser pane stops the frame loop, so use `tools/webkitshot.swift` for screenshots.
- Keep to one change per commit, and keep moves separate from edits, so a diff stays readable.

## 9. Decisions for the owner

| # | Decision | My recommendation | Needed by |
|---|---|---|---|
| 1 | Keep other sessions off this checkout during phases 0 to 2 and the folder moves in phases 3 to 7. I estimate phases 0 to 2 at a few hours. Between moves, feature work in files a phase is not touching is fine. | Yes. Another session changed 15 files during this audit, and phase 2 rewrites imports everywhere | Phase 0 |
| 2 | Fix bugs in section 3, which change numbers and words on screen. | Yes, A first. You see the before and after where a choice is needed | Phase 1 |
| 3 | Approve the names in section 5. | Yes to all. Names were one of the main complaints | Phase 2 |
| 4 | Split `BodyState` into `day`, `now` and `view`, touching about 60 sites (54 `.body.x` reads and 7 `.body.body`). Disk fields stay as they are. | Yes. `s.body.body` is confusing, and the server needs only the day half | Phase 4 |
| 5 | Let GLSL numbers stay inside shaders, an exception to your rule that all tunable numbers live in one config module. | Yes. A shader constant moved to TypeScript only adds a hop | Phase 5 |
| 6 | Align close-ups with your drawing rules: Heart and Liver use their own blood colours where others use shared vessel parts, Brain and Spleen have legends where words should sit on what they name, plus C9. These change what is drawn. | A separate visual pass after phase 6, with you looking | Phase 6 |
| 7 | Add Biome and reformat, with a line width of 120. 529 lines are over 160 today, so this diff is large. | Yes, as the last commit | Phase 8 |
| 8 | Delete `/api/snapshot` and `wall.ts:19-32`. Nothing in the repo calls it, and it writes into `pipeline/cache`. | Delete, unless you still use it | Phase 0 |
| 9 | Scope. Phases 0 to 4 cover backend logic and complicated parts, and apply the phase 2 names. Phases 5 to 7 cover the scene, close-ups and UI. | Do 0 to 4, review, then decide on 5 to 7. Phase 8 follows whichever is last | Phase 0 |
