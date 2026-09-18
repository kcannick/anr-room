#!/usr/bin/env bash
# Render the four link-preview images (1200x630) into this folder.
#   ./render.sh   -> og-team.png og-room.png og-meeting.png og-pack.png
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8774
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
for p in team room meeting pack; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=20000 \
    --screenshot="$DIR/og-$p.png" "http://127.0.0.1:$PORT/og/og.html?p=$p" >/dev/null 2>&1
  echo "og-$p.png"
done
