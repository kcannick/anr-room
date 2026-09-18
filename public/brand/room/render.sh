#!/usr/bin/env bash
# Render the A&R Room key art, or one week's post.
#
#   ./render.sh                                  -> key art: room-keyart-{wide,story,square,yt}.png
#   ./render.sh 2026-09-17                       -> this week: room-2026-09-17-{feed,story,yt,wide}.png
#   ./render.sh 2026-09-17 "Guest Name"          -> with a guest reviewer line
#   TIME='8PM ET' ./render.sh 2026-09-17         -> a different start time
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8775
DATE="${1:-}"; GUEST="${2:-}"; TIME="${TIME:-}"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6

enc () { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
q=""
[ -n "$DATE" ]  && q="$q&date=$DATE"
[ -n "$GUEST" ] && q="$q&guest=$(enc "$GUEST")"
[ -n "$TIME" ]  && q="$q&time=$(enc "$TIME")"

render () {  # $1 format  $2 WxH  $3 outfile
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2" --virtual-time-budget=20000 --screenshot="$DIR/$3" \
    "http://127.0.0.1:$PORT/room/room.html?f=$1$q" >/dev/null 2>&1
  echo "$3"
}

if [ "$DATE" = brb ] || [ "$DATE" = end ]; then      # ./render.sh brb | end  -> the stream screens (2.7)
  q="&screen=$DATE"
  render wide  1920,1080 "room-screen-$DATE-wide.png"
  render story 1080,1920 "room-screen-$DATE-story.png"
elif [ -z "$DATE" ]; then
  render wide   1920,1080 room-keyart-wide.png
  render story  1080,1920 room-keyart-story.png
  render square 1080,1080 room-keyart-square.png
  render yt     1280,720  room-keyart-yt.png
else
  render feed   1080,1350 "room-$DATE-feed.png"
  render story  1080,1920 "room-$DATE-story.png"
  render yt     1280,720  "room-$DATE-yt.png"
  render wide   1920,1080 "room-$DATE-wide.png"
fi
