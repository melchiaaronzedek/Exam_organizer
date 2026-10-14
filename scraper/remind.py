#!/usr/bin/env python3
"""Send reminders for upcoming dates and newly scraped notices.

Channels (each used only when its credentials exist):
  * GitHub Issues  – GITHUB_TOKEN + GITHUB_REPOSITORY (set automatically in Actions). GitHub emails the owner.
  * Telegram       – TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
  * WhatsApp       – CALLMEBOT_PHONE + CALLMEBOT_APIKEY (https://www.callmebot.com/blog/free-api-whatsapp-messages/)

Usage: python remind.py [--dry-run] [--lead 7,3,1,0]
"""
from __future__ import annotations

import sys
from datetime import timedelta

import requests

from common import env, exam_events, load_json, parse_date, today_ist

OWNER_MENTION = "@melchiaaronzedek"
DEFAULT_LEAD = [7, 3, 1, 0]


def human(days: int) -> str:
    return {0: "TODAY", 1: "tomorrow"}.get(days, f"in {days} days")


def build_reminders(lead: list[int]) -> list[dict]:
    exams = load_json("exams.json", {"exams": []})["exams"]
    today = today_ist()
    out = []
    for ev in exam_events(exams):
        d = parse_date(ev["date"])
        if not d or ev.get("status") == "done":
            continue
        days = (d - today).days
        if days not in lead:
            continue
        kind = ev["kind"]
        verb = {"application": "application closes", "exam": "exam", "admit-card": "admit card", "result": "result", "interview": "interview"}.get(kind, "stage")
        tent = " (tentative)" if ev.get("dateType") == "tentative" else ""
        title = f"⏰ {ev['examShort']}: {ev['label']} {human(days)} ({d.strftime('%a %d %b')}){tent}"
        body_lines = [
            f"**{ev['examShort']} — {ev['label']}**",
            f"- When: {d.strftime('%A, %d %B %Y')} ({human(days)}){tent}",
            f"- Type: {verb}",
        ]
        if ev.get("timeNote"):
            body_lines.append(f"- Time: {ev['timeNote']}")
        if ev.get("centre"):
            body_lines.append(f"- Centre: {ev['centre']}")
        body_lines.append("")
        body_lines.append("Open the desk: https://melchiaaronzedek.github.io/Exam_organizer/")
        out.append({"key": f"{ev['examId']}:{ev['label']}:{d.isoformat()}:{days}", "title": title, "body": "\n".join(body_lines), "days": days})
    return out


def new_updates_since_yesterday() -> list[dict]:
    data = load_json("updates.json", {"updates": []})
    cutoff = (today_ist() - timedelta(days=1)).isoformat()
    return [u for u in data.get("updates", []) if u.get("firstSeen", "")[:10] >= cutoff]


# ---------- channels ----------

def gh_headers(token: str):
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


def github_issue(title: str, body: str, labels: list[str], dry: bool) -> None:
    token, repo = env("GITHUB_TOKEN"), env("GITHUB_REPOSITORY")
    if not token or not repo:
        print("  (github: no token/repo, skipped)")
        return
    api = f"https://api.github.com/repos/{repo}/issues"
    # Dedupe on exact title among open+closed reminder issues created in the last 60 days.
    q = requests.get(api, headers=gh_headers(token), params={"state": "all", "labels": ",".join(labels), "per_page": 100}, timeout=30)
    if q.ok and any(i.get("title") == title for i in q.json()):
        print(f"  (github: already exists) {title}")
        return
    if dry:
        print(f"  (github dry) {title}")
        return
    r = requests.post(api, headers=gh_headers(token), json={"title": title, "body": f"{OWNER_MENTION}\n\n{body}", "labels": labels}, timeout=30)
    print(f"  github {r.status_code}: {title}")


def telegram(text: str, dry: bool) -> None:
    token, chat = env("TELEGRAM_BOT_TOKEN"), env("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return
    if dry:
        print("  (telegram dry)\n" + text)
        return
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat, "text": text, "parse_mode": "Markdown", "disable_web_page_preview": True}, timeout=30)
    print(f"  telegram {r.status_code}")


def whatsapp(text: str, dry: bool) -> None:
    phone, key = env("CALLMEBOT_PHONE"), env("CALLMEBOT_APIKEY")
    if not phone or not key:
        return
    if dry:
        print("  (whatsapp dry)")
        return
    r = requests.get("https://api.callmebot.com/whatsapp.php", params={"phone": phone, "apikey": key, "text": text}, timeout=30)
    print(f"  whatsapp {r.status_code}")


def ensure_labels(dry: bool) -> None:
    token, repo = env("GITHUB_TOKEN"), env("GITHUB_REPOSITORY")
    if not token or not repo or dry:
        return
    for name, color, desc in [("reminder", "F4A442", "Upcoming exam date / deadline"), ("update", "3EC6B4", "New official notice found by the scraper")]:
        requests.post(f"https://api.github.com/repos/{repo}/labels", headers=gh_headers(token), json={"name": name, "color": color, "description": desc}, timeout=30)


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    lead = DEFAULT_LEAD
    if "--lead" in argv:
        lead = [int(x) for x in argv[argv.index("--lead") + 1].split(",")]
    ensure_labels(dry)

    reminders = build_reminders(lead)
    print(f"{len(reminders)} reminder(s) for today")
    for r in reminders:
        github_issue(r["title"], r["body"], ["reminder"], dry)

    fresh = new_updates_since_yesterday()
    if fresh:
        by_exam: dict[str, list[dict]] = {}
        for u in fresh:
            by_exam.setdefault(u["examId"], []).append(u)
        lines = []
        for ex, items in by_exam.items():
            lines.append(f"**{ex}**")
            lines += [f"- [{u['title']}]({u['url']}) — {u['source']}" for u in items[:8]]
            if len(items) > 8:
                lines.append(f"- …and {len(items) - 8} more")
        title = f"🆕 {len(fresh)} new notice(s) found — {today_ist().strftime('%d %b')}"
        github_issue(title, "\n".join(lines) + "\n\nSee all: https://melchiaaronzedek.github.io/Exam_organizer/#/updates", ["update"], dry)

    if reminders or fresh:
        msg = ["*Pariksha Desk — daily brief*"]
        for r in reminders:
            msg.append(r["title"])
        if fresh:
            msg.append(f"🆕 {len(fresh)} new notices: https://melchiaaronzedek.github.io/Exam_organizer/#/updates")
        text = "\n".join(msg)
        telegram(text, dry)
        whatsapp(text, dry)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
