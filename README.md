# Bodylang

A 3D human body that shows what is happening inside you. You tell it in plain words what you ate, did or came down with, Claude Code turns that into function calls, and a physiology model redraws the body. The design and roadmap are in [PLAN.md](PLAN.md).

## Run it

Requires Node 20 or newer, pnpm, and Claude Code logged in on this machine.

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:5183. It opens on today at the real time. Anything you type goes to your local Claude Code through the dev server, so it needs the dev server and doesn't work from a static build. http://localhost:5183/?demo replays a scripted day with no model call, and saves nothing.

Your days are saved as one file per date in `~/.bodylang/days/`. Set `BODYLANG_DATA` to keep them somewhere else, `BODYLANG_EXPLAIN_MODEL` to explain selected words with something other than `claude-haiku-5-5`, and `BODYLANG_MODEL` to use a model other than `claude-sonnet-5-5`, such as `claude-opus-5-5`.

```bash
pnpm check
```

## Run it as your wallpaper

Install [Plash](https://sindresorhus.com/plash), keep `pnpm dev` running, and add this website in Plash:

```text
http://localhost:5183/?wall
```

The `?wall` mode runs at a lower pixel ratio, keeps short reasons open because a wallpaper can't be hovered, and slowly cycles through active systems when nobody touches it. Turn on Browsing Mode in Plash to click it. To reload it from a terminal:

```bash
open "plash:reload"
```

## Where things are

`AGENTS.md` explains how the code fits together and how to change it.

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
| `server/tell.ts`, `tellTurn.ts`, `tellPrompt.ts`, `claude.ts` | The Claude Code bridge: running a turn, its tools, its prompts, and its settings |
| `server/numberCheck.ts` | Checks every number in Claude's replies against what the model returned |
| `server/explain.ts`, `src/ui/Explain.tsx` | What selected words mean, from Haiku, in a panel above them |
| `server/extend.ts`, `extendSession.ts`, `extendCheck.ts` | Adding a process: the steps that land it, the session that writes it, and the checks before it lands |
| `server/track.ts` | What an injury's straight line really crosses, tested against the atlas meshes |
| `server/days.ts` | Reads and writes the day files |
| `server/foods.ts`, `server/foods.json` | The USDA food table and its search |
| `pipeline/` | Python that builds `public/assets/` from the source meshes, and `server/foods.json` from USDA's files |
| `tools/speed-bench.mjs` | Measures how fast and how right the answers are across models. Every run costs money, and it saves each result and stops at its budget |
| `tools/webkitshot.swift` | Renders the page in real WebKit off-screen and saves a PNG, the same engine Plash uses |

To look at any state without opening a window, compile the tool once. It takes a URL, width, height, seconds to wait, an output file, and optional JavaScript to run first. In development `window.bodylang` exposes `dispatch`, `setUi`, `setBody` and `getState`.

```bash
swiftc tools/webkitshot.swift -o /tmp/webkitshot
```

```bash
/tmp/webkitshot "http://localhost:5183/?demo" 1440 900 14 /tmp/out.png 'window.bodylang.dispatch({name:"show_system",args:{system:"immune"}})'
```

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

## Credits

- Food composition: [USDA FoodData Central](https://fdc.nal.usda.gov/), public domain.
- Anatomy: [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy), CC BY-SA 4.0, derived from [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), © The Database Center for Life Science. The bones, muscles, organs and vessels here are rewrapped, decimated and warped, and `public/assets/CREDITS.md` says what that means for reusing them.
- Uterus, ovaries and tubes: [HuBMAP CCF 3D Reference Object Library](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html), built from the NLM Visible Human data, CC BY 4.0.
- Body: [Anny](https://github.com/naver/anny) by NAVER Labs Europe, Apache 2.0, using MakeHuman/MPFB2 data, CC0.
- Colours: [Flexoki](https://stephango.com/flexoki) by Steph Ango.

Bodylang shows estimates for a typical body and isn't medical advice.
