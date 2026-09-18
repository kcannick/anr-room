#!/usr/bin/env bash
# Render the two results carousels (3 slides each, 1080x1350).
#   ./render.sh                -> sample data, date 2026-09-12
#   ./render.sh 2026-09-15     -> another date (sample data)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8778
DATE="${1:-2026-09-12}"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
for set in song ar; do
  for n in 1 2 3; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size=1080,1350 --virtual-time-budget=20000 \
      --screenshot="$DIR/results-$set-$DATE-$n.png" \
      "http://127.0.0.1:$PORT/daily/carousel.html?set=$set&slide=$n&date=$DATE" >/dev/null 2>&1
    echo "results-$set-$DATE-$n.png"
  done
done
