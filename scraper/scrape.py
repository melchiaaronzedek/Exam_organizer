#!/usr/bin/env python3
"""Fetch official notice pages + news feeds for each exam, keep anything new.

Strategy per source (all sources fetched concurrently):
  1. Direct GET with a browser-like UA, 2 attempts.
  2. If that fails or yields nothing, fetch through the public reader proxy
     https://r.jina.ai/<url>, which renders JavaScript and returns markdown —
     this rescues SPA-style government sites (ssc.gov.in, psc.ap.gov.in …).

Writes public/data/updates.json and public/data/scrape_status.json. Never raises:
a dead source is recorded with ok=false so the UI can show it.

Usage: python scrape.py [--dry-run] [--only <examId>]
"""
from __future__ import annotations

import hashlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from common import load_json, now_ist, save_json

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TIMEOUT = 20
MAX_PER_SOURCE = 40
NOISE = re.compile(
    r"^(home|login|register|contact( us)?|sitemap|privacy( policy)?|terms|disclaimer|skip to( main)? content|read more|click here|download|english|hindi|हिंदी|faq|help|screen reader access|a-|a\+|a)$",
    re.I,
)
DATE_RX = re.compile(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})")
MD_LINK = re.compile(r"\[([^\]]{8,220})\]\((https?://[^)\s]+)\)")


def fetch(url: str, attempts: int = 2) -> requests.Response:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"}, timeout=TIMEOUT)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(str(last)[:160])


def item_id(exam_id: str, url: str, title: str) -> str:
    return hashlib.sha1(f"{exam_id}|{url}|{title.lower()}".encode()).hexdigest()[:16]


def matches(text: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    t = text.lower()
    return any(k.lower() in t for k in keywords)


def date_from_text(text: str) -> str | None:
    m = DATE_RX.search(text)
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    try:
        return datetime(y, mo, d).date().isoformat()
    except ValueError:
        return None


def clean_title(t: str) -> str:
    return " ".join(t.replace("\xa0", " ").split())[:220]


def parse_html(src: dict, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        title = clean_title(a.get_text(" ", strip=True))
        href = a["href"].strip()
        if not title or len(title) < 8 or NOISE.match(title) or href.startswith(("javascript:", "#", "mailto:", "tel:")):
            continue
        full = urljoin(src["url"], href)
        parent_text = clean_title(a.parent.get_text(" ", strip=True))[:300] if a.parent else ""
        if not matches(title + " " + parent_text, src.get("keywords", [])):
            continue
        if full in seen:
            continue
        seen.add(full)
        out.append({"title": title, "url": full, "publishedAt": date_from_text(parent_text or title)})
        if len(out) >= MAX_PER_SOURCE:
            break
    return out


def parse_markdown(src: dict, md: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for m in MD_LINK.finditer(md):
        title, url = clean_title(m.group(1)), m.group(2)
        if NOISE.match(title) or url in seen or not matches(title, src.get("keywords", [])):
            continue
        if re.search(r"\.(png|jpg|jpeg|gif|svg|css|js)(\?|$)", url, re.I):
            continue
        seen.add(url)
        line_start = md.rfind("\n", 0, m.start()) + 1
        line = md[line_start : md.find("\n", m.end()) if md.find("\n", m.end()) != -1 else len(md)]
        out.append({"title": title, "url": url, "publishedAt": date_from_text(line)})
        if len(out) >= MAX_PER_SOURCE:
            break
    return out


def parse_rss(src: dict, xml: str) -> list[dict]:
    soup = BeautifulSoup(xml, "xml")
    out: list[dict] = []
    for item in soup.find_all("item")[:MAX_PER_SOURCE]:
        title = clean_title(item.title.get_text(strip=True) if item.title else "")
        link = (item.link.get_text(strip=True) if item.link else "").strip()
        pub = item.pubDate.get_text(strip=True) if item.pubDate else None
        if not title or not link or not matches(title, src.get("keywords", [])):
            continue
        iso = None
        if pub:
            try:
                iso = parsedate_to_datetime(pub).date().isoformat()
            except Exception:  # noqa: BLE001
                iso = None
        out.append({"title": title, "url": link, "publishedAt": iso})
    return out


def scrape_source(src: dict) -> tuple[dict, list[dict]]:
    stamp = now_ist().isoformat(timespec="seconds")
    row = {"name": src["name"], "examId": src["examId"], "url": src["url"], "ok": False, "error": None, "items": 0, "via": None, "checkedAt": stamp}
    items: list[dict] = []
    errors: list[str] = []
    if src.get("type") == "rss":
        try:
            items = parse_rss(src, fetch(src["url"]).text)
            row["via"] = "rss"
        except Exception as e:  # noqa: BLE001
            errors.append(str(e)[:120])
    else:
        try:
            items = parse_html(src, fetch(src["url"]).text)
            row["via"] = "direct"
        except Exception as e:  # noqa: BLE001
            errors.append(f"direct: {str(e)[:100]}")
        if not items and not src.get("no_reader"):
            try:
                r = requests.get(f"https://r.jina.ai/{src['url']}", headers={"User-Agent": UA, "Accept": "text/plain", "X-Return-Format": "markdown"}, timeout=45)
                r.raise_for_status()
                items = parse_markdown(src, r.text)
                row["via"] = "reader"
            except Exception as e:  # noqa: BLE001
                errors.append(f"reader: {str(e)[:100]}")
    row["ok"] = bool(items) or (not errors)
    row["items"] = len(items)
    row["error"] = " | ".join(errors)[:200] if errors and not items else None
    return row, items


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    sources = [s for s in load_json("sources.json", {"sources": []})["sources"] if not only or s["examId"] == only]
    updates_file = load_json("updates.json", {"updatedAt": None, "updates": []})
    existing = {u["id"]: u for u in updates_file.get("updates", [])}
    baseline = len(existing) == 0  # first ever run: everything is "new", don't alert on it
    stamp = now_ist().isoformat(timespec="seconds")
    new_count = 0
    status_rows: list[dict] = []

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(scrape_source, sources))

    for src, (row, items) in zip(sources, results):
        status_rows.append(row)
        for it in items:
            uid = item_id(src["examId"], it["url"], it["title"])
            if uid in existing:
                continue
            existing[uid] = {"id": uid, "examId": src["examId"], "title": it["title"], "url": it["url"], "source": src["name"], "publishedAt": it.get("publishedAt"), "firstSeen": stamp}
            new_count += 1
        mark = "ok  " if row["ok"] else "fail"
        print(f"[{mark}] {src['name']:<34} {row['items']:>3} items via {row['via'] or '-'}{'  ' + row['error'] if row['error'] else ''}")

    merged = sorted(existing.values(), key=lambda u: (u.get("firstSeen") or ""), reverse=True)[:500]
    print(f"{new_count} new items; {sum(1 for r in status_rows if r['ok'])}/{len(status_rows)} sources ok")
    if dry:
        print("dry-run: not writing")
        return 0
    save_json("updates.json", {"updatedAt": stamp, "baseline": baseline, "updates": merged})
    save_json("scrape_status.json", {"lastRun": stamp, "sources": status_rows})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
