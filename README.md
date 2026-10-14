# Pariksha Desk — exam command centre

**Live site:** https://melchiaaronzedek.github.io/Exam_organizer/

One place for every recruitment exam you have applied for or still need to apply for:
every phase with its (tentative) date and exam centre, a countdown to the next one, a
calendar, official updates scraped every morning, reminders by email / Telegram /
WhatsApp, and a private document vault for hall tickets and application forms.

## What's inside

| Page | What it does |
|---|---|
| **Desk** | Countdown to the next exam, what needs attention this week, exams still to apply for, exams grouped by centre city, a 75-day timeline. |
| **Exams** | One card per exam: status, application window, every phase with date / certainty / centre preferences / allotted centre. Click the pencil on a phase to correct a date or enter the venue from your admit card. Add your own exams too. |
| **Calendar** | Month view of every phase and deadline (dashed = tentative) plus an agenda. Export an `.ics` file. |
| **Updates** | Notices found by the daily scraper, with a NEW badge until you read them, and a health table showing which official sites answered. |
| **Documents** | Drag in hall tickets and forms. They are stored in your browser only (IndexedDB) — nothing is uploaded or committed. Export / import a zip to move devices. |
| **Settings** | Theme, reminder lead days, browser notifications, calendar-subscription URL, backup / restore of your local edits. |

Everything personal (statuses you change, notes, roll numbers, venues, documents) stays in
your browser. The repository only holds public exam facts in `public/data/exams.json`.

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

`scraper/scrape.py` reads `public/data/sources.json` (an official page and a Google News
feed per exam), keeps anything new in `public/data/updates.json`, and records per-source
health in `public/data/scrape_status.json`. Government sites that block bots or need
JavaScript show up as *Failed* in the Updates page rather than breaking the run; the news
feed for that exam still works. Adjust keywords or URLs in `sources.json` any time.

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
