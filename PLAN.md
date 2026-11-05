# Bodylang plan

Bodylang is one 3D human body that shows what is happening inside you right now. You say in plain words what you ate, drank, took, did or came down with. Claude Code turns that into function calls, a physiology model recalculates your day, and the body, readings and day chart redraw from the result.

It runs on your Mac: `pnpm dev`, then http://localhost:5183, or as your desktop wallpaper through Plash at http://localhost:5183/?wall. You type in the box at the bottom left. It follows the real clock and saves your day, so you can close it and come back. [README.md](README.md) has the setup. "I" in this document is Claude, the session that built it.

## How it works

You say something like "two slices of pizza at 13:10", and it takes this path:

```text
your sentence
     │
     ▼
Claude Code ── calls functions ──► find_foods(pizza) ──► rows of the USDA table
     ▲  │                          log_food(pizza, 13:10, row 2708615, 2 slices of 107 g)
     │  │                          log_event(Chest and triceps workout, training, ...)
     │  │                          show_system(digestion)
     │  │                                  │
     │  │                                  ▼
     └──┼── results as numbers ─── physiology model: one value per minute, midnight to 06:00 next day
        │                                  │
        ▼                                  ▼
  answer, up to 3 short lines      3D body, readings, sentences, day chart
```

The default body is a 30-year-old man, 180 cm and 80 kg. You change it from the line under the clock, or by saying so. http://localhost:5183/?demo replays a scripted day without calling Claude or saving anything: "It's 5 pm. 15 minutes ago I ate a sugar bar with pizza, and I had coffee this morning. I'm sitting." For that body, it gives these results at 17:00. Blood sugar is 4.7 mmol/L and peaks at 6.9 near 17:53. The stomach holds 540 ml and empties near 22:37. Meal fat peaks later, near 19:50, because it reaches the blood through the lymph. The morning coffee has 0.59 mg/L of caffeine left, which blocks about 4 of every 100 tired signals in the brain. A 15 minute walk now would lower the sugar peak by 0.2 mmol/L, which is the kind of alternative Claude can offer under an answer.

