#!/bin/sh
# Downloads Z-Anatomy at the pinned commit and exports what the build scripts read.
# Usage: fetch_zanatomy.sh <cache folder>. Needs Blender, and writes about 400 MB there.
# The .blend carries its own Python, so Blender runs with autoexec off and only export_zanatomy.py runs.
set -eu
commit=bb293be456f6d2245191f37752d14ec76894740d
sha=e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736
out="$1"
here=$(cd "$(dirname "$0")" && pwd)
blender=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p "$out"
zip="$out/Z-Anatomy.zip"
[ -f "$zip" ] || curl -sSfL -o "$zip" "https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/$commit/Z-Anatomy.zip"
echo "$sha  $zip" | shasum -a 256 -c -
unzip -q -o "$zip" Z-Anatomy/Startup.blend -d "$out"
"$blender" -b --factory-startup --disable-autoexec "$out/Z-Anatomy/Startup.blend" --python "$here/export_zanatomy.py" -- "$out"
