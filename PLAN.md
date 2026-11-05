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

**Every estimate can be corrected.** Foods have a dotted underline along the top of the day chart. A click opens what you had at that moment: the portion in the units you ate it in, the time, what it holds, whether that comes from USDA or from Claude, and Remove. Each step redraws the curves straight away. Saying "only one slice" does the same through `correct_intake`.

## How the screen is organised

The body stands in the middle of the window. On its left is the rail, an outline of the body: the systems as plain text, with the one you are in opened to show where you are. The message box is at the bottom of that column, with the latest answer as plain text above it. On the right is a page for where you are, in a column of the same width, so the body stays centered. Under the body is the day chart.

The look uses the system font at 13 px for most text and 20 px at most, a warm near-black background with hairlines, and no shadows. Only the day chart and the organ diagrams sit on a panel. Icons are for finding your way and for controls everybody knows, so they appear on the list of systems and on the play, skip, send and close buttons, thin and in one quiet tone. Everything said on the page stays in words. It opens dark, and Light at the bottom right switches to a cream background.

Two questions organise everything:

- **What happened?** The things you told it: pizza, coffee, a chest workout, a cold. These are threads.
- **Where is it happening?** Parts of the body: Digestion, Sugar & energy, Heart & lungs, Muscles, Brain & mood, Immune, Liver & kidneys. These are systems, listed in the rail on the left.

A thread crosses systems, and a system holds parts of several threads. Everything else stays hidden until you go down a level:

| Level | Question it answers | What you see |
|---|---|---|
| 0 Overview | Am I fine, and what is going on? | The body with one accent on what is working hardest, one sentence, and up to three things you may feel. The rail lists one row per thread |
| 1 System | How is this part of me? | That system lit and labelled on the body in its colour, and readings with a typical band. The rail lists what is running there |
| 2 Thread | Where did it go, and what happens next? | One coloured line through the body, numbered stops, and an optional walkthrough |
| 3 Organ or muscle | What is happening inside? | The camera inside, one diagram driven by the numbers, and up to three readings |

One click on the thing itself goes down: a system, an organ, or a thread, which jumps from the overview straight to its line. Esc, any row in the rail, or a click on empty space goes back up.

The day chart answers one question at every level: what is going on, how much, and when does it end? Something that runs out, such as a meal in the gut, is a filled area that ends where it ends, with a mark such as "Digested 00:10". Something that never runs out, such as a heart rate, is a line against its typical band, so "is this normal?" reads straight off it. Both are solid up to now and dashed after. Beside each name is its value at the minute under your pointer.

The overview draws one row per thread in a neutral colour, a system one per reading or worked muscle, a thread one per stop, and an organ its own readings, each in the colour of what is in focus.

You move through the chart the way you would in a player. The skip buttons go to the previous or next moment: what you logged, each named end, and now. Play runs forward to the last of those moments. Dragging or clicking anywhere on the chart moves the body through time and snaps to those moments, unless you hold shift. The top corner says Now, or Back to now once you have moved away. Hovering previews any minute without moving anything. Focus, under the names, shows the stretch from where this began to where it ends, and glides there when you change level. Whole day shows 04:00 to 04:00. A sideways swipe or a pinch also moves around.

These rules keep it quiet:

- **One sentence, one place.** The sentence at the head of the page changes with the level and answers what you just clicked.
- **A reading explains itself when it needs to.** Inside its typical band, a reading shows its number and band with no verdict. Past the band, it adds a line saying why: "Blood pressure 175 mmHg. Expected. About 55 mmHg from running." The word is Expected when the model has a normal cause, and Slightly raised, High or Low in amber or red when it hasn't.
- **Scales read as words.** Inflammation or stress read Quiet, Mild, Moderate or Strong, and 0-to-100 numbers never reach the screen.
- **Colour only with focus.** The overview is neutral, apart from one orange accent on the organs. Open a system or a thread and its one colour appears on the organs, the line, the curves and a small tick and icon in the rail: Digestion orange, Sugar & energy yellow, Heart & lungs red, Muscles magenta, Brain & mood purple, Immune teal, Liver & kidneys blue. Blood vessels stay red and blue.
- **The rail shows activity quietly.** A dimmer name and icon mean nothing is going on there, and the systems that matter most add one word, such as "Working hard".

## Telling and asking

The switch on the message box has two settings. **Tell** is for what happened, and it changes your day. **Ask** is for what would happen and how things work, and it cannot change your day.

An Ask runs on a temporary copy of your day, with your real day set aside untouched. Claude's tools act on the copy, so the body, readings, rail and day chart all show the hypothetical. While you are exploring, a dashed frame runs around the window and a line at the top repeats your question with Back to your day. Leaving through that link, pressing Esc from the overview, or switching to Tell puts your real day back exactly as it was, and anything still on its way from Claude is dropped. A follow-up builds on the same copy. To make something real, switch to Tell and say it happened.

