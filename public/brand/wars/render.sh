#!/usr/bin/env bash
# Render the A&R Wars promo set at native size with headless Chrome.
#   ./render.sh                              -> every piece at every state into preview/, plus the 180px thumbnail check
#   ./render.sh <piece> <query> <suffix>     -> one PNG, e.g. ./render.sh thumb "filled=3" filled3
# Pieces: flyer-feed (1080x1350) · flyer-story (1080x1920) · thumb (1920x1080) — weekly seat flyers,
#         states filled=1..8 · stage=final · stage=champion
#         bracket (1080x1350) — event night, states stage=field|final4|final2|champion
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT="${PORT:-8793}"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6
size () { case "$1" in flyer-feed|bracket) echo 1080,1350;; flyer-story) echo 1080,1920;; thumb) echo 1920,1080;; esac; }
render () {
  local out="$DIR/preview/$1-$3.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$(size "$1")" --virtual-time-budget=30000 --screenshot="$out" \
    "http://127.0.0.1:$PORT/wars/$1.html?$2" >/dev/null 2>&1
  echo "preview/$1-$3.png"
}
mkdir -p "$DIR/preview"
if [ $# -eq 3 ]; then render "$1" "$2" "$3"; exit 0; fi
rm -f "$DIR"/preview/flyer-*.png "$DIR"/preview/thumb-*.png "$DIR"/preview/bracket-*.png
for piece in flyer-feed flyer-story thumb; do
  for n in 1 4 8; do render "$piece" "filled=$n" "filled$n"; done
  render "$piece" "stage=final" final
  render "$piece" "stage=champion" champion
done
for stage in field final4 final2 champion; do render bracket "stage=$stage" "$stage"; done
# The thumbnail at 180px wide (what a sidebar shows), blown back up nearest-neighbour so the loss is honest.
for s in filled4 final champion; do
  ffmpeg -y -loglevel error -i "$DIR/preview/thumb-$s.png" -vf "scale=180:-1" "$DIR/preview/thumb-$s-180.png"
  ffmpeg -y -loglevel error -i "$DIR/preview/thumb-$s-180.png" -vf "scale=1440:-1:flags=neighbor" "$DIR/preview/thumb-$s-180-x8.png"
  echo "preview/thumb-$s-180.png"
done
