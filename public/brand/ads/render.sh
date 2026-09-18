#!/usr/bin/env bash
# Render the four brand ads at feed (1080x1350) and story (1080x1920).
#
#   ./render.sh                 -> 8 PNGs into this folder
#   PRICE='$149' ./render.sh    -> pack ads with a real price
#
# Serves public/brand over http so Google Fonts and the ../lockups SVGs resolve.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8773
PRICE="${PRICE:-}"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6

q=""
[ -n "$PRICE" ] && q="&price=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$PRICE")"

for ad in join submit watch pack; do
  for f in feed story; do
    size=1080,1350; [ "$f" = story ] && size=1080,1920
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size="$size" --virtual-time-budget=20000 \
      --screenshot="$DIR/ad-$ad-$f.png" \
      "http://127.0.0.1:$PORT/ads/ad.html?ad=$ad&f=$f$q" >/dev/null 2>&1
    echo "ad-$ad-$f.png"
  done
done
