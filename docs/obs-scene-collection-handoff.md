# OBS scene collection handoff: The A&R Team

Written 2026-11-10 for the session on the MSI PC that builds the OBS scene collection.
Source of the facts below: the exported collection `The_AR_Team.json`, four stream
screenshots, and the operator's decisions in the A&R app session the same day.

The collection is ONE collection drawing from TWO platforms:

- **The A&R game**: `anr.makinitmag.com` (browser sources, keyed by the Stream Deck control key).
- **Live Feedback Requests**: `www.makinitmag.com/manage/live-feedback?dock=1`, with its
  overlays served from the PC (`http://localhost:8787/overlay.html`) and the fire meter
  from `G:/Shared drives/Streaming/Review Music/overlays/`.

Nothing in this file changes the A&R app. It says how the scenes should be built so both
platforms share them without covering each other.

## 1. The model: two main scenes

| | Scene 1: Facecam large | Scene 2: Facecam small + video large |
|---|---|---|
| Used for | A&R Room (the daily game) AND Live Feedback | Live Feedback ONLY |
| Primary 16:9 | Facecam (also Credits, BRB) | Music video / screen share |
| Secondary 16:9 | none | Facecam |
| A&R game visible | Yes, while the operator plays it | **Never** |

Today's collection has this as three scenes: `3 · Live Feedback` and `5 · Just Me` are
both "Facecam large" (the camera sits at the identical position and size in each), and
`4 · Video + Cam` is "Facecam small + video large". Merging 3 and 5 into one scene is
the operator's direction; keeping them separate also works, since the geometry is the same.

## 2. Mandatory stream elements (never covered by anything)

1. **Header**: titling and livestream number (with the viewer count beside it).
2. **Submit Music call to action**: `makinitmag.com/playme`. The primary CTA.
3. **Primary 16:9**: facecam, music video, credits, BRB animation.
4. **Secondary 16:9**: the facecam when something else is in the primary (Scene 2).

Not mandatory: the QR card under the camera (about ten real scans in total). Its slot is
given to the A&R game on Scene 1. The fire meter, ticker and chat dock are not on the
mandatory list but nothing from the A&R game is drawn over them either.

## 3. Geometry (canvas 1080 × 1920)

From the collection file; the last three rows are measured off screenshots, so treat
them as approximate.

| Element | Position (x, y) | Size | Notes |
|---|---|---|---|
| Canvas | | 1080 × 1920 | vertical only |
| `0b · CAM` nested scene | | 1920 × 1080 | custom size; facecam + guests + credits |
| Primary 16:9 window | 90, 370 | 900 × 506 | CAM on Scene 1; Monitor 2 on Scene 2 |
| Secondary 16:9 (Scene 2) | 90, 896 | 326 × 184 | CAM |
| Fire meter strip | 90, 766 | 900 × 110 | along the bottom of the primary window |
| Chat dock | 90, 1380 | 900 × 500 (bounds) | Social Stream Ninja |
| Slot under the primary (QR card) | 90, ~898 | 900 × ~180 | drawn by the frame page |
| Submit Music CTA | 90, ~1095 | 900 × ~150 | drawn by the frame page |
| Ticker | 90, ~1266 | 900 × ~70 | drawn by the frame page |

## 4. The A&R game sources

Two browser sources. Replace `<CONTROL KEY>` with the Stream Deck control key (the app's
console lists both full URLs under Stream Deck / external control). Never paste the key
into a file that is shared.

### 4a. `ANR - Song Info` (the "now rating" strip)

- URL: `https://anr.makinitmag.com/overlay/daily?view=record&k=<CONTROL KEY>`
- Size: **1920 × 1080**, transparent.
- Where: **inside the `0b · CAM` nested scene**, position 0,0, above the facecam and the
  guests, below Credits.
- Draws: a strip across the top of the camera with the title, artist and Instagram handle
  of the record being rated. Blank unless the operator has ticked **Record on stream** on
  the daily page on his phone.
- **Fix needed: the source is hidden (eye off) in the current collection. Turn it on.**
- Coming in the next app build, no OBS change needed: Rating and Prediction tiles on the
  right of the strip, and a green "Prediction locked in" bar.

### 4b. `A&R Daily Overlay` (the reveal)

