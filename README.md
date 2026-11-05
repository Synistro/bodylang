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

Your days are saved as one file per date in `~/.bodylang/days/`. Set `BODYLANG_DATA` to keep them somewhere else, and `BODYLANG_MODEL` to use a model other than `claude-opus-5-5`.

```bash
pnpm test
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

| Path | What it holds |
|---|---|
| `src/model/` | Physiology model, events, readings and verdicts, processes, threads, day chart rows (`lanes.ts`), all tunable numbers (`params.ts`), tests |
| `src/look.ts` | The colours of the systems, shared by the interface and the 3D scene |
| `src/agent/actions.ts` | The function schemas and the reducer that Claude, the demo and the browser share |
| `src/scene/` | Three.js: body, organs, muscles, stomach, process line, shaders, camera |
| `src/ui/` | Rail, page, day chart, message box, labels and stop numbers on the figure |
| `src/ui/insets/` | The organ and muscle close-up figures |
| `src/wall.ts` | Wallpaper mode |
| `src/model/day.ts` | The real clock, the day file, and what carries over to the next day |
| `server/agent.ts` | The Claude Code bridge, its system prompt and its tools |
| `server/days.ts` | Reads and writes the day files |
| `server/foods.ts`, `server/foods.json` | The USDA food table and its search |
| `pipeline/` | Python that builds `public/assets/` from the source meshes, and `server/foods.json` from USDA's files |
| `tools/webkitshot.swift` | Renders the page in real WebKit off-screen and saves a PNG, the same engine Plash uses |

To look at any state without opening a window, compile the tool once. It takes a URL, width, height, seconds to wait, an output file, and optional JavaScript to run first. In development `window.bodylang` exposes `dispatch`, `setUi`, `setBody` and `getState`.

```bash
swiftc tools/webkitshot.swift -o /tmp/webkitshot
```

```bash
/tmp/webkitshot "http://localhost:5183/" 1440 900 7 out.png 'window.bodylang.dispatch({name:"show_system",args:{system:"immune"}})'
```

## Rebuild the assets

The built files in `public/assets/` are enough to run the app. Rebuild them only to change the meshes. This downloads about 110 MB of organ meshes, plus PyTorch for the body export. BodyParts3D is a separate download of about 600 MB.

```bash
uv venv --python 3.12 .venv-pipeline
```

```bash
uv pip install --python .venv-pipeline/bin/python anny torch scipy scikit-image fast-simplification trimesh
```

```bash
.venv-pipeline/bin/python pipeline/build_body.py
```

```bash
pipeline/fetch_organs.sh /tmp/hubmap-organs
```

```bash
.venv-pipeline/bin/python pipeline/build_organs.py /tmp/hubmap-organs
```

The muscles need two BodyParts3D folders you [download](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html) yourself: the version 4.0 `is_a` OBJ set, and the version 3.0 STL files for FMA13358, FMA13359, FMA13377, FMA13378, FMA13892 and FMA13893.

```bash
.venv-pipeline/bin/python pipeline/build_muscles.py <4.0 is_a obj folder> <3.0 stl folder> <cache folder>
```

The food table comes from two public USDA downloads, which need no account. `pipeline/build_foods.py` lists them at the top.

## Credits

- Food composition: [USDA FoodData Central](https://fdc.nal.usda.gov/), public domain.
- Organs and vessels: [HuBMAP CCF 3D Reference Object Library](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html), built from the NLM Visible Human data, CC BY 4.0. The meshes here are rewrapped, decimated and warped.
- Muscles and bones: [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), © The Database Center for Life Science, CC BY 4.0 according to the project's website. The OBJ file headers still say CC BY-SA 2.1 Japan, so check this before any public release. The meshes here are rewrapped, decimated and warped.
- Body: [Anny](https://github.com/naver/anny) by NAVER Labs Europe, Apache 2.0, using MakeHuman/MPFB2 data, CC0.
- Colours: [Flexoki](https://stephango.com/flexoki) by Steph Ango.

Bodylang shows estimates for a typical body and isn't medical advice.
