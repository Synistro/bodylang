# Bodylang

Bodylang is a 3D human body that shows what's going on inside you. Tell it anything that's happened to you (a workout, a bad night, a cold, a late dinner, all the things could happen to a human), and it'll run a physiology model to reflect and explain it. [Ask it](#ask-it-anything) anything you're truly curious about (what happens when you smoke a cigarette? what happens when you get a bullet through the liver?) and your LLM [via API key or subscription] will walk you through the answer in a visual way.

**[Try the demo](https://bodylang.vercel.app)** · **[Run it](#run-it)** with Node and a ChatGPT or Claude subscription

![One day on the body, from 08:00 to 21:10. The camera sits on the brain while caffeine holds off tiredness, moves to the liver and blood sugar in the afternoon, to the thighs as they recover from a leg day, and to a stomach full of dinner, then pulls back to the whole body with every curve of the day on the chart below it](docs/readme/hero.gif)

[Watch the whole app in 90 seconds](https://bodylang.vercel.app/films/bodylang.mp4), with sound.

## Customize it!

Bodylang was opensourced so that anyone can shape it around their own body. Import your blood tests, set your exact properties, or build new layers such as skin or braces:) 

In its default version, Bodylang shows estimates for a typical body. It isn't medical advice and can't diagnose anything. This is an early beta, and [How far to trust it](#how-far-to-trust-it) says where it is weak.

## Tell it what happened

Type what happened the way you would say it:

> We had a nice dinner with pizza and beer at 7:30, then I got a coffee on top

The LLM turns your words into quantities and logs them, taking foods from a table of 12,750 USDA foods. The physiology model recalculates your day, and the body changes within about 3 to 10 seconds, while the LLM is still working. Then the LLM says what it means for you:

> Your stomach has a big job: half empty by 22:45, fully empty near 01:15.
>
> Your liver clears the beer first, until about 01:45.
>
> That coffee will still be working at bedtime, so you may feel wired.

![Typing that sentence into the message box. A moment later the stomach and intestines light up orange on the body, the meal's curve appears on the day chart, and three short lines of explanation appear at the left](docs/readme/tell.gif)

A leg day yesterday, a cold, a sauna, a short night, sex, a medicine or the start of your period all go through the same physiology model. When nothing ready-made fits, the LLM builds the event from the model's parts and it is marked as the LLM's estimate.

- **You can correct it.** Portions are the LLM's estimates, so each food on the day chart has a dotted underline. Click one to change its portion or time, or say "only one slice".
- **It follows your real day.** It runs on your computer's clock and saves as you go, so you can close it and come back. Tomorrow starts from today: a coffee at 23:00 is still in your blood at midnight.
- **It starts as a typical body.** That is a 30-year-old man, 180 cm and 80 kg. Change sex, age, height and weight from the line under the clock, or say so.

## Go inside

Click anything to go one level down, and press Esc to come back up.

| Level | The question it answers | What you see |
|---|---|---|
| Overview | Am I fine, and what is going on? | The body, one sentence and what you may feel |
| System, such as Digestion | How is this part of me? | Its organs lit on the body, and readings against their typical range |
| Something you told it, such as the pizza | Where did it go, and what happens next? | One line through the body with numbered stops, which it can walk you through |
| Organ or muscle | What is happening inside? | The camera inside the organ, and a moving drawing driven by the physiology model's numbers |

![The pointer opens the stomach. The camera moves inside, the stomach fills the screen with food in it, and a drawing at the right shows it squeezing food toward its outlet](docs/readme/inside.gif)

The eight systems are Digestion, Sugar & energy, Heart & lungs, Muscles, Brain & mood, Illness & recovery, Liver & kidneys, and Reproductive. A reading inside its typical range shows its number and nothing more. A reading outside it says why, as in "Blood pressure 175 mmHg. Expected. About 55 mmHg from running."

![The pointer moves down the list of systems. Sugar & energy lights the liver in yellow, Heart & lungs shows the vessels in red and blue, Brain & mood lights the brain in purple, and Liver & kidneys lights the liver in blue, each with its own readings](docs/readme/systems.gif)

## Move through your day

The chart under the body answers what is going on, how much, and when it ends. Drag along it, and the body, the readings and the drawings move to that minute.

![The pointer opens a meal, which draws one numbered line through the body, then drags back along the day chart while the clock runs back toward dinner and the body follows](docs/readme/drag.gif)

- Something that runs out, such as a meal in your gut, is a filled area that ends where it ends, with a mark such as "Digested 00:10".
- Something that never runs out, such as your heart rate, is a line against its typical range.
- Both are solid up to now and dashed after it, so the chart also shows what is ahead of you.
- Muscle soreness runs over days, so the chart stretches to show when a leg day stops hurting.

![The Muscles page after a leg day. The pointer opens the quads and drags along a chart of the coming days, and the muscles change as they recover](docs/readme/muscles.gif)

## Ask it anything

Switch the message box from Tell to Ask, and ask whatever you are curious about.

![Six questions, each on the body for a moment. What does a bullet through the liver do to me? What happens when I donate blood? What does cannabis do to my brain? What happens in my body during sex? Why do I get butterflies when I'm nervous? What happens inside me during a period?](docs/readme/ask-anything.gif)

[Watch it answer questions in a minute and a half](https://bodylang.vercel.app/films/ask.mp4), with sound.

The LLM answers with a walkthrough. Each step moves the camera to where the thing is happening, sets the clock, and says what is happening and why. Click Next to go on, or let it play.

An Ask runs on a copy of your day. The LLM can log an example on the copy, and the body, readings and chart all show it. Nothing you ask is saved to your day: the Back to your day link at the top puts your real day back exactly as it was. For a what-if, the chart draws your real day in grey behind the new one, so the difference is the picture.

![Asking what if I had skipped that second coffee: the brain with a drawing of caffeine blocking its tired signal. The pointer clicks Next, and the clock jumps to bedtime on a chart with that cup taken away](docs/readme/ask-whatif.gif)

Ask has two depths, set beside the switch. Simple gives the idea in 2 or 3 steps with the organs' own drawings, in about 10 to 30 seconds. Deep goes through the mechanism in up to 6 steps, with drawings composed for the answer, such as smoke in an air sac, in about a minute.

Select any words on screen, such as a term in a walkthrough, and a small panel says what they mean in one sentence. Selecting the words sends the request. You can ask follow-ups there, and that conversation is gone when you close the panel.

## How far to trust it

Treat every number as an estimate, and expect some to be wrong. Many of the physiology model's parameters are estimates, marked as such in [`src/model/params.ts`](src/model/params.ts). You can check where anything on screen came from: click Sources at the bottom right, and it lists each item as one of these.

| Where it came from | What it means | Example |
|---|---|---|
| The physiology model | It calculated this, and the note gives the source of its typical range and how far to trust it | Blood sugar 5.1 mmol/L, with the American Diabetes Association's range and evidence A |
| The physiology model, from the LLM's numbers | It calculated this, and something feeding it is the LLM's estimate | Heart rate during a sauna |
| The LLM | Its own words, or a number the physiology model never returned | The description of a custom event |
| The USDA food table | The food's contents | Pizza, cheese, thin crust |
| You | Your own measurements | 62 kg |

Evidence grades go with those notes. A is consistent human studies or official bodies, B is human studies with wide variation, and C is an estimate chosen to match the shape of published curves.

![The Sources list open on the Sugar & energy page, giving blood sugar's typical range with evidence A from the American Diabetes Association, and evidence C for a reading with no published range](docs/readme/sources.jpg)

Code checks the LLM's numbers. The server keeps a list of every number the physiology model returned and everything you said. Any other number in an answer gets a dotted line under it, and Sources says what that line means.

Tests hold the physiology model to published results. Some of them:

| Check | The model | Published or expected |
|---|---|---|
| A standard 75 g glucose drink, blood sugar | 8.57 mmol/L at 41 min, 5.76 at 2 h | About 8.6 at 40 min, 5.8 at 2 h |
| Heart output on a hard run | 17.4 L/min | About 18 |
| Beer with 0.5 g of alcohol per kg of body weight, peak blood alcohol | 0.533 g/L at 79 min | 0.503 ± 0.098 at 62 ± 23 min |

The parameters were tuned by hand toward these same targets, so read this table as calibration. It is weaker evidence than a prediction checked against new data.

The limits that matter most:

- **Portions are estimates.** The LLM estimates them, and they move every number after them.
- **The LLM can add facts of its own.** Those are facts the physiology model doesn't compute, and Sources marks them as added by the AI.
- **The menstrual cycle is a typical curve.** It can't tell when you really ovulate, so it can't be used for contraception.
- **The female body is a male body warped to her shape.** The uterus, ovaries and tubes come from another source, and no uterine vessels are drawn [yet! please contribute]
- **Safety answers come from the LLM's instructions.** For an emergency, an overdose or talk of self-harm, it is told to log nothing and send you for help. It did so in every live test, a few runs of each, and no code enforces it. If something is wrong with your body, call a doctor or your emergency number.

[`ARCHITECTURE.md`](ARCHITECTURE.md) ends with the full list.

## How it works

![What you tell it or ask it goes to your LLM, which chooses tools and fills them in. It logs five kinds of things: workouts, illness, sex and stress; medicines, caffeine and alcohol; sleep and activity; food and drink, from the USDA table; and your body and cycle. They make up your day, which the physiology model works through minute by minute: muscles and recovery, sugar, insulin and blood fat, digestion, hormones and the cycle, stress, immunity, alertness and mood, and the heart, lungs, fluids and temperature. That becomes the body, its readings, the day chart and walkthroughs](docs/readme/how-it-works.svg)

You type what happened, in your own words. The LLM works out what that means, such as which food, how much and when, and records it by calling a few of its twenty or so tools, such as `log_food` or `log_event`. Each call updates your day. The physiology model then recalculates the whole day, minute by minute, in a few milliseconds, and everything you see on screen comes from that one calculation.

**Built from templates.** Every kind of thing in the app has a template, so adding a new one means writing a short file like the ones already there:

- **Events** are curves that push on body signals such as heart rate, temperature and stress. A workout, a cold, sex, stress and a short night come ready-made. For anything else, such as a sauna, the LLM builds an event from the same signals.
- **Processes** are the lines through the body with numbered stops. A new one is a single file plus its test, and the app picks it up by itself. The thyroid and melatonin lines were added this way.
- **Close-ups** are the moving drawings inside each organ. Each one has a few levels from 0 to 1, each described in words, so the model can drive them and the LLM can point at them.
- **Readings, systems and organs** are one entry in a list each, and the compiler then lists every other place that needs updating. Skin, for example, would be a new organ, its close-up and a system entry.

**How Ask works.** Ask uses the same tools on a copy of your day, so nothing it does is saved. If the question needs an example, the LLM logs one on the copy. Then it builds its answer as a series of steps. Each step says which organ to show, at what time, what the close-up should show and what to say, and the app moves the camera and the clock to match. In Deep, the LLM can also sketch a new drawing from simple parts, and the app lays it out. Every number in the answer is checked against what the model calculated.

### Grow it

Bodylang is meant to be changed. Point your coding agent at the repository and ask for what you want: your own blood tests, new systems such as skin, braces, or the uterine vessels the female body still lacks. [`AGENTS.md`](AGENTS.md) has a recipe for each kind of addition, and the compiler and tests say what is missing. Contributions are welcome. Keep each one generic, so it works for any body on any day, and build it from the parts above.

With `BODYLANG_BUILDS=1`, the LLM can also add a process by itself when you ask about something the model doesn't have. A separate session writes it in a throwaway copy of the repository, and it lands as one commit on your branch only if every test passes. If any test fails, nothing changes. This works on Claude only, costs about $0.80 on an API key, and starts without asking you first.

## Run it

Bodylang is a web page and a small Node server, so it should run wherever Node does. It has been tested on a Mac only, so please open an issue if something breaks elsewhere. You need [Node](https://nodejs.org) 20.19 or a later 20.x, or 22.12 or newer, and [pnpm](https://pnpm.io).

Start with the demo, which replays a scripted day and saves nothing. You can click and drag through it with no login. Typing a message, in Tell or Ask, needs an LLM:

```bash
git clone https://github.com/yahorbarkouski/bodylang
cd bodylang
pnpm install
pnpm dev
```

Then open <http://localhost:5183/?demo>.

To use it on your own day, stop the demo server with Ctrl-C and log in once with the subscription you have. Each message counts toward your plan's usage limits, and you get no separate bill.

**With ChatGPT.** Bodylang runs OpenAI's models through its own copy of Codex, which `pnpm install` brought in. This login is for Bodylang alone, so your own Codex settings and tools stay out of it. If your account has more than one workspace, choose the one your plan is on. You log in once, and start with the second line each time:

```bash
pnpm login:openai
BODYLANG_LLM=openai pnpm dev
```

OpenAI's [docs](https://learn.chatgpt.com/docs/app-server) say a local or open-source app can use this login.

**With Claude.** [Install Claude Code](https://code.claude.com/docs/en/overview), then:

```bash
claude auth login
pnpm dev
```

Anthropic's [terms](https://code.claude.com/docs/en/legal-and-compliance) ask developers of products built on its SDK to use API keys, and they don't address a local app running on your own login. An API key is the option clearly inside them: set `ANTHROPIC_API_KEY` before `pnpm dev`. A key always wins over your login, so if one is set in your shell and you want your subscription, run `unset ANTHROPIC_API_KEY` first.

Either way, then open <http://localhost:5183>. If you aren't logged in, the page still opens, and sending a message tells you what to run.

On a Claude API key you pay per message. These figures come from the real messages sent on one day while making the README's films, so yours may differ:

| Message | Cost per message on a key |
|---|---|
| Tell | 2 to 8 cents |
| Ask, Simple | 5 to 15 cents |
| Ask, Deep | 20 to 35 cents |
| Selected words | Under a tenth of a cent |

The page always needs this server, because the server talks to the LLM, so a static build won't work. To use another port, run `pnpm dev --port 5184`. Set these in the environment before `pnpm dev`:

| Setting | What it does |
|---|---|
| `BODYLANG_LLM` | `openai` for ChatGPT's models, and `claude` by default |
| `BODYLANG_DATA` | Keeps your days, and the throwaway copies the LLM builds in, in another folder |
| `BODYLANG_MODEL` | The model for Tell and Simple, by default `gpt-6.1-terra` or `claude-sonnet-5-5` |
| `BODYLANG_DEEP_MODEL` | The model for Deep, by default `gpt-6.1-sol` or `claude-opus-5-5` |
| `BODYLANG_EXPLAIN_MODEL` | The model that explains selected words, by default `gpt-6-luna` or `claude-haiku-5-5` |
| `BODYLANG_BUILDS` | Set to `1` to let the LLM [add a process itself](#grow-it), on Claude |
| `BODYLANG_BUILD_MODEL` | The model that writes those additions, `claude-opus-5-5` by default |

## Quick tip: make it your desktop

On a Mac, you can run the body as your wallpaper. Install [Plash](https://sindresorhus.com/plash), keep `pnpm dev` running, and add this website in Plash:

```text
http://localhost:5183/?wall
```

It slowly cycles through whatever is active in your body when nobody touches it. Turn on Browsing Mode in Plash to click it, and run `open "plash:reload"` to reload it.

## Your data

Bodylang has no account and no analytics, and it runs on your own computer. What you log can be sensitive, such as medicines, sex or your cycle, so this is where it goes.

**On your computer.** Each date is one plain JSON file in `~/.bodylang/days/`. Bodylang doesn't encrypt these files. Disk encryption, such as FileVault on a Mac, protects them while your computer is off, and any app running as you can read them.

**To your LLM's company.** The LLM needs your day to answer, so these requests go to OpenAI or Anthropic, whichever you logged in with:

| Request | What it sends | When |
|---|---|---|
| Tell or Ask | What you typed, your earlier questions in this Ask, what you logged today and yesterday, your measurements, your cycle if you logged one, and the time | Every message |
| Selected words | The words, the text around them, the page you are on, your follow-ups, and the physiology model's numbers for that minute | When you select words |
| A name for your question | The question | Every new Ask |

**Check your training setting before you log your health here.** Both companies can train models on what a subscription sends:

- **ChatGPT.** On Free, Plus and Pro plans, [OpenAI may train its models on your content](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance) unless you turn off Improve the model for everyone, under Settings > Data controls in ChatGPT.
- **Claude.** [Anthropic](https://code.claude.com/docs/en/data-usage) keeps your requests for 30 days, or for 5 years and trains on them if you allow that in your [privacy settings](https://claude.ai/settings/data-privacy-controls). On an API key, it keeps them for 30 days and doesn't train on them.

**Reports from the LLM's tools.** On ChatGPT, Bodylang turns Codex's analytics off and keeps its sessions out of Codex's history. On Claude, Claude Code by default sends usage metrics such as latency and reliability to Anthropic and to third-party logging services, and Anthropic's page says these never include your prompts. On a subscription it also sends error reports, with personal details redacted. To turn them off, start the server with `DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 pnpm dev`. Bodylang tells Claude Code to save no transcripts of these sessions.

**Your login or key.** Codex and Claude Code handle your login, and Bodylang never reads it. Bodylang's Codex login is in `~/.bodylang/codex`. An API key stays in the server's environment and never reaches the browser.

**Other web pages.** Any page you have open could try to send a request to localhost, and these requests use up your plan or your money. The server refuses a request from another origin.

**Reporting a security issue.** Report it privately through the repository's Security tab (Report a vulnerability).

## Build on it

Most of this code is written by agents, so the compiler or a test says what is missing when you add something. [`AGENTS.md`](AGENTS.md) explains how the code fits together and how to change it, for people as much as agents. [`docs/development.md`](docs/development.md) says where each file is, how the films are made and how to rebuild the 3D assets. [`ARCHITECTURE.md`](ARCHITECTURE.md) holds the product design and its evidence.

To check your work, which needs no login or key:

```bash
pnpm check
```

## Credits

- Food composition: [USDA FoodData Central](https://fdc.nal.usda.gov/), public domain.
- Anatomy: [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy), CC BY-SA 4.0, derived from [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), © The Database Center for Life Science. The bones, muscles, organs and vessels here are rewrapped, decimated and warped, and [`public/assets/CREDITS.md`](public/assets/CREDITS.md) says what that means for reusing them.
- Uterus, ovaries and tubes: [HuBMAP CCF 3D Reference Object Library](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html), built from the NLM Visible Human data, CC BY 4.0.
- Body: [Anny](https://github.com/naver/anny) by NAVER Labs Europe, Apache 2.0, using MakeHuman/MPFB2 data, CC0.
- Colours: [Flexoki](https://stephango.com/flexoki) by Steph Ango, MIT.
- Diagram: drawn with [Semantic Mermaid](https://github.com/yahorbarkouski/semantic-mermaid).

The GIFs and films show the real app replaying answers an LLM really gave, with some walkthroughs cut short for length. Their music is synthesised by code in this repository.

## License

The code is under the [MIT License](LICENSE). The meshes in `public/assets/` are not: most are CC BY-SA 4.0, so anything you make from them must share alike, and [`public/assets/CREDITS.md`](public/assets/CREDITS.md) lists each source. The food table comes from USDA and is public domain.