Ask for "what if I eat a burger and fries now" and Claude logs them on the copy, then answers in two parts. The short answer sits above the message box: "Burger and fries would push your blood sugar peak to 8.1 mmol/L around 18:04." A walkthrough sits above the day chart, and each step moves the view and the time and says what is happening and why. The day chart draws your real day in grey behind the hypothetical, so the difference is the picture. A question about a concept, such as how insulin works, changes nothing and uses the same walkthrough to go through the organs involved.

## The object

| Part | What it is |
|---|---|
| Body shape | [Anny](https://github.com/naver/anny), a parametric human model. The browser solves sex, age, height and weight against the mesh's real volume |
| Organs and vessels | Real meshes from the [HuBMAP Human Reference Atlas](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html), one set per sex, fitted to the body |
| Muscles and bones | Real meshes from [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), warped to the body. Each worked group flushes in the Muscles colour, and the body turns to show it |
| Stomach | Generated in code, because the atlas has none and a stomach changes shape. Its size follows the model's millilitres |
| Small intestine | One generated tube filling the atlas's volume, because the atlas walls can't be recovered as a tube |
| Process line | One line through real vessel paths, coloured as far as the thing has got, with a few slow beads on the current stretch |
| Posture | An invisible rig: the body sits, stands, walks, runs or lies down according to the day |

## The physiology model

The model is about 5,900 lines of TypeScript with no dependencies. It runs in one-minute steps from midnight to 06:00 the next day, after first running yesterday when anything from yesterday is logged. One recalculation takes about 3 ms without yesterday and 5 ms with it. Muscle soreness uses curves that reach past that window, so last week's leg day still counts today. It covers gastric emptying, absorption, glucose and insulin (Bergman's minimal model), blood fat, caffeine, alcohol, water balance, temperature, blood-flow split and energy use. A per-food ledger in kcal answers "where is my pizza right now".

It handles anything that can happen to a body with one mechanism. An event pushes on channels, such as heart rate, temperature, stress, immune activity or insulin sensitivity, through a simple curve. Readings and feelings then follow from the same calculation. Claude picks a preset (training, illness, sex, stress, poor sleep) when one fits, and composes a custom event from the same channels when none does, such as a sauna. Custom events are marked as Claude's estimate.

All tunable numbers are in `src/model/params.ts` with their sources. Many remain my own estimates and are marked so. All  automated tests pass with `pnpm test`: `src/model/published.test.ts` compares the model with published results, and `src/model/copy.test.ts` sweeps 30 scenarios across a full day for broken or alarming sentences.

Parameters were tuned by hand toward these same targets, so treat every row of this table as calibration. It is weaker evidence than a prediction checked against new data.

| Check | Model | Published or expected |
|---|---|---|
| 75 g glucose | 8.57 mmol/L at 41 min, 5.76 at 2 h | About 8.6 at 40 min, 5.8 at 2 h |
| Run 2 h after breakfast, lowest sugar | 4.48 mmol/L | About 4.5 |
| Two apples, sugar peak | 5.88 at 71 min | About 6.0 at 70 min |
| Lifting at 80% effort, heart rate | 119 bpm | About 120 |
| Fat test, peak | 199 mg/dL at 3.2 h | About 200 |
| Beer at 0.5 g/kg | 0.533 g/L at 79 min | 0.503 ± 0.098 at 62 ± 23 min |

## The Claude Code connection

The dev server runs Claude Code through the Claude Agent SDK, using your existing login, on Claude Opus 5.5 at low effort. Claude gets 17 tools and no file or shell access:

- `find_foods` searches the USDA table, and `log_food` records a row of it with the portion Claude decided.
- 12 tools change the simulation or the view: `log_intake` for a food the table lacks, `correct_intake`, `remove_intake`, `set_activity`, `set_sleep`, `set_body`, `define_substance`, `log_event`, `end_event`, `show_system`, `show_process` and `focus_organ`. They run through the same state code on the server and in the browser, and each call streams to the page, so the body changes while Claude is still working.
- `what_if` draws an alternative on the day chart, in Tell mode only.
- `guide` is the walkthrough, in Ask mode only. Each step names what to show and which minute to show it at.
- `read_body` returns the model's numbers at any time.
- `reply` shows the answer, at most three lines of under 18 words each.

Claude turns casual language into quantities and explains the result. Code computes every curve. Claude's instructions make it log nothing for an emergency and tell the person to get help. Code doesn't enforce this, so the live check below is the evidence. Sex-related text stays clinical, and the app never diagnoses.

