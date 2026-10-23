# @TheAnRTeam — account setup checklist

Step by step for section 2 of the Asana project "@TheAnRTeam Instagram — Account Setup + Launch"
(gid 1219512468701569). Every step here needs the account owner signed in to Instagram, Meta or
SocialBee; nothing in it is done by Claude. Do them in this order: the keyword DMs must work
before the first post goes up, or the first comments go unanswered.

Copy and files: `captions.md` and the PNGs in this folder (`public/brand/team-ig/`).

---

## 1. Switch to a Professional account

1. Instagram app → profile → menu (three lines) → **Settings and activity**.
2. **Account type and tools** → **Switch to professional account**.
3. Choose **Business**. (Creator also works for collab posts, but SocialBee and Meta's
   scheduling tools are built around Business accounts linked to a Facebook Page.)
4. Category: **Community** (or Music). Turn **Display category on profile** off so the profile
   leads with the name field.
5. Contact options: email only. Do not add a phone number to the public profile.
6. Link a Facebook Page when asked: **Accounts Center → Accounts → Add accounts**, and connect the
   page this account will publish through (the Makin' It page, or a new A&R Team page). SocialBee
   needs this link to post.
7. Confirm: the profile shows **Professional dashboard**.

## 2. Profile picture, name field, bio and links

1. **Edit profile → Edit picture** → upload `avatar.png`. Check the circle crop: the whole
   A&R block should sit inside it.
2. **Name**: `The A&R Team · Music Reviewers`. Instagram allows two name changes every 14 days,
   so paste it exactly once.
3. **Bio** (142 of 150 characters):
   `The A&R Team rates new music from independent artists every day. Artists: submit your music for a free review. Listeners: join the team below.`
4. **Links → Add external link**, in this order:
   - Title `Join the A&R Team` · URL `https://makinitmag.com/ANR`
   - Title `Submit your music` · URL `https://www.makinitmag.com/review`
5. Leave pronouns and the gender field empty.

## 3. Comment-keyword DMs (#ANR and #REVIEW)

Use the same tool that runs the keyword DMs on @Makinit4indies, so both accounts answer the
same way. Set up two automations on @TheAnRTeam:

| Keyword (match with or without #, any case) | DM | Public reply |
|---|---|---|
| `ANR` | Thanks for your interest in the A&R Team. Join here: https://makinitmag.com/ANR. New records open every day at 6:00 PM ET. | Sent you a DM. |
| `REVIEW` | Thanks for your interest. Submit your music for a review by the A&R Team here: https://www.makinitmag.com/review | Sent you a DM. |

Scope: all posts and Reels, including future ones. Test both from a second Instagram account on
a throwaway post (archive it after) before the launch grid goes up.

## 4. Threads profile

1. Open the Threads app and sign in with @TheAnRTeam.
2. **Import from Instagram** (picture, name and bio come across). Check the bio matches step 2.
3. Add the same link: `https://makinitmag.com/ANR`.
4. Every Threads post uses the topic **Independent Artists**. There is no # symbol, and a topic
   cannot be changed after posting.

## 5. Add @TheAnRTeam to SocialBee

1. app.socialbee.com → **Profiles → Add profile → Instagram** → sign in with the Meta account
   that manages the Facebook Page from step 1, and pick @TheAnRTeam.
2. Add **Threads** the same way if SocialBee lists it.
3. Check the connection before trusting it: Instagram posts on @makinit4indies have failed with
   "Invalid user id" / "Insufficient permission" since about 2026-09-17, even though the profile
   shows Connected. Schedule one test post to @TheAnRTeam, then open
   **Schedule → View → @TheAnRTeam → Failed Posts**. If it failed, use **Reconnect** on the
   profile (Meta login) and test again. Delete the test post afterwards.
4. Once it works, tell Claude: the six launch posts can then be queued as SocialBee drafts in the
   order below, with captions, first comments and pins noted, for you to approve one at a time.

## 6. Launch day

1. Keyword DMs tested (step 3).
2. Post in this order (Instagram fills the grid newest first):
   1. Schedule · 2. Artists · 3. What the numbers mean (3 slides) · 4. Join · 5. How it works (4 slides) · 6. Intro
3. Pin **Intro**, **How it works** and **Join** (post menu → Pin to your profile).
4. Share each post to a story, then create the six highlights with their covers
   (How it works · Join · Submit music · HOT 100 · Results · Winners; files `hl-*.png`).
5. Cross-post each to Threads with the topic Independent Artists.

## 7. Cross-promotion

1. **@Makinit4indies**: one feed post and one story introducing @TheAnRTeam, with a mention
   sticker on the story. Suggested caption first line: "Follow @TheAnRTeam: the music reviewers
   who rate new records from independent artists every day."
2. **makinitmag.com**: add @TheAnRTeam to the site footer and the /ANR page (Drupal, mim repo).
3. **A&R emails**: the daily digest's "See the Top Tracks on Instagram" link points at
   @Makinit4indies. Change it to @TheAnRTeam once the Countdown posts there. This is a small code
   change in anr-room and needs its own go-ahead.
