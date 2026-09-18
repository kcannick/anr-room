#!/usr/bin/env bash
# One frame of one motion piece. Called by frames.sh through xargs, several at a time.
# No --user-data-dir: a fresh profile makes headless Chrome hang on this Mac; plain launches
# run side by side without it. Even so, one launch in ~1,000 hangs forever (2026-09-14: frame
# 332 of a 600-frame render sat 15 minutes), so each attempt is killed at 60s and retried.
#   frame.sh <index>    with PIECE, F, FPS, PORT, OUTDIR, BG in the environment
set -euo pipefail
i="$1"
t=$(python3 -c "print($i/$FPS)")
size=1920,1080; [ "$F" = story ] && size=1080,1920
out="$OUTDIR/$(printf %04d "$i").png"
for attempt in 1 2 3; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 $BG --window-size="$size" --virtual-time-budget=6000 \
    --screenshot="$out" \
    "http://127.0.0.1:$PORT/motion/motion.html?piece=$PIECE&f=$F&t=$t" >/dev/null 2>&1 &
  pid=$!
  for _ in $(seq 1 120); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; echo "frame $i: hung, retry $attempt" >&2; continue; fi
  wait "$pid" 2>/dev/null || true
  [ -s "$out" ] && exit 0
done
echo "frame $i: FAILED after 3 attempts" >&2; exit 1
