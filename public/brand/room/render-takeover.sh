#!/usr/bin/env bash
# Render an A&R Room Takeover post.
#   ./render-takeover.sh 2026-10-21 "Huncho Miles" huncho._miles999 [takeover/photo.jpg] [outdir]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8776
DATE="$1"; NAME="$2"; HANDLE="$3"; PHOTO="${4:-takeover/huncho-miles.jpg}"; OUT="${5:-$DIR/takeover}"
TIME="${TIME:-}"; POS="${POS:-}"; TAG="${TAG:-}"
mkdir -p "$OUT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null || true' EXIT; sleep 0.6
enc () { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
slug=$(echo "$NAME" | tr 'A-Z ' 'a-z-')
q="&date=$DATE&name=$(enc "$NAME")&handle=$(enc "$HANDLE")&photo=$(enc "$PHOTO")"
[ -n "$TIME" ] && q="$q&time=$(enc "$TIME")"
[ -n "$POS" ]  && q="$q&pos=$(enc "$POS")"
render () {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2" --virtual-time-budget=20000 --screenshot="$OUT/$3" \
    "http://127.0.0.1:$PORT/room/takeover.html?f=$1$q" >/dev/null 2>&1
  echo "$OUT/$3"
}
render feed  1080,1350 "takeover-$slug$TAG-$DATE-feed.png"
render story 1080,1920 "takeover-$slug$TAG-$DATE-story.png"
render wide  1920,1080 "takeover-$slug$TAG-$DATE-wide.png"
render yt    1280,720  "takeover-$slug$TAG-$DATE-yt.png"
render header 1080,405 "takeover-$slug$TAG-$DATE-header.png"
