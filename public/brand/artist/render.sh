#!/usr/bin/env bash
# Render one artist's share graphics.
#
#   ./render.sh pack "Artist Name" "Song Title"                           -> feed + story
#   ./render.sh meeting "Artist Name" "Song Title" instagramhandle       -> feed + story
#   LINK=makinitmag.com/other ./render.sh pack ...                       -> a different link line
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8776
P="${1:-pack}"; ARTIST="${2:-Artist Name}"; SONG="${3:-Song Title}"; A4="${4:-}"; A5="${5:-}"; LINK="${LINK:-}"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6

enc () { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
slug=$(python3 -c 'import sys,re;print(re.sub(r"[^a-z0-9]+","-",sys.argv[1].lower()).strip("-"))' "$ARTIST")
q="p=$P&artist=$(enc "$ARTIST")&song=$(enc "$SONG")"
if [ "$P" = meeting ] && [ -n "$A4" ]; then q="$q&ig=$(enc "$A4")"; fi
[ -n "$LINK" ] && q="$q&link=$(enc "$LINK")"

render () {  # $1 format  $2 WxH
  out="$DIR/artist-$P-$slug-$1.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2" --virtual-time-budget=20000 --screenshot="$out" \
    "http://127.0.0.1:$PORT/artist/artist.html?$q&f=$1" >/dev/null 2>&1
  echo "$(basename "$out")"
}
# Both graphics ship portrait (1080x1350) + story (1080x1920). (operator, 2026-09-13: not square)
render feed  1080,1350
render story 1080,1920
