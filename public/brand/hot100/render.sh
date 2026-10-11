#!/usr/bin/env bash
# Render the Makin' It HOT 100 mockup slides, 1080x1350.
#   ./render.sh                     -> the review set
#   ./render.sh <out.png> "<query>" -> one slide
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8783
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
render () {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1080,1350 --virtual-time-budget=20000 --screenshot="$DIR/$1" \
    "http://127.0.0.1:$PORT/hot100/hot100.html?$2" >/dev/null 2>&1
  echo "$1"
}
if [ $# -eq 0 ]; then
  rm -f "$DIR"/*.png
  render hot100-cover.png         "slide=cover"
  render hot100-p1.png            "slide=list&page=1"
  render hot100-p2.png            "slide=list&page=2"
  render hot100-p1-compact.png    "slide=list&page=1&per=20"
  render hot100-team.png          "slide=team"
  render scored-cover.png         "slide=cover&scores=1"
  render scored-p1.png            "slide=list&page=1&scores=1"
  render ars-cover.png            "slide=cover&mode=ars"
  render ars-p1.png               "slide=list&page=1&mode=ars"
  exit 0
fi
render "$1" "$2"
