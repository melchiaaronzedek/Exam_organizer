#!/usr/bin/env python3
"""Write public/calendar.ics from exams.json so it can be subscribed to by URL."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import ROOT, exam_events, load_json, parse_date


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def main() -> None:
    exams = load_json("exams.json", {"exams": []})["exams"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jenny Tracker//Exam Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Jenny Tracker — Exams", "X-WR-TIMEZONE:Asia/Kolkata", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
    ]
    for ev in exam_events(exams):
        d = parse_date(ev["date"])
        if not d:
            continue
        tent = " (tentative)" if ev.get("dateType") == "tentative" else ""
        summary = f"{ev['examShort']}: {ev['label']}{tent}"
        desc = "\n".join(x for x in [ev.get("timeNote"), f"Centre: {ev['centre']}" if ev.get("centre") else None] if x)
        uid = f"{ev['examId']}-{ev['label']}".lower().replace(" ", "-")
        lines += [
            "BEGIN:VEVENT", f"UID:{uid}@jenny-tracker", f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{esc(summary)}",
        ]
        if desc:
            lines.append(f"DESCRIPTION:{esc(desc)}")
        if ev.get("centre"):
            lines.append(f"LOCATION:{esc(ev['centre'])}")
        for lead in ("P7D", "P1D", "PT2H"):
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc(summary)}", f"TRIGGER:-{lead}", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    out = Path(ROOT) / "public" / "calendar.ics"
    out.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")
    print(f"wrote {out} ({sum(1 for l in lines if l == 'BEGIN:VEVENT')} events)")


if __name__ == "__main__":
    main()