- URL today: `https://anr.makinitmag.com/overlay/daily?k=<CONTROL KEY>`
- URL to set now, ready for the next app build:
  `https://anr.makinitmag.com/overlay/daily?layout=row&k=<CONTROL KEY>`
  (`layout=row` is ignored by the current build, so it is safe to set today.)
- Size: **1080 × 1920**, transparent, with its own sound (the page makes it; no audio
  source is needed, but the browser source must have audio enabled / monitored to the stream).
- Position: **0, 0**. **Fix needed: it is at 40, 0 today**, which pushes its card against
  the right edge of the canvas.
- Where: **Scene 1 (Facecam large) only**, above the frame page, below the fire meter
  heat layer and the chat overlays.
- **Fix needed: remove it from the nested `0 · SSN Overlay` scene.** That nested scene is
  in every scene, so today the reveal also sits on Scene 2 (where the game must never
  show) and is stacked twice on scenes 2 and 5.
- Draws today: a tall card (y 250–1400) that covers the header's viewer count, the camera,
  the QR card, the CTA and the ticker. That is the problem being fixed.
- Draws after the next app build, with `layout=row`: one row in the QR card's slot
  (x 90–990, y ~898–1078): a short "checking" beat, the average counting up, the tier
  call (Bullseye, Sharp, Close, Off, Way off) with its sound, points and grade. About
  eight seconds, then it drops away and the QR card is visible again. The Track Report
  pager and the day total still use the full-height card when the operator opens them.

## 5. Layer order for Scene 1 (bottom to top)

1. Background (`BG · A&R Team`)
2. `0b · CAM` at 90, 370, bounds 900 × 506 (contains `ANR - Song Info`)
3. Frame page (header, QR card, Submit Music CTA, ticker)
4. Fire meter strip at 90, 766
5. Live Feedback Now Playing card (only one of 5 and 6 is ever drawing)
6. `A&R Daily Overlay` at 0, 0
7. `0 · SSN Overlay (nested)`: chat dock, featured chat, viewers, reactions, LF Alerts
8. Fire meter heat

Audio: `Rodecaster` as today. No phone capture: the operator no longer streams the phone
(it was heavy, the audio was poor and the screen was small). `2 · A&R Meeting`, with its
Phone Screen window capture and Phone Audio source, can be retired.

## 6. How the two platforms stay apart

- The A&R sources draw only while **Record on stream** is ticked on the operator's phone.
  Unticked, both are blank and Scene 1 is entirely Live Feedback.
- The Live Feedback Now Playing cards belong to Live Feedback segments. On Scene 2 they
  are the only song info, and no A&R source is present.
- Open question, not yet answered: `LF Alerts (paid submissions)` lives in the shared SSN
  overlay scene, so a paid-submission alert can fire on Scene 1 during an A&R reveal.
  Where that alert lands on screen decides whether the reveal row must wait or move. If
  the alert uses the slot under the camera or the top of the camera, tell the A&R app
  session; a paying customer's alert must never be covered.

## 7. Checklist for the PC build

- [ ] Scene 1 "Facecam large" exists (merge `3 · Live Feedback` and `5 · Just Me`, or keep
      both with identical layout).
- [ ] Scene 2 "Facecam small + video large" has no A&R source, directly or through a
      nested scene.
- [ ] `ANR - Song Info` is visible inside `0b · CAM`, 1920 × 1080 at 0, 0.
- [ ] `A&R Daily Overlay` is in Scene 1 only, at 0, 0, URL carries `layout=row`.
- [ ] `A&R Daily Overlay` is removed from `0 · SSN Overlay (nested)`, and there is one
      copy in Scene 1, not two.
- [ ] The overlay's audio reaches the stream.
- [ ] Header, Submit Music CTA, primary and secondary 16:9 are not covered in any state.
- [ ] `2 · A&R Meeting` and the phone capture sources are retired, if the operator agrees.

## 8. What the A&R app session still owes

Not built yet, waiting on the operator's go-ahead. None of it needs another OBS change
if the checklist above is done:

- Rating and Prediction tiles and the "Prediction locked in" bar on the strip.
- The `layout=row` reveal with the processing beat and tier sounds.
- Faster polling on the strip so the prediction follows the slider live.

Mockup of the finished look, drawn over a real screenshot of Scene 1:
`public/_mock-daily-live-sequence.html` in the `kcannick/anr-room` repo.