I ran eight real sentences through live Claude on 2026-11-05: a cold, a leg day yesterday, sex, two apples, an espresso with stress, a short night, a sauna, and crushing chest pain. I ran each one once and judged the result myself. All eight did the right thing, and the chest pain message logged nothing and told the person to call emergency services. On the other seven, the first change on the body came after 4 to 6 s, or 9 s for the sauna. The full answer took 9 to 16 s.

I ran ten questions through Ask the same way, once each, with the same caveat: burger and fries, how insulin works, a 5k run tonight, skipping the pizza, a bowl of pasta with a follow-up about walking, why coffee keeps you awake, a beer and an apple. Your real day was the same object afterwards every time, and leaving restored the same time and view. Asking about taking 40 paracetamol simulated nothing and told the person to get help. Asking a what-if in Tell mode logged nothing and pointed to the switch. Answers took 9 to 16 s, with the first change on screen after 4 to 11 s.

## Build plan

**Phase 1: your real day.** Built, and described under Your day.

**Phase 2: a model you can trust further.** Exercise, illness and water balance are in, and each close-up shows its evidence grade when you hover over its Source link. Next come fitting curves to published datasets, the menstrual cycle, and marking what the model computed apart from what Claude added from its own knowledge. Done when every number and sentence on screen shows where it came from.

**Phase 3: go further inside.** Close-ups exist for the stomach, liver, brain, heart, pancreas, lungs, immune system and muscles. Kidneys, intestines, bladder and fat have short text cards. Add diagrams for those, plus the uterus, ovaries and prostate, which are missing. Done when a click on any organ shows its own process in motion.

**Phase 4: Claude extends the app.** Give a separate Claude Code session write access to this repo and a narrow contract for adding a process: a parameter file, a model function, a path through the vessels and a test, with the tests as the gate before hot reload. The chat path keeps no file or shell access. Done when a request for a process that doesn't exist yet ends with it on screen and its tests passing.

**Phase 5: real signals.** Calibrate the model to you from a glucose monitor and wearable data, so "typical body" becomes your body. Done when the forecast's error against your own glucose readings is measured and shown.

Phases 2, 3 and 4 don't depend on each other. Phase 5 needs a glucose monitor and a wearable from you. Sizes are my judgment, without data behind them: phases 3 and 4 are medium, 2 and 5 are large and open-ended.

Response speed and voice input are a separate track. I'd try Claude Haiku 5.5 for turning language into quantities, with Opus writing the answer, and prompt caching.

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

1. **A personal tool or a product?** Your local Claude Code is right for a personal tool. A product needs a hosted API backend and accounts. It would also make health claims and hold health data, which brings regulation I haven't looked into. I'd keep it personal through phase 2 and decide then.
2. **What comes next?** I'd start with phase 1, because using it on your own days will show which gaps matter.
3. **The BodyParts3D licence, before any public release.** The project's website says CC BY 4.0, while the headers inside its OBJ files still say CC BY-SA 2.1 Japan, and the latissimus, rectus abdominis and internal oblique come from its older version 3.0 files, because version 4.0 lacks them. The Credits link at the bottom of the page states CC BY 4.0. Share-alike could affect how those assets can be distributed. Nothing needs settling while this stays on your machine.

## Limits

- This shows estimates for a typical body with your measurements. It has no chronic diseases, no medications other than what Claude adds, and no individual gut differences. A cold is an event with a limited course.
- Claude estimates portions, and those estimates move every number downstream. You can correct them on the day chart.
- The USDA table holds American foods and few brands, so a local dish may have only a rough match.
- Claude can add facts from its own knowledge that the model doesn't compute.
- Known gaps in the model: insulin stays high during a run after food, when it should fall. The stomach doesn't slow in hard exercise. Heart output runs low at high intensity. Two apples peak slightly below the target, because the fibre effect stays close to Benini 1995. A smaller fibre effect would hit the apple target and move further from that study.
- Some sources were read only as a secondary reference or search snippet, including the running core temperature and the 10 mmHg per MET figure. `src/model/params.ts` keeps a source note beside each value.
- Organs and muscles are warped from other bodies onto the Anny shape, so the fit is approximate and gets less accurate at extreme sizes. At very low or high BMI, a plain girth scale makes up the remaining weight, so those bodies look less natural.
- The small intestine's loops are generated, so its shape is plausible and its exact course is invented.
- Under 820 px wide, the layout stacks and hides the organ name labels and the lines from stop numbers to the body.
- Inside an exploration, changing the body's measurements with the sliders changes the copy, so it goes when you leave.
- Sliders stay live while Claude is answering, and Claude keeps the state it started with, so moving one mid-answer can leave its numbers out of step with the screen until the next message.
- I last measured performance on the first mock, so the current scene has no frame rate on record.
