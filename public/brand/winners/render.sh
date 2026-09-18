#!/usr/bin/env bash
# Render the winner posts (4.15), 1080x1350 portrait, for Instagram collab posts.
#
#   ./render.sh                                  -> the four sample posts + two variants
#   ./render.sh track day|week "Artist" "Song" ig 2026-09-12 [rank] [score] [drop-date, week only]
#   date = the drop day (day) or the FIRST day of the week it tracks (week)
#   ./render.sh ar day "A&R Name" "Producer" "Atlanta, GA" 2026-09-12 [grade] [pts] [bulls] [photo-url]
#   period is day | week
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8779
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
enc () { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
render () {  # $1 outfile  $2 query
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1080,1350 --virtual-time-budget=20000 --screenshot="$DIR/$1" \
    "http://127.0.0.1:$PORT/winners/winner.html?$2" >/dev/null 2>&1
  echo "$1"
}
if [ $# -eq 0 ]; then
  render winner-track-day.png   "kind=track&period=day&score=8.4"
  render winner-ar-day.png      "kind=ar&period=day"
  render winner-track-week.png  "kind=track&period=week&score=8.4"
  render winner-ar-week.png     "kind=ar&period=week"
  render winner-track-week-long.png   "kind=track&period=week&song=A%20Much%20Longer%20Song%20Title%20Here&name=A%20Much%20Longer%20Artist%20Name"
  render winner-ar-day-nophoto.png    "kind=ar&period=day&photo=&name=A%20Much%20Longer%20Name"
  exit 0
fi
KIND="$1"; PERIOD="$2"; NAME="$3"
if [ "$KIND" = track ]; then
  q="kind=track&period=$PERIOD&name=$(enc "$NAME")&song=$(enc "${4:-}")&ig=$(enc "${5:-}")&date=${6:-}&rank=${7:-1}&score=${8:-}&drop=${9:-}"
else
  q="kind=ar&period=$PERIOD&name=$(enc "$NAME")&title=$(enc "${4:-}")&city=$(enc "${5:-}")&date=${6:-}&grade=${7:-}&pts=${8:-}&bulls=${9:-}&photo=$(enc "${10:-}")"
fi
slug=$(python3 -c 'import sys,re;print(re.sub(r"[^a-z0-9]+","-",sys.argv[1].lower()).strip("-"))' "$NAME")
render "winner-$KIND-$PERIOD-$slug.png" "$q"
