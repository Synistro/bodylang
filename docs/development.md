# Developing Bodylang

This page says where each file is, how to look at any state of the app, how the README's films are made, and how to rebuild the 3D assets. [`AGENTS.md`](../AGENTS.md) explains how the code fits together and how to change it, and defines words used here such as Trajectory and walkthrough. [`README.md`](../README.md) says how to run the app.

To check the code, run this. It runs the type check, the format check and all tests in about 20 seconds, and it needs no key:

```bash
pnpm check
```

Your own days live in `~/.bodylang/days`. To test the app without touching them, run a second server with its own data folder. This page calls it the test server:

```bash
BODYLANG_DATA=/tmp/bodylang-test pnpm exec vite --port 5199
```

## Where things are

| Path | What it holds |
|---|---|
| `src/model/engine/` | The loop: `simulate.ts` runs a day minute by minute through the gut, glucose, fluids, heart and feel steps, and gives a `Trajectory` |
| `src/model/assess/` | Readings, verdicts, feelings, muscles and each system's status |
| `src/model/processes/` | The numbered lines through the body, for food, doses, events and what runs all day |
| `src/model/events/` | Event presets, their effect curves, and muscle recovery |
| `src/model/params.ts` | Every tunable physiology number, with its source |
| `src/model/ids.ts`, `scenario.ts` | The shared names, and what a day is made of |
| `src/model/day.ts` | The real clock, the day file, and what carries over to the next day |
| `src/model/lanes.ts`, `threads.ts`, `forecast.ts`, `whereabouts.ts`, `readout.ts` | The day chart's rows, the rows of things you told it, what's ahead, where a food is, and what Claude reads |
| `src/model/origin.ts`, `src/ui/sources.ts` | Where each number and sentence came from, and the list that says so |
| `src/model/acting.ts`, `src/ui/ActingHere.tsx` | Everything acting on an organ right now, read from the model's processes |
| `src/model/cycle.ts` | The menstrual cycle |
| `src/model/extensions/` | Processes Claude has added, and the contract they follow (`api.ts`) |
| `src/actions/` | The function schemas, the reducer that Claude, the demo and the browser share, and trace lines |
| `src/wire.ts` | Everything that crosses between the browser and the dev server |
| `src/store.ts` | The page's state, and what it derives from the day |
| `src/look.ts` | The colours of the systems, shared by the interface and the 3D scene |
| `src/scene/` | Three.js: body, organs, muscles, stomach, process line, shaders, camera |
| `src/ui/` | Rail, page, day chart, message box, labels and stop numbers on the figure |
| `src/ui/insets/` | The organ and muscle close-up figures, and the anatomy they share (`parts/`) |
| `src/closeup/` | What Claude can direct in an organ's close-up during an Ask walkthrough, and the drawings it can compose: levels in words, how the model sets them, and the layout rules |
| `src/wall.ts` | Wallpaper mode |
| `server/routes.ts`, `server/http.ts`, `server/requestGuard.ts` | The one table of routes, reading requests and streaming events, and which requests are turned away |
| `server/tell.ts`, `tellTurn.ts`, `tellPrompt.ts`, `claude.ts` | The Claude bridge: running a turn, its tools, its prompts, and its settings |
| `server/llm.ts`, `runLlm.ts`, `claude.ts`, `codex.ts` | Which LLM answers and with which model, and how each one runs, with only Bodylang's tools |
| `server/numberCheck.ts` | Checks every number in Claude's replies against what the model returned |
| `server/explain.ts`, `src/ui/Explain.tsx` | What selected words mean, from Haiku, in a panel above them |
| `server/extend.ts`, `extendSession.ts`, `extendCheck.ts` | Adding a process: the steps that land it, the session that writes it, and the checks before it lands |
| `server/track.ts` | What an injury's straight line really crosses, tested against the atlas meshes |
| `server/days.ts` | Reads and writes the day files |
| `server/foods.ts`, `server/foods.json` | The USDA food table and its search |
| `pipeline/` | Python that builds `public/assets/` from the source meshes, and `server/foods.json` from USDA's files |
| `tools/speed-bench.mjs` | Measures how fast and how right the answers are across models. Every run costs money, and it saves each result and stops at its budget |
| `demo/`, `tools/webkitclip.swift` | The README's films, described under [The README's films](#the-readmes-films) |
| `site/` | The landing page: the app in embed mode filling the window, the recorded day and example answers it replays, and a short page with the film's GIF for screens too narrow for the app. `pnpm build:site` builds it into `dist/site`, with the app in `dist/site/app` |
| `src/ui/embed.ts`, `replay.ts`, `ExamplePicker.tsx`, `EmbedChrome.tsx` | Embed mode, `?embed`: the app shows the day the page around it sends, offers its example questions in the message box's place, replays their recorded answers, and shows the product's name, links and run commands in place of the clock and footnotes. It saves nothing, calls no LLM and takes no typing |
| `docs/readme/` | The README's GIFs and the Sources picture, cut from the films' frames |
| `tools/webkitshot.swift` | Renders the page in real WebKit off-screen and saves a PNG, the same engine Plash uses |

## Look at any state

To look at any state without opening a window, compile the tool once. It takes a URL, width, height, seconds to wait, an output file, and optional JavaScript to run first. In development `window.bodylang` exposes `dispatch`, `setUi`, `setBody` and `getState`. This example uses the test server's `?demo`, because a plain page loads and saves a real day.

```bash
swiftc tools/webkitshot.swift -o /tmp/webkitshot
```

```bash
/tmp/webkitshot "http://localhost:5199/?demo" 1440 900 14 /tmp/out.png 'window.bodylang.dispatch({name:"show_system",args:{system:"immune"}})'
```

## The README's films

The films are the real app, driven by a scripted cursor and filmed frame by frame on a virtual clock, replaying real Claude answers. `demo/record.mjs` records those answers once, which needs a key and costs money, so making a film calls no Claude. `demo/sound/compose.py` synthesises the music. Remotion adds the captions and camera moves.

Start the test server from the top of this page, then make a film, which films port 5199 unless you set `BODYLANG_URL`. It needs Node, pnpm, ffmpeg, Xcode's `swiftc`, and a Python with numpy and scipy. Set `PYTHON` if that isn't `python3`. Don't edit `src/` during a render, because the server reloads the page being filmed and a scripted click can fail.

```bash
demo/render.sh walkthrough
```

```bash
demo/render.sh ask
```

Each film lands in `demo/out/`, as a silent master and one file per music take. Only `demo/` depends on Remotion, and the app doesn't use it. Remotion has [its own licence](https://www.remotion.dev/license): it is free for individuals, non-profits and companies of up to 3 people, and larger companies need a company licence to make videos with it.

GitHub plays a video in a README only from a file uploaded through its web editor, which has a 10 MB limit on a free plan. That is why the README's films stay under it.

## Rebuild the assets

The built files in `public/assets/` are enough to run the app. Rebuild them only to change the meshes. This needs Blender, downloads about 110 MB of meshes, and takes about 20 minutes.

```bash
uv venv --python 3.12 .venv-pipeline
```

```bash
uv pip install --python .venv-pipeline/bin/python -r pipeline/requirements.txt
```

```bash
.venv-pipeline/bin/python pipeline/build_body.py
```

Download Z-Anatomy at its pinned commit and export it. Blender runs with the file's own scripts turned off:

```bash
pipeline/fetch_zanatomy.sh pipeline/cache/zanatomy
```

```bash
.venv-pipeline/bin/python pipeline/build_muscles.py pipeline/cache/zanatomy pipeline/cache/muscles
```

```bash
.venv-pipeline/bin/python pipeline/build_female_organs.py pipeline/cache/female
```

```bash
.venv-pipeline/bin/python pipeline/build_atlas.py pipeline/cache/zanatomy pipeline/cache/atlas pipeline/cache/female
```

`pipeline/body_warp.py` moves anything from Z-Anatomy's frame into the Anny bodies, and every build uses it, so bones, muscles, organs and vessels stay in register. `build_atlas.py` stops if an organ comes out hollow or spiked, or if it or a vessel lands outside the skin. A structure ships only if the model drives it or an explanation names it, so the part lists at the top of `build_muscles.py` and `build_atlas.py` are short on purpose.

The food table comes from two public USDA downloads, which need no account. `pipeline/build_foods.py` lists them at the top.
