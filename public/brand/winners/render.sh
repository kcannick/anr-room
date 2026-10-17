#!/usr/bin/env bash
# Render the winner posts (4.15), 1080x1350 portrait, for Instagram collab posts.
#
#   ./render.sh                                  -> the four sample posts + two variants
#   ./render.sh track day|week "Artist" "Song" ig [rated]
#   ./render.sh ar day|week "A&R Name" [pts] [photo-url]
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
  render winner-track-week.png  "kind=track&period=week"
  render winner-ar-week.png     "kind=ar&period=week&pts=1840"
  render winner-track-week-long.png   "kind=track&period=week&song=A%20Much%20Longer%20Song%20Title%20Here&name=A%20Much%20Longer%20Artist%20Name"
  render winner-ar-week-long.png      "kind=ar&period=week&name=A%20Much%20Longer%20A%26R%20Name"
  render winner-ar-week-nophoto.png   "kind=ar&period=week&photo=&name=A%20Much%20Longer%20Name"
  exit 0
fi
KIND="$1"; PERIOD="$2"; NAME="$3"
if [ "$KIND" = track ]; then
  q="kind=track&period=$PERIOD&name=$(enc "$NAME")&song=$(enc "${4:-}")&ig=$(enc "${5:-}")&rated=${6:-}"
else
  q="kind=ar&period=$PERIOD&name=$(enc "$NAME")&pts=${4:-}&photo=$(enc "${5:-}")"
fi
slug=$(python3 -c 'import sys,re;print(re.sub(r"[^a-z0-9]+","-",sys.argv[1].lower()).strip("-"))' "$NAME")
render "winner-$KIND-$PERIOD-$slug.png" "$q"