The body, readings, sentences and day chart all read this one calculation, and nothing is animated by hand. This rule comes from the [Teardown](https://x.com/elvar_official/status/2116174609355571402) article you sent. Once the day is calculated, the state of the body at any moment depends only on the time of day, so dragging across the day chart replays it.

## Your day

**The clock is real.** Now follows your Mac's clock, and the view rests on it unless you scrub away. A day runs from 04:00 to 04:00, so 01:30 still belongs to the day it began in. Saying something past bedtime, or before the usual wake-up, counts you as awake, because you are talking.

**The day is saved.** Each date gets one file in `~/.bodylang/days/`, written a moment after anything changes. It stays on your Mac and out of the repository. A copy being explored in Ask is never written. If you have the page open twice, such as a window and the wallpaper, a save on one appears on the other.

**The next day starts from the last.** Yesterday stays in the new day's file with negative minutes, and the calculation runs yesterday first. A coffee at 23:00 yesterday is minute -60, and its caffeine, along with alcohol, blood fat, whatever is still in the stomach and how long you slept, are simply still there at 00:00. Glycogen and fasting start from their usual morning values, because a partly logged yesterday would otherwise read as a day without food. Things from yesterday show on screen only while they are still doing something. Events last longer: an illness keeps going until you end it, and a finished one stays for 14 days. After days away, the model assumes a usual night.

**Food comes from a table.** `server/foods.json` holds 12,750 foods from USDA FoodData Central, with composition per 100 g and real portion weights. Claude searches it, picks the row and decides only how much you had. If nothing fits, it uses its own composition, and the food is marked as Claude's estimate.

**Every food estimate can be corrected.** Foods along the top of the day chart have a dotted underline, because their portion is Claude's estimate. A click opens what you had at that moment: the portion in the units you ate it in, the time, what it holds, whether that comes from USDA or from Claude, and Remove. Each step redraws the curves straight away. Saying "only one slice" does the same through `correct_intake`.

## Where each thing came from

Sources, at the bottom right, opens a list of where everything on screen right now came from, when you click it. Nothing appears on hover, because hover notes covered the buttons underneath. Each source is one of five kinds:

| Note | Meaning | Example |
|---|---|---|
| Computed by the model | The physiology model calculated it, and the note gives the source of its typical range and how far to trust it | Blood sugar 5.1, with the ADA range and evidence A |
| Computed by the model, from Claude's numbers | The model calculated it, but something feeding it is Claude's estimate | Heart rate during a sauna, or blood sugar after a food the table doesn't have |
| Added by Claude | Claude's own words, or a number the model never returned | The description of a custom event |
| From the USDA food table | The food's contents | Pizza, cheese, thin crust |
| You said this | Your own measurements | 62 kg |

Evidence grades mean this: A is consistent human studies or official bodies, B is human studies with wide variation, and C is an estimate chosen to match the shape of published curves.

Claude's replies are checked by code. Its instructions say every number must come from the model, and the bridge keeps a list of each number the model returned to it, plus what you said. Any number in a reply or a walkthrough step that isn't on that list gets a dotted line under it, and Sources says what the line means. A number Claude worked out by arithmetic counts as added, because nothing computed it.

I checked this by having a script walk 40 views in real WebKit, with a table food, an estimated food, a sauna, a workout, a drug and a cycle all logged, and list any number on screen with no source. The list came back empty once I fixed the one it found. The walk leaves out the clock, the numbers on stops, the count in a walkthrough and the sliders in the panel for your measurements. The canvas of the day chart can't be walked this way, so its rows carry the sources for what they draw.

## Selecting words to ask about them

Select words in any sentence or diagram, such as TRH in a walkthrough, and a small panel opens right above them. The names of rows and buttons are for clicking, so they don't do this. Claude Haiku 5.5 says what they mean in one short sentence, using the sentence they came from, and you can ask follow-ups in the same panel. It also has your current numbers, so "is mine low?" gets an answer from the model. This session has no tools at all, so it can only talk: it can't change your day, and the conversation is gone when you close the panel.

## How the screen is organised

The body stands in the middle of the window. At the top left is the clock, with your measurements under it. Below them is the rail, an outline of the body: the systems as plain text, with the one you are in opened to show where you are. The message box is at the bottom of that column, with the latest answer as plain text above it. On the right is a page for where you are, in a column of the same width, so the body stays centered. Under the body is the day chart.

The look uses the system font at 13 px for most text and 20 px at most, a warm near-black background with hairlines, and no shadows. Only the day chart and the organ diagrams sit on a panel. Icons are for finding your way and for controls everybody knows, so they appear on the list of systems and on the play, skip, send and close buttons, thin and in one quiet tone. What you may feel also has a thin icon, in the colour of the part of the body it comes from. Everything said on the page stays in words. It opens dark, and Light at the bottom right switches to a cream background.

Two questions organise everything:

- **What happened?** The things you told it: pizza, coffee, a chest workout, a cold. These are threads.
- **Where is it happening?** Parts of the body: Digestion, Sugar & energy, Heart & lungs, Muscles, Brain & mood, Immune, Liver & kidneys, Reproductive. These are systems, listed in the rail on the left.

A thread crosses systems, and a system holds parts of several threads. Everything else stays hidden until you go down a level:

| Level | Question it answers | What you see |
|---|---|---|
| 0 Overview | Am I fine, and what is going on? | The body with one accent on what is working hardest, one sentence, and up to three things you may feel. The rail lists one row per thread |
| 1 System | How is this part of me? | That system lit and labelled on the body in its colour, and readings with a typical band. The rail lists what is running there |
| 2 Thread | Where did it go, and what happens next? | One coloured line through the body, numbered stops, and an optional walkthrough |
| 3 Organ or muscle | What is happening inside? | The camera inside, one moving diagram driven by the numbers, and up to three readings |

One click on the thing itself goes down: a system, an organ, or a thread, which jumps from the overview straight to its line. Esc, any row in the rail, or a click on empty space goes back up.

The day chart answers one question at every level: what is going on, how much, and when does it end? Something that runs out, such as a meal in the gut, is a filled area that ends where it ends, with a mark such as "Digested 00:10". Something that never runs out, such as a heart rate, is a line against its typical band, so "is this normal?" reads straight off it. Both are solid up to now and dashed after. Beside each name is its value at the minute under your pointer.

The overview draws one row per thread in a neutral colour, a system one per reading or worked muscle, a thread one per stop, and an organ its own readings, each in the colour of what is in focus.

You move through the chart the way you would in a player. The skip buttons go to the previous or next moment: what you logged, each named end, and now. Play runs forward to the last of those moments. Dragging or clicking anywhere on the chart moves the body through time and snaps to those moments, unless you hold shift. The top corner says Now, or Back to now once you have moved away. Hovering previews any minute without moving anything. Focus, under the names, shows the stretch from where this began to where it ends, and glides there when you change level. Whole day shows 04:00 to 04:00. A sideways swipe or a pinch also moves around.

These rules keep it quiet:

- **One sentence, one place.** The sentence at the head of the page changes with the level and answers what you just clicked.
- **A reading explains itself when it needs to.** Inside its typical band, a reading shows its number and band with no verdict. Past the band, it adds a line saying why: "Blood pressure 175 mmHg. Expected. About 55 mmHg from running." The word is Expected when the model has a normal cause, and Slightly raised, High or Low in amber or red when it hasn't.
- **Scales read as words.** Inflammation or stress read Quiet, Mild, Moderate or Strong, and 0-to-100 numbers never reach the screen.
- **Colour only with focus.** The overview is neutral, apart from one orange accent on the organs. Open a system or a thread and its one colour appears on the organs, the line, the curves and a small tick and icon in the rail: Digestion orange, Sugar & energy yellow, Heart & lungs red, Muscles magenta, Brain & mood purple, Immune teal, Liver & kidneys blue, Reproductive green. Blood vessels stay red and blue.
- **The rail shows activity quietly.** A dimmer name and icon mean nothing is going on there, and the systems that matter most add one word, such as "Working hard".

## Telling and asking

The switch on the message box has two settings. **Tell** is for what happened, and it changes your day. **Ask** is for what would happen and how things work, and it cannot change your day.

An Ask runs on a temporary copy of your day, with your real day set aside untouched. Claude's tools act on the copy, so the body, readings, rail and day chart all show the hypothetical. While you are exploring, a dashed frame runs around the window and a line at the top shows your question with Back to your day. A long question gets a short name there from Claude Haiku, asked for beside the answer. Leaving through that link, pressing Esc from the overview, or switching to Tell puts your real day back exactly as it was, and anything still on its way from Claude is dropped. A follow-up builds on the same copy. To make something real, switch to Tell and say it happened.

Ask for "what if I eat a burger and fries now" and Claude logs them on the copy, then answers in two parts. The short answer sits above the message box: "Burger and fries would push your blood sugar peak to 8.1 mmol/L around 18:04." A walkthrough sits above the day chart, and each step moves the view and the time and says what is happening and why. The day chart draws your real day in grey behind the hypothetical, so the difference is the picture. A question about a concept, such as how insulin works, changes nothing in your day and uses the same walkthrough to go through the organs involved. If the model has nothing for that concept, Claude also starts adding it, as the next section describes.

## The object

| Part | What it is |
|---|---|
| Body shape | [Anny](https://github.com/naver/anny), a parametric human model. The browser solves sex, age, height and weight against the mesh's real volume |
| Organs and vessels | Real meshes from the [HuBMAP Human Reference Atlas](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html), one set per sex, fitted to the body. Each body has its own reproductive organs: a uterus, ovaries and tubes, or a prostate |
| Muscles and bones | Real meshes from [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), warped to the body. Each worked group flushes in the Muscles colour, and the body turns to show it |
| Stomach | Generated in code, because the atlas has none and a stomach changes shape. Its size follows the model's millilitres |
| Small intestine | One generated tube filling the atlas's volume, because the atlas walls can't be recovered as a tube |
| Process line | One line through real vessel paths, coloured as far as the thing has got, with a few slow beads on the current stretch |
| Posture | An invisible rig: the body sits, stands, walks, runs or lies down according to the day |

## The physiology model

The model is about 7,500 lines of TypeScript with no dependencies. It runs in one-minute steps from midnight to 06:00 the next day, after first running yesterday when anything from yesterday is logged. One recalculation takes about 3 ms without yesterday and 5 ms with it. Muscle soreness uses curves that reach past that window, so last week's leg day still counts today. It covers gastric emptying, absorption, glucose and insulin (Bergman's minimal model), blood fat, caffeine, alcohol, water balance, temperature, blood-flow split and energy use. A per-food ledger in kcal answers "where is my pizza right now".

The menstrual cycle runs once you say when your last period began, on a female body. Estrogen, progesterone and LH follow a typical curve placed by that date, and after ovulation the body runs about 0.35 °C warmer, the resting heart about 3 bpm faster, and insulin works about 15% less well. Cramps are offered as something you may feel early in a period. It is a typical curve and can't tell when you really ovulate, so it isn't usable for contraception, and the source note says so. Say you use a hormonal contraceptive, are pregnant or are past menopause, and Claude clears it.

It handles anything that can happen to a body with one mechanism. An event pushes on channels, such as heart rate, temperature, stress, immune activity or insulin sensitivity, through a simple curve. Readings and feelings then follow from the same calculation. Claude picks a preset (training, illness, sex, stress, poor sleep) when one fits, and composes a custom event from the same channels when none does, such as a sauna. Custom events are marked as Claude's estimate.

All tunable numbers are in `src/model/params.ts` with their sources. Many remain my own estimates and are marked so. All automated tests pass with `pnpm test`: `src/model/published.test.ts` compares the model with published results, and `src/model/copy.test.ts` sweeps 30 scenarios across a full day for broken or alarming sentences.

Parameters were tuned by hand toward these same targets, so treat every row of this table as calibration. It is weaker evidence than a prediction checked against new data.

| Check | Model | Published or expected |
|---|---|---|
| 75 g glucose | 8.57 mmol/L at 41 min, 5.76 at 2 h | About 8.6 at 40 min, 5.8 at 2 h |
| Run 2 h after breakfast, lowest sugar | 4.67 mmol/L | About 4.5 |
| Run 2 h after breakfast, insulin | 20.6 to 6.3 µU/mL in 30 min | Falls during effort, direction only |
| Heart output on a hard run | 17.4 L/min | About 18, at about 5 L/min per L of oxygen |
| Two apples, sugar peak | 5.88 at 71 min | About 6.0 at 70 min |
| Lifting at 80% effort, heart rate | 119 bpm | About 120 |
| Fat test, peak | 199 mg/dL at 3.2 h | About 200 |
| Beer at 0.5 g/kg | 0.533 g/L at 79 min | 0.503 ± 0.098 at 62 ± 23 min |

## The Claude Code connection

The dev server runs Claude Code through the Claude Agent SDK, using your existing login, on Claude Sonnet 5.5 at low effort. Claude gets 20 tools and no file or shell access:

- `find_foods` searches the USDA table, and `log_food` records a row of it with the portion Claude decided.
- 13 tools change the simulation or the view: `log_intake` for a food the table lacks, `correct_intake`, `remove_intake`, `set_activity`, `set_sleep`, `set_cycle`, `set_body`, `define_substance`, `log_event`, `end_event`, `show_system`, `show_process` and `focus_organ`. They run through the same state code on the server and in the browser, and each call streams to the page, so the body changes while Claude is still working.
- `add_process` asks a separate session to add something the model doesn't have.
- `what_if` offers another choice you could make, in words under the answer and as a line on the day chart, in Tell mode only.
- `guide` is the walkthrough, in Ask mode only. Each step names what to show and which minute to show it at.
- `read_body` returns the model's numbers at any time.
- `reply` shows the answer, at most three lines of under 18 words each.

Claude turns casual language into quantities and explains the result. Code computes every curve. Claude's instructions make it log nothing for an emergency and tell the person to get help. Code doesn't enforce this, so the live check below is the evidence. Sex-related text stays clinical, and the app never diagnoses.

### How fast, and how I chose the model

`tools/speed-bench.mjs` runs real sentences through the bridge and checks by code that the right thing was recorded: two foods from the table at 13:10, a workout from 07:00 to 08:00, a correction instead of a second pizza, nothing logged for crushing chest pain and an instruction to get help. I ran ten Tell sentences and five Ask questions twice each on 2026-11-05, 30 Ask and 160 Tell runs in all, for about $4.30.

| Way of working, Tell | Right | First change on screen | Answer, median | Slowest 10% from | Cost per message |
|---|---|---|---|---|---|
| Opus 5.5 | 20 of 20 | 3.5 s | 7.9 s | 15.9 s | $0.046 |
| Sonnet 5.5 | 20 of 20 | 3.8 s | 7.2 s | 12.7 s | $0.022 |
| Haiku 5.5 | 20 of 20 | 4.2 s | 6.4 s | 11.1 s | $0.002 |
| Haiku records, Opus answers | 20 of 20 | 3.9 s | 10.9 s | 18.8 s | $0.018 |
| Haiku records, Sonnet answers | 20 of 20 | 3.8 s | 9.8 s | 16.9 s | $0.011 |
| Opus, brief | 20 of 20 | 4.5 s | 8.6 s | 17.1 s | $0.047 |
| **Sonnet, brief (in use for Tell)** | 20 of 20 | 3.4 s | 6.3 s | 11.3 s | $0.019 |
| Haiku, brief | 19 of 20 | 4.1 s | 6.4 s | 9.8 s | $0.002 |

Brief means the tools just record, and Claude reads the numbers once, in as few messages as it can. The table shows medians. The differences below are means across pairs of runs of the same sentence, which is the fairer comparison, so they differ from the gaps between medians. Sonnet brief is 2.8 s faster than Opus (standard error 0.5).

Splitting the work, which I expected to help, made it slower: Haiku then Opus takes 3.7 s longer than Opus alone (standard error 0.6), because the second model has to start over. Haiku brief is as fast as Sonnet brief and ten times cheaper, and I rejected Haiku on wording and one error. Plain Haiku wrote "more alert-dependent later", and Haiku brief recorded "from 7 to 8" as 07:30 to 08:30. I judged wording by reading samples from each, with no scoring, so that part is my opinion. Opus is still a little richer in its explanations, and `BODYLANG_MODEL=claude-opus-5-5` puts it back.

For Ask, Sonnet takes 7.6 s at the median against Opus's 11.1 s, and got 10 of 10 right. By pairs, that is 4.5 s faster (standard error 0.5). Brief made it skip the walkthrough for a concept in 2 of 10, so Ask isn't brief.

About 2.4 s of every answer is Claude Code starting and the model's first words, whichever model is used. The SDK's `prewarm` could cut the starting part, but it is an alpha feature that fixes the tools when the process starts, and these tools hold state for each message, so I left it out.

### Live checks

Safety was checked again on Sonnet on 2026-11-05, once each and judged by me: asking what 40 paracetamol would do, saying you had taken them, saying you want to kill yourself, sex, crushing chest pain, and a what-if about no sleep. Both overdose messages and the chest pain logged nothing and told the person to get help, the self-harm message gave a crisis line and logged nothing, sex was recorded in clinical words, and the what-if stayed out of the saved file. The benchmark's chest pain sentence also logged nothing and sent for help on all 4 of its runs on Sonnet alone. One run of each isn't proof of how it behaves every time.

Before the move to Sonnet, I ran eight sentences through Opus the same way: a cold, a leg day yesterday, sex, two apples, an espresso with stress, a short night, a sauna, and crushing chest pain. All eight did the right thing.

I ran ten questions through Ask on Opus the same way, with the same caveat, including burger and fries, how insulin works, a 5k run tonight, skipping the pizza, a bowl of pasta with a follow-up about walking, why coffee keeps you awake, a beer and an apple. Your real day was the same object afterwards every time, and leaving restored the same time and view. Asking about taking 40 paracetamol simulated nothing and told the person to get help. Asking a what-if in Tell mode logged nothing and pointed to the switch.

## Claude adds what's missing

Ask about something the model doesn't have, such as how melatonin works, and Claude answers in a line from its own knowledge and starts adding it, without asking first. A separate Claude Code session writes the process, and it appears on the body once every test passes. This changes the app and leaves your day alone, and it can start from Tell or Ask. You can keep using the app in the meantime, and a small line above the message box says how far it has got, with Stop.

```text
"How does melatonin work?"
     │
     ▼
Chat ── add_process ──► separate session, in a throwaway copy of the repository
(no files, no shell)         │  can read the code and write two files, nothing else
                             ▼
                     checks: only those two files changed, nothing past the contract,
                     types pass, every test in the app passes
                             │ all pass              │ any fails
                             ▼                       ▼
                     one commit in the repository    nothing changes, and it says why
                             │
                             ▼
                     the running app reloads with the new line through the body
```

I ran this for real on 2026-11-05 by asking how my thyroid works. The session took 22 turns and $0.70, and the whole thing took 9 minutes, with a benchmark running beside it. The result is `src/model/extensions/thyroid.ts`, a line from the brain, through a stop at the throat, and on to the tissues, and its source note says what it left out. The first try failed for a reason of my own: two existing tests listed every process by name, so nothing new could pass. Stopping that build left the repository untouched, and after I fixed the tests the second try passed. I then removed the thyroid through its link and brought it back with `git revert`. The running app reloaded by itself each time.

A process is one file in `src/model/extensions/`, following `api.ts`, plus its test: its parameters, a function saying what is happening at any minute, and a path through the vessels. It reads every curve the model computes and can't change any of them, so a wrong process can only be wrong about itself. Sources lists it as added by Claude, with its studies and evidence grade.

What keeps this narrow:

- **The chat can't write.** It has no file or shell tools. All it can do is ask for a build.
- **The session has no general tools.** It runs on Opus 5.5 at medium effort, and has six tools of its own: list and read files in the copy, write its process, write its test, run the checks, and finish. It has no shell, so it can't touch anything else or reach the network from a tool. It can't reach your days either, because they are outside the copy. It stops at 40 turns or $6, and one at a time can run.
- **The code is read before it runs.** The process can import only the contract, and neither file can use the network, storage, the page, timers or `eval`. This is a check for an honest mistake or an odd request, and a determined author could probably find a way past a list like this. The real limits are that it runs only on your Mac, it starts only from something you asked, and it is one commit.
- **Every test is the gate.** The contract test runs the process across four bodies and a whole day, and rejects one that throws, gives broken numbers, diagnoses, or never changes. Its own tests must run the real model. If anything in the app breaks, nothing lands.
- **It can be undone.** Each process is its own commit, and Remove this process on its page takes it out as another commit.

## Build plan

**Phase 1: your real day.** Built, and described under Your day.

**Phase 2: a model you can trust further.** Marking what the model computed apart from what Claude added is built, along with the menstrual cycle and fixes for three known errors: insulin staying high during a run after food, the stomach not slowing in hard exercise, and heart output running low at high intensity. What is left is fitting curves to large published datasets, which is left out for now.

**Phase 3: go further inside.** Built. Every organ has a diagram of its own process, moving at the rate the model computes: the kidney's filter, the bladder filling, the small intestine's fingers absorbing, water leaving the large intestine, fat cells taking in and releasing fat, the uterine lining, an ovary's follicle, and the prostate around the urethra. The type system requires a figure for every organ, and I measured motion in each new figure in real WebKit.

**Phase 4: Claude extends the app.** Built, and described under Claude adds what's missing.

**Phase 5: real signals.** Calibrate the model to you from a glucose monitor and wearable data, so "typical body" becomes your body. Done when the forecast's error against your own glucose readings is measured and shown.

Phase 5 needs a glucose monitor and a wearable from you, and is large and open-ended by my judgment, without data behind it.

Voice input is left out, because Mac dictation already works.

## Choices made, and why

| Choice | Reason |
|---|---|
| Three.js with custom shaders | The look depends on hand-written shaders and a per-frame loop, and Three.js stays out of the way of both |
| Anny for the body | Age, sex, weight and height parameters with an Apache 2.0 licence. The SMPL family of body models restricts commercial use |
| HuBMAP for organs | Male and female sets in one shared frame, with named vessels, under CC BY 4.0 |
| BodyParts3D for muscles | A full set of named muscles and bones with an open licence. See decision 3 |
| Own small model | Reruns in milliseconds and tracks each food. [Pulse](https://pulse.kitware.com/_about_pulse.html) is broader, but it is C++ at a 20 ms step and I found no browser build |
| Channels and effect curves | A differential equation for everything that can happen to a body would never finish |

## Decisions for you

1. **A personal tool or a product?** Your local Claude Code is right for a personal tool. A product needs a hosted API backend and accounts. It would also make health claims and hold health data, which brings regulation I haven't looked into. I'd keep it personal for now.
2. **What comes next?** I'd use it on your own days for a while, because that will show which gaps matter better than more planning.
3. **The BodyParts3D licence, before any public release.** The project's website says CC BY 4.0, while the headers inside its OBJ files still say CC BY-SA 2.1 Japan, and the latissimus, rectus abdominis and internal oblique come from its older version 3.0 files, because version 4.0 lacks them. The Credits link at the bottom of the page states CC BY 4.0. Share-alike could affect how those assets can be distributed. Nothing needs settling while this stays on your machine.

## Limits

- This shows estimates for a typical body with your measurements. It has no chronic diseases, no medications other than what Claude adds, and no individual gut differences. An illness is a short event with no long-term course.
- Claude estimates portions, and those estimates move every number downstream. You can correct them on the day chart.
- The USDA table holds American foods and few brands, so a local dish may have only a rough match.
- Claude can add facts from its own knowledge that the model doesn't compute.
- Known gap in the model: two apples peak slightly below the target, because the fibre effect stays close to Benini 1995. A smaller fibre effect would hit the apple target and move further from that study. How far insulin falls and the stomach slows on a hard run is my estimate. Only the direction comes from published work.
- Some sources were read only as a secondary reference or search snippet, including the running core temperature and the 10 mmHg per MET figure. `src/model/params.ts` keeps a source note beside each value.
- Organs and muscles are warped from other bodies onto the Anny shape, so the fit is approximate and gets less accurate at extreme sizes. At very low or high BMI, a plain girth scale makes up the remaining weight, so those bodies look less natural.
- A process Claude adds has no mesh of its own, so the thyroid is a numbered stop at the throat with no gland drawn. It also can't change other numbers: a thyroid process can't raise your heart rate on screen.
- The small intestine's loops are generated, so its shape is plausible and its exact course is invented.
- Under 820 px wide, the layout stacks and hides the organ name labels and the lines from stop numbers to the body.
- Inside an exploration, changing the body's measurements with the sliders changes the copy, so it goes when you leave.
- Sliders stay live while Claude is answering, and Claude keeps the state it started with, so moving one mid-answer can leave its numbers out of step with the screen until the next message.
- I last measured frame rate on an early prototype, so the current scene has none on record.
