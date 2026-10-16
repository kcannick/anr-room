# Monthly process: announcing the Makin' It HOT 100

Run this the day the HOT 100 carousel goes up on Instagram (first run: 2026-10-14). It takes
about 15 minutes in Brevo. Both sends go to the **Artists** list, **A&R Program - Submissions #119**
(every artist whose record was played; kept in sync by the app's daily Brevo sync).

Two sends, in this order:

| # | Channel | When | Audience |
|---|---------|------|----------|
| 1 | Email (styled HTML) | As soon as the Instagram post is live | List #119 (~620 contacts) |
| 2 | SMS | When the live show is about to announce the Top 8 / tournament picks | List #119 contacts with a phone (~550) |

## Before you start — fill in these three things

1. **Instagram post URL** of this month's HOT 100 carousel (e.g. `https://www.instagram.com/p/XXXX/`).
2. **Submission count** for the month ("Over 300 songs were received last month").
3. **Live link** — `www.makinitmag.com/live` (the same every month unless the show moves).

## 1. Email

1. Brevo → Campaigns → **Create campaign → Email**. Name it `HOT 100 posted - Artists - <Mon D YYYY>`.
2. **Recipients:** Send to → `A&R Program - Submissions #119`. Save.
3. **Subject:** `Did your song make the Makin' It HOT 100?`
   (If sent while the show is live, lead with it: `We're live: did your song make the Makin' It HOT 100?`)
   **Preview text:** `See the list on Instagram, then tune in for the Top 8 countdown and the tournament picks.`
4. **Design:** Start designing → Create from scratch → **HTML custom code**. Paste
   [hot100-announcement-email.html](hot100-announcement-email.html) after editing:
   - the Instagram `href` (one place, the green button),
   - the submission count sentence,
   - the live box: keep "Live right now" if sending during the show; otherwise change the eyebrow to
     the show's day and time ("Wednesday 7 PM ET") and the button to "Watch the live show".
   The template already carries Brevo's `{{ unsubscribe }}` link and the logo from anr.makinitmag.com.
5. Save & Quit → **Schedule → Send now**. (Brevo shows it as "Scheduled for <a minute from now>"; that is its send-now queue.)

**The copy** (operator's wording, keep it):

> The Makin' It HOT 100 is up on Instagram.
> Over 300 songs were received last month, so making the list at all is a big accomplishment. Check the list and see if your song made it. [See the HOT 100 on Instagram]
> If you made the list: repost, share to your story, and send to your fans for them to do the same!
> **Live right now** — Top 8 countdown + the tournament picks. We're counting down the Top 8 songs from last week's reviews and announcing the artists going into the $1,000 Music Tournament. Join in to qualify for the $1,000 Music Tournament. [Join the live show → makinitmag.com/live]
> Didn't make the list? Submit something new right now at www.makinitmag.com/review [Submit your music]

## 2. SMS (when the Top 8 is about to be announced on the live show)

1. Brevo → Campaigns → **Create campaign → SMS**. Name it `Top 8 live now - Artists - <Mon D YYYY>`.
2. **Message content** (one GSM-7 segment, 113 chars; no emoji, straight apostrophes):
   ```
   Makin' It: We're about to announce this week's Top 8 Songs LIVE right now. Watch and join in: makinitmag.com/live
   ```
   Leave "Manage US compliance" and "Special characters" off.
3. **Sender:** the Sender ID dropdown lists 15 alphanumeric senders for other countries; the US one is a
   **phone number**. Type `1855` in the dropdown's search box and pick **+18559135765 (United States)**. Save.
4. **Recipients:** Send to → `A&R Program - Submissions #119` (search "Submissions"). Save.
5. **Send now or later → Send now**.

## Notes

- Brevo is the only path for both sends: the app's own Twilio and Brevo API keys live in Vercel, not on
  the laptop (the local env file holds `[sensitive]` placeholders), so nothing can be scripted from here
  without `vercel env pull`. A console button that creates both campaigns through the Brevo API
  (`POST /emailCampaigns`, `POST /smsCampaigns`, then `/sendNow`) is the automation path if this gets
  tedious — the app already holds `BREVO_API_KEY` in production.
- Email reach: the email cannot carry a merge name (list 119 contacts have email + phone only).
- Instagram caption rules still apply to the post itself (see the global caption rule); this email is
  allowed to carry links.
