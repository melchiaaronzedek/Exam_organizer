#!/usr/bin/env python3
"""Fetch official notice pages + news feeds for each exam, keep anything new.

Writes public/data/updates.json and public/data/scrape_status.json. Never raises:
a dead source is recorded with ok=false so the UI can show it.

Usage: python scrape.py [--dry-run]
"""
from __future__ import annotations

import hashlib
import re
import sys
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from common import load_json, now_ist, save_json

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ParikshaDesk/1.0"
TIMEOUT = 25
MAX_PER_SOURCE = 40
NOISE = re.compile(r"^(home|login|register|contact|sitemap|privacy|terms|disclaimer|skip to|read more|click here|download)$", re.I)


def fetch(url: str) -> requests.Response:
    last: Exception | None = None
    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"}, timeout=TIMEOUT)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last)[:160])


def item_id(exam_id: str, url: str, title: str) -> str:
    return hashlib.sha1(f"{exam_id}|{url}|{title.lower()}".encode()).hexdigest()[:16]


def matches(text: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    t = text.lower()
    return any(k.lower() in t for k in keywords)


def parse_html(src: dict, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        title = " ".join(a.get_text(" ", strip=True).split())
        href = a["href"].strip()
        if not title or len(title) < 8 or NOISE.match(title) or href.startswith(("javascript:", "#", "mailto:")):
            continue
        full = urljoin(src["url"], href)
        context = title + " " + " ".join(a.parent.get_text(" ", strip=True).split())[:300] if a.parent else title
        if not matches(context, src.get("keywords", [])):
            continue
        if full in seen:
            continue
        seen.add(full)
        out.append({"title": title[:220], "url": full, "publishedAt": None})
        if len(out) >= MAX_PER_SOURCE:
            break
    return out


def parse_rss(src: dict, xml: str) -> list[dict]:
    soup = BeautifulSoup(xml, "xml")
    out: list[dict] = []
    for item in soup.find_all("item")[:MAX_PER_SOURCE]:
        title = (item.title.get_text(strip=True) if item.title else "").strip()
        link = (item.link.get_text(strip=True) if item.link else "").strip()
        pub = item.pubDate.get_text(strip=True) if item.pubDate else None
        if not title or not link or not matches(title, src.get("keywords", [])):
            continue
        iso = None
        if pub:
            try:
                from email.utils import parsedate_to_datetime

                iso = parsedate_to_datetime(pub).astimezone().isoformat()
            except Exception:  # noqa: BLE001
                iso = None
        out.append({"title": title[:220], "url": link, "publishedAt": iso})
    return out


def main(dry: bool) -> int:
    sources = load_json("sources.json", {"sources": []})["sources"]
    updates_file = load_json("updates.json", {"updatedAt": None, "updates": []})
    existing = {u["id"]: u for u in updates_file.get("updates", [])}
    status_rows: list[dict] = []
    new_count = 0
    stamp = now_ist().isoformat(timespec="seconds")

    for src in sources:
        row = {"name": src["name"], "examId": src["examId"], "url": src["url"], "ok": False, "error": None, "items": 0, "checkedAt": stamp}
        try:
            r = fetch(src["url"])
            items = parse_rss(src, r.text) if src.get("type") == "rss" else parse_html(src, r.text)
            row["ok"] = True
            row["items"] = len(items)
            for it in items:
                uid = item_id(src["examId"], it["url"], it["title"])
                if uid in existing:
                    continue
                existing[uid] = {
                    "id": uid,
                    "examId": src["examId"],
                    "title": it["title"],
                    "url": it["url"],
                    "source": src["name"],
                    "publishedAt": it.get("publishedAt"),
                    "firstSeen": stamp,
                }
                new_count += 1
            print(f"[ok]   {src['name']}: {len(items)} items")
        except Exception as e:  # noqa: BLE001
            row["error"] = str(e)[:160]
            print(f"[fail] {src['name']}: {row['error']}")
        status_rows.append(row)

    # Keep the feed bounded: newest 400.
    merged = sorted(existing.values(), key=lambda u: u["firstSeen"], reverse=True)[:400]
    if dry:
        print(f"dry-run: {new_count} new items, not writing")
        return 0
    save_json("updates.json", {"updatedAt": stamp, "updates": merged})
    save_json("scrape_status.json", {"lastRun": stamp, "sources": status_rows})
    print(f"{new_count} new items; {sum(1 for r in status_rows if r['ok'])}/{len(status_rows)} sources ok")
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry-run" in sys.argv))
