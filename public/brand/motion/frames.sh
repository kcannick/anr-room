#!/usr/bin/env bash
# Render the motion pieces: frames from motion.html via headless Chrome, encoded with ffmpeg.
#
#   ./frames.sh                 -> every piece at 30fps
#   ./frames.sh bumper wide     -> one piece, one format
#   FPS=15 ./frames.sh          -> a quick draft
#
# Output, in this folder:
#   bumper-{wide,story}.mov   ProRes 4444 with alpha (drop it on the timeline, transparent)
#   bumper-{wide,story}.webm  VP9 with alpha (OBS / browser)
#   open-{wide,story}.mp4, close-{wide,story}.mp4, teaser-story.mp4   H.264
#   starting-{wide,story}.mp4  25s seamless loop for OBS (Media Source, Loop on)
#   starting-{wide,story}-guide.png  the countdown zone drawn on, with sample numerals
#   <piece>-<f>-poster.png    a still from the hold, for the review sheet
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8780
FPS="${FPS:-30}"
JOBS="${JOBS:-6}"
ONLY_PIECE="${1:-}"; ONLY_F="${2:-}"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR/.." >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.6

dur () { case "$1" in bumper) echo 3;; open|close) echo 6;; teaser) echo 15;; starting) echo 25;; esac; }
size () { [ "$1" = wide ] && echo 1920,1080 || echo 1080,1920; }
poster_t () { case "$1" in bumper) echo 1.8;; open) echo 4.8;; close) echo 4.0;; teaser) echo 14.5;; starting) echo 2.5;; esac; }

render_piece () {
  local piece="$1" f="$2" d n fr bg
  d=$(dur "$piece"); n=$((d * FPS)); fr="$DIR/frames/$piece-$f"
  rm -rf "$fr"; mkdir -p "$fr"
  bg=""; [ "$piece" = bumper ] && bg="--default-background-color=00000000"
  echo "rendering $piece/$f: $n frames at ${FPS}fps"
  # One Chrome per frame, several at a time (frame.sh); each gets its own profile.
  seq 0 $((n - 1)) | PIECE="$piece" F="$f" FPS="$FPS" PORT="$PORT" OUTDIR="$fr" BG="$bg" xargs -P "$JOBS" -n 1 "$DIR/frame.sh"
  if [ "$piece" = bumper ]; then
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$fr/%04d.png" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "$DIR/$piece-$f.mov"
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$fr/%04d.png" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 2M -auto-alt-ref 0 "$DIR/$piece-$f.webm"
  else
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$fr/%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "$DIR/$piece-$f.mp4"
  fi
  local pt; pt=$(poster_t "$piece")
  cp "$fr/$(printf %04d "$(python3 -c "print(int($pt*$FPS))")").png" "$DIR/$piece-$f-poster.png"
  if [ "$piece" = starting ]; then   # the guide still: the countdown zone outlined, sample numerals in it
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$(size "$f")" \
      --virtual-time-budget=6000 --screenshot="$DIR/$piece-$f-guide.png" \
      "http://127.0.0.1:$PORT/motion/motion.html?piece=starting&f=$f&t=$pt&guide=1" >/dev/null 2>&1
  fi
  echo "  -> $piece-$f"
}

for spec in "bumper wide" "bumper story" "open wide" "open story" "close wide" "close story" "teaser story" "starting wide" "starting story"; do
  set -- $spec
  [ -n "$ONLY_PIECE" ] && [ "$1" != "$ONLY_PIECE" ] && continue
  [ -n "$ONLY_F" ] && [ "$2" != "$ONLY_F" ] && continue
  render_piece "$1" "$2"
done
