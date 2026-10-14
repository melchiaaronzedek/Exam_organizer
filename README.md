# Jenny's Tracker — exam command centre

**Live site:** https://melchiaaronzedek.github.io/Exam_organizer/

One place for every recruitment exam you have applied for or still need to apply for:
every phase with its (tentative) date and exam centre, a countdown to the next one, a
calendar, official updates scraped every morning, reminders by email / Telegram /
WhatsApp, and a private document vault for hall tickets and application forms.

## What's inside

| Page | What it does |
|---|---|
| **Desk** | Countdown to the next exam, what needs attention this week, exams still to apply for, exams grouped by centre city, a 75-day timeline. |
| **Jobs** | Openings that fit the profile (MBA marketing + B.Sc Agriculture, age 26): a curated list from research plus items the daily discovery job finds in news and aggregator feeds. Each shows deadline, pay, locations, a fit score with reasons, and a source badge. Each row has *Applied*, *Remind*, *Track*, *Don't want* and *Delete*; on a phone swipe right for Applied and left for Don't want. *Remind* adds the opening to Exams and opens a prefilled GitHub issue labelled `track`; submit it and the morning job (`scraper/intake.py`) copies it into `exams.json` so email, Telegram and WhatsApp reminders cover it, then closes the issue. Expected-soon items carry typical windows from last year's cycle. |
| **Exams** | One card per exam: status, application window, every phase with date / certainty / centre preferences / allotted centre. Click the pencil on a phase to correct a date or enter the venue from your admit card. Add your own exams too. |
| **Calendar** | Month view of every phase and deadline (dashed = tentative) plus an agenda. Export an `.ics` file. |
| **Updates** | Notices found by the daily scraper, with a NEW badge until you read them, and a health table showing which official sites answered. |
| **Documents** | Two layers. **Repository files**: everything under `public/documents/<examId>/` is listed per exam and downloadable from any device. **Private vault**: drag in anything you do not want on GitHub; it stays in your browser (IndexedDB), with zip export / import to move devices. |
| **Settings** | Theme, reminder lead days, browser notifications, calendar-subscription URL, backup / restore of your local edits. |

Statuses you change, notes, roll numbers, venues and vault documents stay in your browser.
The repository holds the exam facts in `public/data/exams.json` and the application forms /
hall tickets you chose to commit under `public/documents/`.

> **Privacy note.** This repository is public, so every file under `public/documents/` is
> readable by anyone with the link (they contain registration numbers, date of birth,
> contact details and photos). To keep them while hiding them, make the repository private
> (GitHub Pages on a private repo needs GitHub Pro) or move the files into the private
> vault instead and delete them from the folder.

## Adding documents

Name files `public/documents/<examId>/<type>__<Readable_name>.pdf` where `<examId>` is the
`id` from `exams.json` and `<type>` is one of `application`, `hall-ticket`, `notification`,
`receipt`, `photo`, `result`, `other`. Commit and push; the build regenerates
`public/data/documents.json` and the Documents page and each exam card pick them up.

## The mark

`public/icons/logo.svg` is the source of the Jenny's Tracker mark: a ring (the countdown) with a notch at twelve (today) and a J whose hook lifts on hover. In the app (`src/components/Logo.tsx`) the ring fills as the next exam approaches, tilts toward the pointer, sweeps on hover, presses on tap and pulses on exam day. Colours: ink `#0b0d12`, bone `#ece6d9`, saffron `#f4a442` (dark) / `#d97f22` (light). Regenerate the PNG icons after editing the SVG with `node scripts/render-icons.mjs` (needs Playwright's Chromium).

## Phone app

The site is a PWA. On iPhone use Share → Add to Home Screen; on Android Chrome use menu → Install app. It opens full-screen with a bottom tab bar (Desk · Exams · Jobs · Calendar · More) and keeps the last loaded data available offline.

## Job matching

`public/data/profile.json` holds the public-safe profile (education, role keywords, sectors, home states, minimum pay). `scraper/fit.py` (mirrored in `src/lib/fit.ts`) scores each opening: +40 role keyword, +20 MBA / +15 graduate / +20 agriculture match, +15 sector, +10 South or all-India, +10 pay above the floor, −35 if it demands 2+ years' experience, −30 deputation/retiree posts, −30 engineering/CA/law/medical-only posts. `scraper/discover.py` runs daily after the notice scraper, reads `public/data/discovery_sources.json` (news and aggregator feeds), keeps items with fit ≥ 45 in `opportunities.json → discovered[]`, and the reminder job opens a `🎯` issue (plus Telegram/WhatsApp line) for new items with fit ≥ 60. The curated list was seeded by research on 14 Oct 2026; edit `opportunities.json → curated[]` to correct or add entries. Fit is a keyword score, not eligibility advice: always check the official notification.

## Job portals

