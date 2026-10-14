"""Shared helpers for the daily scrape / reminder jobs."""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def load_json(name: str, default):
    p = DATA / name
    if not p.exists():
        return default
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(name: str, obj) -> None:
    p = DATA / name
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def env(name: str) -> str | None:
    v = os.environ.get(name, "").strip()
    return v or None


def parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def exam_events(exams: list[dict]) -> list[dict]:
    """Flatten exams into dated events (phase dates + application deadlines)."""
    out: list[dict] = []
    for ex in exams:
        for ph in ex.get("phases", []):
            d = ph.get("dateEnd") if ph.get("kind") == "application" and ph.get("dateEnd") else ph.get("date")
            if not d:
                continue
            centre = (ph.get("centre") or {})
            out.append(
                {
                    "examId": ex["id"],
                    "examShort": ex["short"],
                    "label": ph["name"],
                    "kind": ph.get("kind", "other"),
                    "date": d,
                    "dateType": ph.get("dateType", "confirmed"),
                    "centre": centre.get("allotted") or (", ".join(centre.get("preferences", [])[:1]) or None),
                    "timeNote": ph.get("timeNote"),
                    "status": ph.get("status", "upcoming"),
                }
            )
        app = ex.get("application", {})
        has_apply_phase = any(p.get("kind") == "application" for p in ex.get("phases", []))
        if not has_apply_phase and app.get("closes") and not app.get("applied"):
            out.append(
                {
                    "examId": ex["id"],
                    "examShort": ex["short"],
                    "label": "Application closes",
                    "kind": "application",
                    "date": app["closes"],
                    "dateType": "confirmed",
                    "centre": None,
                    "timeNote": None,
                    "status": "upcoming",
                }
            )
    return sorted(out, key=lambda e: e["date"])
