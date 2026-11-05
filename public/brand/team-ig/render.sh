#!/usr/bin/env bash
# Render the @TheAnRTeam Instagram starter kit (MOCKUP).
#   ./render.sh                 -> every piece + the review-only guide variants
#   ./render.sh <piece>         -> one piece, e.g. ./render.sh numbers-2
#
# Serves public/brand over http so Google Fonts and the ../mark, ../lockups, ../assets files resolve.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8787

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
PROFILE="$(mktemp -d)"   # a throwaway profile: headless Chrome writes nothing while the desktop Chrome holds the default one
trap 'kill $SRV 2>/dev/null || true; rm -rf "$PROFILE"' EXIT
sleep 0.6

size () {
  case "$1" in
    avatar) echo 1080,1080 ;;
    hl-*|story-*) echo 1080,1920 ;;
    *) echo 1080,1350 ;;
  esac
}
render () {   # render <piece> <outfile> [extra query]
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --user-data-dir="$PROFILE" \
    --window-size="$(size "$1")" --virtual-time-budget=20000 \
    --screenshot="$DIR/$2" \
    "http://127.0.0.1:$PORT/team-ig/team-ig.html?p=$1${3:-}" >/dev/null 2>&1
  echo "$2"
}

PIECES="avatar hl-how hl-join hl-submit hl-hot100 hl-results hl-winners
        intro how-1 how-2 how-3 how-4 numbers-1 numbers-2 numbers-3 artists schedule join
        story-open story-join story-results"

if [ $# -gt 0 ]; then render "$1" "$1.png"; exit 0; fi

mkdir -p "$DIR/guides"
for p in $PIECES; do render "$p" "$p.png"; done
# review-only: circle crop, grid crop, story safe zones + link-sticker box. Never post these.
for p in avatar hl-how intro story-open story-join story-results; do render "$p" "guides/$p-guides.png" "&guides=1"; done
# review-only small-size tests (macOS sips): the avatar at 32px, grid tiles at 60px wide
sips --resampleWidth 32 "$DIR/avatar.png" --out "$DIR/guides/avatar-32.png" >/dev/null
for p in intro how-1 join numbers-1 artists schedule; do sips --resampleWidth 60 "$DIR/$p.png" --out "$DIR/guides/$p-60.png" >/dev/null; done
echo "guides/*-32.png, guides/*-60.png"