`scraper/portals.py` runs daily after discovery and scans job portals for fresher-friendly private roles (≤ 6 months' experience; private listings need a stated salary reaching ₹10 LPA, or a known employer's explicit trainee / graduate programme). It opens each LinkedIn, Internshala, TimesJobs, Shine and Freshersworld listing to read the real experience line and pay, and drops agency-style names, scam wording and unknown employers' work-from-home offers.

| Portal | How it is read | Notes |
|---|---|---|
| Unstop, LinkedIn (guest), Internshala | public search pages / JSON | always on |
| Shine | public search pages (`__NEXT_DATA__`) | always on |
| iimjobs, TimesJobs, Freshersworld | best effort: iimjobs loads its listing client-side and is retried as a crawler, TimesJobs is rendered through the reader, Freshersworld answers 403 to datacenter addresses | always on; `✗ reason` in the footer says what stopped each one |
| Foundit | public JSON | always on; sometimes answers 403 for a run |
| Naukri | JSON API | **usually blocked**: the API asks for a recaptcha from GitHub's servers |
| Indeed, Glassdoor | rendered through the `r.jina.ai` reader | **best effort**: both sites bot-check datacenter IPs, so the footer normally shows "✗ cloudflare" or "✗ reader: no job links" |
| Adzuna | official API | off until `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are added as repo secrets (free at https://developer.adzuna.com → *Add application*) |
| Jooble | official API | off until `JOOBLE_API_KEY` is added (request one at https://jooble.org/api/about) |

Add keys under *Settings → Secrets and variables → Actions*. The Jobs page footer shows each portal as `✓ n` (listings scanned), `✗ reason` or `– off`, and a Source filter row lets you look at one portal at a time. Locally: `python scraper/portals.py --test` runs every parser against the snippets in `scraper/fixtures/`; `python scraper/portals.py --dry-run --only TimesJobs,Shine` fetches just those portals without writing.

## Reminders

Three channels, all driven by `.github/workflows/daily.yml` at **08:00 IST** every day.

1. **GitHub Issues → email (on by default).** For each date that is 7, 3, 1 or 0 days away
   the job opens an issue labelled `reminder` and mentions `@melchiaaronzedek`, so GitHub
   emails you. New scraped notices arrive as an issue labelled `update`. Make sure
   *Settings → Notifications → Email* is enabled on your GitHub account.
2. **Telegram.** Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and
   copy the token. Open a chat with your bot, send it any message, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`. In the repo go to
   *Settings → Secrets and variables → Actions* and add `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID`.
3. **WhatsApp (optional, via CallMeBot).** Follow
   https://www.callmebot.com/blog/free-api-whatsapp-messages/ to get an API key for your
   number, then add secrets `CALLMEBOT_PHONE` (with country code, e.g. `91XXXXXXXXXX`)
   and `CALLMEBOT_APIKEY`.

Channels without secrets are skipped silently. Run the workflow by hand from the
*Actions* tab (tick *Dry run* to see what would be sent without sending).

**Calendar subscription:** add `https://melchiaaronzedek.github.io/Exam_organizer/calendar.ics`
in Google Calendar (*Other calendars → From URL*) or on your phone; it carries alarms
7 days, 1 day and 2 hours before every date and refreshes daily.

## Daily scraper

`scraper/scrape.py` reads `public/data/sources.json` (two or three official pages plus
Google News feeds per exam, fetched concurrently), keeps anything new in
`public/data/updates.json`, and records per-source health in
`public/data/scrape_status.json`. A page is fetched directly first; if the site blocks bots
or needs JavaScript (most SSC / UPSC / state PSC portals), it is retried through the
public rendering proxy `r.jina.ai`, shown as *reader* in the Updates page. The very first
run is a baseline and does not raise an "update" issue; later runs alert only on items
first seen since yesterday that are also dated within the last five days. Adjust keywords
or URLs in `sources.json` any time.

## Keyboard shortcuts

`1`–`6` switch pages · `/` jumps to exam search · `t` toggles the theme.

## Editing exam data

`public/data/exams.json` is the source of truth. Each exam has `phases[]`; each phase has
`date`, `dateType` (`confirmed` | `tentative` | `tba`), `status`, and `centre`
(`preferences[]` and `allotted`). Commit a change and the site redeploys. Your own
in-browser edits are layered on top and survive redeploys.

## Development

```bash
npm install
npm run dev          # http://localhost:5173/Exam_organizer/
npm run build        # typecheck + production build into dist/
pip install -r scraper/requirements.txt
python scraper/scrape.py --dry-run
python scraper/remind.py --dry-run
python scraper/build_ics.py
```

Deployment is GitHub Pages via `.github/workflows/deploy.yml` on every push to `main`
(and to `claude/**` branches). If the first run says Pages is not enabled, open
*Settings → Pages* and set *Source* to **GitHub Actions** once.
