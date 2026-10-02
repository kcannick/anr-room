#!/usr/bin/env bash
# Render the Makin' It Daily Countdown carousel, 1080x1350.
#   ./render.sh                         -> the seven sample slides + long-copy stress variants
#   ./render.sh <out.png> "<query>"     -> one slide, e.g. "slide=3&date=2026-10-02&song=...&artist=...&ig=..."
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8781
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
render () {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1080,1350 --virtual-time-budget=20000 --screenshot="$DIR/$1" \
    "http://127.0.0.1:$PORT/countdown/countdown.html?$2" >/dev/null 2>&1
  echo "$1"
}
if [ $# -eq 0 ]; then
  rm -f "$DIR"/countdown-*.png "$DIR"/stress-*.png
  N=12   # the sample day; a real day is 8–16
  render countdown-00-cover.png "slide=cover&n=$N"
  i=1
  for r in $(seq $N -1 1); do render "countdown-$(printf %02d $i)-rank$(printf %02d $r).png" "slide=$r&n=$N"; i=$((i+1)); done
  render "countdown-$(printf %02d $i)-team.png" "slide=team&n=$N"; i=$((i+1))
  render "countdown-$(printf %02d $i)-cta.png" "slide=cta&n=$N"
  L="song=Everything%20I%20Never%20Said%20Before%20the%20Summer%20Ended%20(Remix)&artist=Marcus%20Whitfield%20featuring%20The%20Southside%20Collective&ig=marcuswhitfieldofficialmusic"
  render alt-team-become.png  "slide=team&n=$N&join=become"
  render stress-16-cover.png   "slide=cover&n=16"
  render stress-16-rank16.png  "slide=16&n=16"
  render stress-16-rank11.png  "slide=11&n=16&$L"
  render stress-16-rank1.png   "slide=1&n=16&$L"
  render stress-08-cover.png   "slide=cover&n=8"
  render stress-08-rank8.png   "slide=8&n=8"
  exit 0
fi
render "$1" "$2"
