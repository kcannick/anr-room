# The A&R Room — Copy Inventory

Every user-facing string in the app, grouped by surface, so you can revise the voice/wording in one pass.

**How to use this:** edit the copy inline here (or in a copy of it) and hand it back, or just tell me the changes and I'll apply them to the code. `[bracketed]` bits are dynamic values filled at runtime. Strings marked _(dynamic)_ are set by JavaScript for a specific state.

Surfaces: [Homepage](#1-homepage) · [Play / Voting page](#2-play--voting-page) · [Join the A&R Team / Profile](#3-join-the-ar-team--profile) · [Emails & Notifications](#4-emails--notifications) · [Stream Overlay](#5-stream-overlay) · [Admin / Host Console](#6-admin--host-console) · [System & Error Messages](#7-system--error-messages)

---

## 1. Homepage
*(public landing page — the marketing surface)*

**Tab / nav / footer**
- Browser tab title — "The A&R Room · Got an ear for music?"
- Brand name — "The A&R Room"
- Nav links — "Leaderboard" · "Winners" · "Join" (becomes "My Profile" when logged in)
- Loading placeholder — "Loading…"
- Footer — "Makin' It Magazine · The A&R Room"

**Between-sessions hero**
- Prize pill — "💰 $500 monthly cash prize"
- Heading — "Got an ear for music?"
- Paragraph — "Rate songs, read the room, climb the leaderboard. Top A&Rs compete in A&R Wars for the cash."
- CTAs (with an upcoming session) — "Register to play" · "Join the A&R Team"
- CTAs (no session) — "Join the A&R Team" · "See how it works"

**How it works**
- "Rate the song" · "Predict the room" · "Climb & qualify"

**Next session card**
- Heading — "Next session"
- Empty state — "No session scheduled yet — check back soon."
- Button — "Register"
- Submit link — "🎤 Know an artist? Submit music for this session ↗"
- Date fallbacks — "TBA" · "Date to be announced · 6 platforms" · "[time] ET · 6 platforms"

**Series leaderboard**
- Heading (between) — "Series leaderboard · [series title]"
- Heading (live) — "Live standings · updating"
- Empty state — "No standings yet — they fill in as A&Rs rate songs in tagged sessions."

**Past winners** — heading "Past winners"

**New A&Rs ticker** — heading "New A&Rs"

**Submit-music section**
- Title — "Know an artist we need to hear?"
- Subtitle — "Send them here to submit — the room reviews new music live, so a real audience gives it real ears."
- Buttons — "Have them submit" · "Share link" (copied state: "Link copied ✓")
- Share sheet title — "Submit your music — The A&R Room"
- Clipboard fallback — "Copy this submit link:"

**Live state (a session is on air)**
- Banner title — "Live right now!"
- Banner subtitle — "[now playing / count] A&Rs in the room"
- Banner button / hero CTA — "Get in to vote"
- Stream tag — "● LIVE" · brand "The A&R Room" · "Watch on YouTube ↗"
- Hero paragraph — "Watching on another screen? Jump in here and vote — rate the current song and read the room."

**Error state** — "Couldn't load right now. Refresh to try again."

---

## 2. Play / Voting page
*(what players see: register → wait → vote → results → recap)*

**Header (persistent)**
- App title — "The A&R Room" · Beta pill — "BETA"
- Feedback button — "💬 Feedback" (title "Send feedback")
- Mute button — title "Sound on/off"

**Live stream bar** — "Live stream" · poster caption "Tap to watch the stream"

**Account register (logged-in one-tap)**
- Eyebrow — "Register as an A&R" / _(live)_ "Join this session"
- Heading — "This session"
- Sub (default) — "Tap Complete to register as an A&R for this session."
- Sub _(live)_ — "Tap Enter to join as an A&R and jump into the room."
- Sub _(not live)_ — "Tap Complete to register as an A&R for this session. You'll get a notification when it opens."
- Buttons — "Complete registration" / _(live)_ "Enter the room" · "Cancel"

**Step 1 — Email**
- Eyebrow — "Step 1" · Heading — "Take your seat"
- Sub — "Enter your email and we'll send a six-digit code to confirm it's you."
- Label — "Email" · placeholder "you@email.com"
- Button — "Send my code" · error "Enter your email"

**Step 2 — Code + name + phone**
- Eyebrow — "Step 2" · Heading — "Enter the code"
- Sub — "Code sent to [email]. Check your email — if you don't see it, look in your Spam or Promotions tab."
- Code placeholder — "••••••"
- Name label — "Your name (shown on the leaderboard)" · placeholder "e.g. Maya"
- Phone label — "Mobile number (optional)" · placeholder "(555) 123-4567" / _(on file)_ "[hint] (on file — tap to change)"
- Phone consent — "By entering your number you agree to get texts when this room goes live and about future A&R Room events. Message & data rates may apply; reply STOP to opt out. Optional — not required to play."
- Button — "Enter the room" · back "Use a different email"
- Errors — "Enter the code" · "Enter your name"

**Waiting / lobby**
- Eyebrow — "You're in" · Heading — "Hey [name]" (fallback "Welcome" / "Hey there")
- Sub (default) — "Hang tight — the next song is being cued up."
- Sub _(upcoming)_ — "You're registered! Voting hasn't started yet — keep this page handy and you'll be ready the moment it goes live."
- Sub _(scheduled)_ — "Registered! Voting starts in:" / "Registered — starting shortly. Keep this page open."
- Buttons — "▶ Watch the stream" · "＋ Invite others" / _(with referrals)_ "＋ Invite — you've brought [count]" (copied: "Link copied!")
- Countdown labels — "days" · "hours" · "mins" · "secs" / "Starting shortly…"
- Count tag — "🎧 [count] A&Rs in the room"

**$500 giveaway hook (lobby)**
- "🏆 Playing for $500 this month"
- Empty board — "Be the first to put points on the board."
- Footer — "Top A&Rs on the monthly board win. Rate songs, read the room, climb."

**Liveness feed (lobby)**
- Header — "In the room"
- Items — "[name] just joined" / "someone joined"
- Seal — "🔒 Count only — the room's lean stays sealed until results. It's what you're predicting."

**Voting screen (shared)**
- Eyebrow — "Now playing · Round [n]" · Timer label "LEFT"
- Round giveaway — "🎁 Win: [giveaway]"

**Rating flow**
- Step 1 — "① Rate" · help "Your rating — how good is it? (0 = worst · 9 = best)" · "Next →"
- Step 2 — "② Read the Room!" · help "Predict what you think the room's average rating will be." · ends "0.0 nobody likes it" / "everybody loves it 9.0" · "Lock it in" · "← Back"

**Versus (binary) flow**
- Step 1 — "① Pick a side" · help "Which one are you riding with?" · "Next →"
- Step 2 — "② Read the Room!" · help "Predict how the room will split between the two." · ends "all A" / "all B" · "Lock it in" · "← Back"
- Vote errors — "Pick a rating first" · "Set your prediction" · "Pick a side first" · "Set your split prediction"

**Locked screen**
- "🔒 Locked in" · sub "Waiting for the room to finish voting…" / _(tallying)_ "Votes are in — the host is tallying the room…"
- Cells — "Your rating" · "Your guess" · "Your pick" · "Your split"

**Results screen**
- Reaction (bullseye) — 🎯 "Bullseye!" · "You nailed the room. +25 bonus."
- Reaction (sharp) — 🔥 "Sharp read" · "You really know this room."
- Reaction (close) — 👌 "Nice — close" · "You read the room well."
- Reaction (off) — 😬 "Off the mark" · "The room saw it differently."
- Reaction (way off) — 💀 "Way off" · "Ouch — that one cost you."
- Eyebrow — "Round [n] · Results"
- Winner — 👑 "Round winner" / _(no votes)_ "No votes this round"
- Cells — "Your guess" / _(binary)_ "Your call" · "Points this round" · "Your rank #[n] of [total]" / "(you sat this one out)" · "Total"
- Seal — "🔒 The room's score stays sealed until the end. Stay in for the full reveal."

**Recap (session ended)**
- Eyebrow — "The A&R Room · Session recap"
- Heading — "[name]'s card" (fallback "Your card") ⚠️ _bug: renders "You's card" when no name_
- Grade label — "Ear for the room"
- Cells — "Total points" · "Room rank" · "Bullseyes" · "Top %"
- Reveal labels — "The room's overall average" / _(binary)_ "Room leaned (Song A share)" · "Your average read, off by" · "Your best round"
- Buttons — "Share my card" (building: "Building your card…", saved: "Saved image ✓") · "Top 8 A&Rs" · "Top 8 Songs"
- Footer — "Thanks for sitting in. 🎧"

**Footer (persistent)** — "🎧 [count] playing" · "[n] pts"

**How-to-play modal (first-run)**
- Eyebrow — "New here? How to play"
- Title — "Read the room, win the month" / _(binary)_ "Pick a side, read the room"
- Step 1 (rating) — "Rate the song 0–9" · "How good is it? 0 = worst, 9 = best."
- Step 1 (binary) — "Pick your side" · "Two songs go head-to-head — choose the one you're riding with."
- Step 2 (rating) — "Read the Room" · "Predict the room's average rating. Points come from how close you are — not just what you like."
- Step 2 (binary) — "Read the Room" · "Predict how the whole room will split between them. Points come from how well you read it — not just who you picked."
- Step 3 (giveaway) — "Climb for the $500" · "Top A&Rs on this month's leaderboard win $500 cash. Every round you play adds up."
- Step 3 (no giveaway) — "Climb the leaderboard" · "Rack up points across the month's sessions and rise up the board."
- Button — "Got it — let's play"

**Broadcast modal** — 📣 "From the host" · "Got it"

**Feedback modal**
- Heading — "Tell us how it's going"
- Intro — "This is a beta version of the app. If you run into any bugs or difficulty using it, let us know so we can make it better for you. Attaching a screenshot is optional."
- Labels — "Your feedback" (placeholder "What happened? What were you trying to do?") · "Email (optional — if you'd like a reply)"
- Attach — "📎 Attach a screenshot (optional)" / "✓ Screenshot attached — tap to change"
- Buttons — "Send feedback" (sending "Sending…") · "Cancel"
- Errors — "Please choose an image file." · "Could not read that image." · "Please enter a message." · "Could not send. Please try again."
- Success — "Thanks for the feedback 🙌"

**Check-in modal (geofenced)**
- 📍 "Check in to vote" · title "Are you in the room?" / _(required)_ "Check in at the event"
- Body (default) — "Share your location so we know if you're at the event or watching remotely. We use it once to check you in — we don't track or store where you are."
- Body (required) — "This is an in-room event — share your location to confirm you're here. We use it once to check you in and don't store where you are."
- Buttons — "📍 Check me in" · "I'm watching remotely" · "Cancel"
- Errors — "Getting your location…" · "Your device can't share location. Try the remote option." · "We need location access to check you in at this event. Enable it in your browser and try again." · "Couldn't get your location. You can join as remote instead." · "Check-in failed. Try again."

**Profile completion modal (on the play page)**
- Eyebrow — "Round closed · results soon"
- Heading — "Complete your profile to qualify"
- Intro — "You're scoring — but you won't appear on the leaderboard or qualify for prizes until your profile's done."
- Buttons — "Save & qualify" · "Later"
- (Field labels/errors mirror the Join page below.)

**Share graphic (client-rendered card)** — "THE A&R ROOM" · "TOTAL POINTS" · "EAR FOR THE ROOM" · footer "Read the room. anr.makinitmag.com"

**Share / invite text (native share sheet)**
- Invite — "Come play The A&R Room with me 🎧 Rate the drops, read the room, climb the board."
- Card share (rating) — "The A&R Room — my card / Grade: [grade] · [pts] pts / Rank #[rank] of [n] · [n] bullseye(s) / Room average revealed: [avg]"

---

## 3. Join the A&R Team / Profile
*(team signup + self-serve profile edit)*

**Step 1 — Email**
- Eyebrow — "Join the A&R Team" · Heading — "Take your seat"
- Intro — "No session needed — join the team, build your profile, and you're ready the moment the next session goes live."
- Label "Email" (placeholder "you@email.com") · button "Send my code" · error "Enter a valid email"

**Step 2 — Confirm**
- Heading — "Confirm it's you" / _(returning)_ "Welcome back"
- Sent line — "Code sent to [email]."
- Labels — "6-digit code" (placeholder "••••••") · "Display name" + "required" (placeholder "e.g. DJ Chain") · "Mobile" + "(optional)" (placeholder "(555) 123-4567")
- Mobile hint — "We'll text you when a session goes live + about A&R Room events. Msg & data rates may apply; reply STOP to opt out. Optional."
- Button — "Join the team →" / _(returning)_ "Continue →" · back "Use a different email"
- Errors — "Enter the code" · "Add a display name"

**Step 3 — Profile**
- Eyebrow — "Step 2 of 2 · finish to get listed" / _(edit)_ "Your A&R profile"
- Heading — "Complete your profile" / _(edit)_ "Edit your profile"
- Subhead — "This is what puts you on the leaderboard and the New A&Rs ticker." / _(edit)_ "Update your skills, location, socials, or photo. View public profile ↗"
- "① What do you do?" + "select all that apply"
- "② Most focused on?" + "your primary" (empty: "Pick categories above first")
- Labels — "Location" + "required to qualify" (placeholder "Start typing your city…") · "Instagram" (placeholder "@handle") · "TikTok" (placeholder "@handle")
- Photo — "Add a photo" / "Photo added ✓" · "tap to upload & crop"
- Buttons — "Finish & get listed" / _(edit)_ "Save changes" · "I'll finish later" / _(edit)_ "Cancel"
- Errors — "Pick at least one category." · "Add your location to get listed."

**Step 4 — Done**
- ✓ "You're on the team!" · "You'll appear in New A&Rs and we'll let you know the moment the next session goes live."
- _(skipped profile)_ "Welcome to the team!" · "Your account is set. Complete your profile any time to get listed and qualify — we'll notify you when the next session is live."
- _(returning)_ "Welcome back!" · "Your profile is all set — you're on the board, and we'll notify you the moment the next session goes live."
- Button — "Back to The A&R Room"

**Photo crop modal** — "Crop your photo" · "Drag to position · slider to zoom" · "Use photo" · "Cancel"

---

## 4. Emails & Notifications

**OTP / login code**
- Subject — "[code] is your code for [session]"
- Body — "Your code to join [session]:" · "Expires in 10 minutes. If you didn't request this, ignore it."

**Go-live notification**
- SMS — "🎧 [session] is LIVE on The A&R Room — rate songs & read the room: [url]  Reply STOP to opt out."
- Email subject — "[session] is live now 🎧"
- Email body — "[session] just went live on The A&R Room." · "Rate songs 0–9, predict the room, and climb the leaderboard." · button "Join the room →"

**Post-session recap email (carousel)**
- Subject — "Your A&R Room recap — [session]"
- Eyebrow — "The A&R Room" · Headline — "Nice ears, [firstName]."
- Subhead — "You ranked #[rank] of [total] in [session]. Here's your recap to share."
- Card captions — "Your Score Card" · "Top 8 Songs" · "Top 8 A&Rs" · "Win $500"
- Callout — "📲 Post it — and double your reach" · "Post all four as one Instagram carousel. When you upload, add @Makinit4indies as a collaborator — it shows on both feeds. Tag us + use #TheARoom."
- Footer — "Play again → ANR.makinitmag.com"

**Feedback email (to the operator)** — Subject "A&R Room feedback — [session]"

---

## 5. Stream Overlay
*(OBS browser source — horizontal & vertical)*

- Vertical brand — "The A&R Room" · LIVE pill — "LIVE"
- Join QR label — "Scan to Win $500!"
- Leaderboard heading — "Leaderboard"
- Now-tag — "Now rating · Round [n]" / _(binary)_ "Now playing · Round [n]" (+ " · voting closed")
- Versus separator — "vs" · vote count label — "Votes in"
- Broadcast — "📣 From the host" · "Announcement"
- Winner reveal — "Round winner" · "Room average" (no votes: "No votes")
- Idle — "The A&R Room" · "Connecting to the room…" / "Starting soon…" / "[n] A&Rs in the room · waiting for the next song"
- Setup hints — "No session" · "Add ?s=SESSION_ID to the overlay URL" · "Reconnecting…"

---

## 6. Admin / Host Console
*(operator surface — labels are operational; skim for tone)*

**Login** — "Host sign in" · "Sign in with your email to manage your sessions from any device." · "Email me a code" · "Sign in"

**Session picker** — "Your sessions" · "Users" · "Series" · "+ New session" · "Log out" · empty "No sessions yet. Create your first one." · status pills "Upcoming/Live/Completed/Archived" · card buttons "Open · Edit · Duplicate · Delete" · "Share graphics ↓" → "Top 8 A&Rs" · "Top 8 Songs" · "✉ Email recap"

**Create / edit session**
- Headings — "Start a session" / "Edit session" / "New session (from a copy)"
- "Session name (shown to players)" (placeholder "e.g. A&R Room · Friday Session")
- "Default voting window (minutes, 2–60)"
- Session type — "Standard — rate a song 0–9, predict the room average" · "Versus — Song A vs B, predict the split" · hint "Set once at creation — every round in the session uses this type." · lock "🔒 Locked — this session has votes, so the session type can't change."
- "Series (counts toward this monthly leaderboard)" · "— Unassigned —" · "+ New series…"
- When — "Start now (live)" · "Schedule for later (let people pre-register)"
- "Scheduled start (Eastern Time — the broadcast timezone)"
- Extras — "Event extras (optional) — watch link, lobby message, sign-up prompt, venue"
- "Watch link" · "Submission link (where artists submit for this session)" · "Lobby message" (placeholder "Shown while players wait") · "Venue address (for check-in; enable enforcement later)" · "Find" · "Radius (yards)"
- Check-in mode — "Off — no location required" · "Optional — in-room or remote (dual pool)" · "Required — must be at the venue"
- Buttons — "Create session" / "Save changes" · "← Back to my sessions" · error "Give it a name"

**Round controls**
- "This round" · empty "No round in play. Add a song below — it starts a round right away."
- Status pills — "● Voting open" · "Closed — tallying" · "Ratified ✓" · "Queued"
- Actions — "+30s" · "+1 min" · "Close now" · "✎ Edit song" · "Close & tally → review" · "↺ Reopen voting" · "Tally the room → review winners"
- Ratified note — "Results are live on players' screens. Open the next song from the queue when ready."
- Review — "Live results review" · empty "Open and close a round to see results here before you ratify." · "Room average: [avg]" · "· 👑 Winner: [name]"
- Confirms — "Complete the session for everyone? Final scores lock in." · "Move this session back to Upcoming? It leaves the live state — players can pre-register again." · "Archive this session? It will be hidden from the active list (you can still reopen it)." · "Tally this round and push results to players?" · "Remove this song from the queue?"

**Add a song / queue**
- Heading — "Add a song" / _(round in play)_ "Queue a song" / _(binary)_ "Queue a matchup"
- Pull buttons — "⬇ Pull current song from Nero" · "⬇ Pull latest submission"
- Labels — "Song title *" (placeholder "Song name") · "Artist" (placeholder "optional") · "Giveaway this round" (placeholder "optional prize") · "Song B title *" (placeholder "The other side") · "Note for players" (placeholder "optional — anything you want them to see")
- Add button — "▶ Add & play now" / _(round in play)_ "Add to queue"
- "Up next" · empty "Queue is empty. Add a song below." · row button "Open ▸"
- Nero — "Nothing is playing on Nero right now." · "Pulled: [title] — [artist]. Review, then add it."

**Overlay builder** — "🎛️ Get overlay link" · "Pick orientation + what shows, preview it, and copy the URL into OBS." · modal "Overlay builder" · "Choose what shows, preview it, then copy the URL into an OBS browser source." · toggles "Now playing / current song / matchup card" · "Vote timer / countdown on the card" · "Leaderboard / pops in for a few seconds after each win" · "Join QR / "Scan to Win $500" join code" · "Panel opacity" · "Overlay URL" · "Copy URL" · "Open ↗" · "Close"

**Broadcast** — "Broadcast a message to everyone (pops on all player screens)" (placeholder "e.g. The Versus round is running 10 min late — we'll spin some indie until it kicks off") · "Also show on the stream overlay (uses the lower-third slot — hides the song while it's up)" · "Send broadcast" · "Clear" · "Sent to players + overlay ✓"

**Config** — "Watch link (stream URL shown to players)" · "Submission link (where artists submit; a nero.fan/…/live link enables "Pull from Nero")" · "Lobby message (shown while waiting)" (placeholder "e.g. Doors at 8, first drop at 8:30") · "Save event settings"

**SMS test** — "Test SMS setup (sends one text to check Twilio)" · "Send test" · "Sent ✓ — check your phone."

**Ads / banners** — "Ads · lobby · voting · locked" · empty "No banners yet. Upload one below — it shows in the lobby, during voting, and on the locked screen." · "Upload a banner (≈320×100, under 500KB, PNG/JPG)" · "Upload & apply"

**Room / live votes / leaderboard** — "Room" · KPIs "A&Rs / Round / Votes in" · "Live votes" · empty "No votes yet." · "Leaderboard" · empty "Nobody's joined yet — share the QR code." · ""Brought N" = friends they referred who actually played." · "Export data (ratified rounds)" · "CSV (full) / JSON (full) / CSV (anon) / JSON (anon)" · "Full versions include emails (for your list). Anon versions use "Player 1, 2…" — safe to share for analysis."

**Go-live modal** — "Go live?" · "Opens [session] for voting and notifies your registered A&Rs on the channels you pick." · channels "Email" · "SMS (only A&Rs who opted in)" · "Push (coming with the app update)" · "[n] registered A&Rs can be notified." · "Go live" · "Cancel"

**Recap-email flow** — confirm "Email the recap to [n] A&Rs who voted? … Each gets their Score Card + Top 8 Songs + Top 8 A&Rs + a promo card, with instructions to post it as an Instagram carousel." · progress "Sending [x]/[y]…" · done "Recap emailed — [n] sent."

**Series management** — "Series" · empty "No series yet. Create your first below." · "[n] sessions · top [n] → A&R Wars" · form "New series / Edit series" · "Qualify count (top-N → Wars)" · hint "Qualify count is per-series — a small month can cut at 4, a big one at 8. … membership is the tag (set it on each session in your session list)." · "Live standings" · "Top [n] qualify" · "Close series" · note "No "locking" needed. The board only moves when a tagged session gets new votes …"

**Users management** — "Users · [n] total" · "Search by name or email…" · sort "Last seen / Points / Sessions / Series / Name" · badges "Admin / Host / Blocked / Incomplete" · actions "Make host / Remove host / Block / Unblock / Delete" · perm chips "Broadcast / SMS / Ads / Export / 💵 $500"

**Host welcome modal (first-run)**
- Eyebrow — "You're a host" · Heading — "Welcome — run your own rooms"
- Intro — "The A&R Room is your free engagement tool. Three steps:"
- "Create a session. Use New session to spin up a room for your stream — pick 0–9 rating or Versus (A/B)."
- "Share your links. Give viewers the Play link to vote, and drop the Overlay onto your broadcast for the live results."
- "Promote the $500. Tell your audience the top A&Rs each month win $500 cash — that's the hook that keeps them voting."
- Footer — "You manage only your own sessions. Viewer contact info stays with Makin' It."
- Button — "Got it — let's go"

**Delete session modal** — "Delete session" · "[session] has [counts]. Archive keeps everything and just hides it (reversible). Cascade delete removes the session and all its data permanently — and changes any series leaderboard that counted it." · "Archive (recommended)" · "Cascade delete — permanent"

**Delete user modal** — "Delete user" · "Permanently delete [name] — their account, participations, and votes. This changes any leaderboard that counted them and can't be undone." · "Delete permanently"

---

## 7. System & Error Messages
*(short strings shown when something's wrong — mostly functional; revise if the tone matters)*

**Auth / access** — "Host access required" · "Not logged in" · "Not authorized" · "Admin only" · "This account has been suspended."

**Registration / OTP** — "Enter a valid email" · "Request a code first" · "Incorrect code" · "Code expired. Request a new one." · "Too many attempts. Request a new code."

**Session state** — "Session not found" · "This session is closed" · "This session is closed — you can only register for upcoming or live sessions"

**Voting** — "Voting is not open" · "Time is up" · "You already locked in" · "This is a Versus round — pick a side and predict the split" · "Pick a side: A or B" · "Split prediction must be 0–100" · "This is a rating round — rate the song and predict the average" · "Rating must be 0–9" · "Prediction must be 0.0–9.0"

**Check-in / geofence** — "This event needs your location to check you in. Please allow location access." · "You're not at the event location, so you can't vote in this in-room session."

**Rounds / queue** — "Song title required" · "Song B title required" · "Close and tally the current round first" · "Only a closed (not yet tallied) round can be reopened" · "Round already tallied — can't edit it now"

**Nero pull** — "This session has no nero.fan live link" · "Could not find that nero.fan room" · "Could not reach nero.fan — try again"

**Share cards / QR / recap** — "Top Songs is not available for Versus sessions" · "No rated songs yet" · "No ranked A&Rs yet" · "Card render failed" · "Image hosting isn't set up yet (BLOB_READ_WRITE_TOKEN). Recap emails need it to host the graphics."

**Banners / ads** — "Image too large — keep banners under ~500KB" · "Provide a PNG, JPG, GIF, or WebP image" · "Link must start with http:// or https://"

**Geocoding** — "Enter an address" · "No match for that address — try a more specific one" · "Geocoding service unavailable — enter coordinates manually"

**Photo upload** — "Image too large — try again (crop makes a small file)" · "Invalid image"

**Feedback** — "Please enter a message" · "Message is too long (max 4000 characters)" · "Screenshot must be a PNG, JPEG, WEBP or GIF image" · "Screenshot is too large (max ~5MB)"

**Users admin** — "User not found" · "Admins can't be blocked" · "Can't change an admin's role here" · "Does not match — type it exactly to confirm"

**Generic** — "Something went wrong" · "Not found" · "Server error"

---

*Generated from public/home.html, play.html, join.html, overlay.html, admin.html, email.js, and server.js. Dynamic per-state strings are labeled; some near-identical error messages are consolidated.*
