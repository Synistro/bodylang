#!/bin/bash
# Films one of the README's demos from the real app, and renders it.
#
#   demo/render.sh walkthrough
#
# Claude isn't called. walkthrough/day.json and dinner.json, and everything in <film>/recordings/, hold what Claude
# really sent, recorded once by demo/record.mjs. <film>/scene.js replays those on the real page and drives the page the
# way a person would, through driver.js, and <film>/opening.js films what plays before it.
#
# Start a test server first, in another terminal, so filming never touches your real days:
#
#   BODYLANG_DATA=/tmp/bodylang-test pnpm exec vite --port 5199
#
# Needs Node, pnpm, ffmpeg, Xcode's swiftc, and a Python with numpy and scipy (set PYTHON if it isn't python3). Only the
# demo's own folder holds Remotion.
set -euo pipefail
film="${1:?Which film? Such as walkthrough}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
url="${BODYLANG_URL:-http://localhost:5199}"
out="$here/out/$film"

curl -sf -o /dev/null "$url/" || { echo "No server at $url. Start the test server described at the top of this file." >&2; exit 1; }

cd "$here"
[ -d node_modules ] || pnpm install --frozen-lockfile
mkdir -p out
[ out/webkitclip -nt "$root/tools/webkitclip.swift" ] || swiftc "$root/tools/webkitclip.swift" -o out/webkitclip

recordings() {
  printf 'window.__recordings={'
  for recording in walkthrough/day.json walkthrough/dinner.json "$film"/recordings/*.json; do
    [ -f "$recording" ] || continue
    printf '"%s":' "$(basename "$recording" .json)"; cat "$recording"; printf ','
  done
  printf '};\n'
  cat driver.js
}

rm -rf "$out"
mkdir -p "$out"
{ recordings; cat "$film/scene.js"; } > "$out/scene.js"
out/webkitclip "$url/?demo" 1120 700 30 14 "$out" "$out/scene.js"

# The opening is filmed on its own, and plays before the take.
mkdir -p "$out/opening"
{ recordings; cat "$film/opening.js"; } > "$out/opening/scene.js"
out/webkitclip "$url/?demo" 1120 700 30 14 "$out/opening" "$out/opening/scene.js"
node -e "
  const fs = require('fs');
  const film = JSON.parse(fs.readFileSync('$out/film.json'));
  film.opening = { ...JSON.parse(fs.readFileSync('$out/opening/film.json')), frames: 'opening/frames' };
  fs.writeFileSync('$out/props.json', JSON.stringify(film));
"
pnpm exec remotion render src/index.ts Film "out/$film.mp4" --public-dir="$out" --props="$out/props.json" --crf=18 --image-format=jpeg --jpeg-quality=95 --log=error

# Each take of the film's score, on the film. These are the ones small enough to upload to GitHub.
rm -rf "$out/sound"
"${PYTHON:-python3}" sound/compose.py "$out/props.json" "$out/sound"
for wav in "$out"/sound/*.wav; do
  take="$(basename "$wav" .wav)"
  ffmpeg -y -loglevel error -i "out/$film.mp4" -i "$wav" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart "out/$film-$take.mp4"
  echo "Rendered $here/out/$film-$take.mp4"
done
