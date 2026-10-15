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
from datetime import datetime, timedelta
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
KEEP_DATED_DAYS = 60       # news older than this (by publication date) is dropped
KEEP_UNDATED_DAYS = 30     # notices without a date: by the day we first saw them
# What a headline is about; first match wins. "other" is prep content, opinion and listicles.
KIND_RULES = [
    ("admit-card", re.compile(r"admit card|hall ticket|call letter|city intimation|e-?admit", re.I)),
    ("answer-key", re.compile(r"answer key|response sheet|objection", re.I)),
    ("result", re.compile(r"\bresults?\b|merit list|score ?card|final selection|selection list|shortlist|list of (?:candidates|qualified)|marks (?:released|out)", re.I)),
    ("cut-off", re.compile(r"cut[- ]?off\b(?!.*\?)(?=.*\b(?:released|out|announced|declared|official|category[- ]wise)\b)|qualifying marks", re.I)),
    ("interview", re.compile(r"interview|document verification|\bdv\b|medical exam|joining|appointment letter", re.I)),
    ("exam-date", re.compile(r"exam dates?|exam schedule|\bschedule\b|postponed|rescheduled|time ?table|date sheet|exam (?:on|from|to begin|begins|starts)|to be held|tier[- ]?\d.{0,20}\b(?:on|from)\b", re.I)),
    ("notification", re.compile(r"notification|recruitment .{0,30}\b(?:out|released|announced)\b|vacanc|apply online|registration|last date|application .{0,30}\b(?:open|extended|closes|begins|starts|reopen)|correction window|apply by|online form|\bout\b.{0,20}posts|posts? (?:announced|notified)", re.I)),
]
JUNK_RX = re.compile(r"best books|preparation (?:tips|strategy|plan)|how to (?:prepare|crack|score|clear)|study plan|topper|success story|coaching|mock test|previous year|syllabus|salary (?:structure|in hand|slip|after)|expected cut ?off|will .* be\b|\?\s*$|\bvs\.?\b|quora|youtube|telegram|free pdf|notes pdf|important topics|\btips\b|tricks|strategy|books|analysis|difficulty level|review|explained|job profile|career growth|eligibility criteria", re.I)
STOP = {"the", "a", "an", "of", "for", "to", "in", "on", "at", "and", "or", "is", "are", "out", "by", "with", "2026", "2025", "check", "here", "now", "latest", "update", "updates", "news", "today", "details", "know", "how", "what", "when", "direct", "link", "live", "big", "from"}
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


def split_publisher(title: str) -> tuple[str, str | None]:
    """Google News titles end in ' - Publisher'; return (headline, publisher)."""
    for sep in (" - ", " – ", " | "):
        if sep in title:
            head, tail = title.rsplit(sep, 1)
            if 0 < len(tail.split()) <= 4 and len(head) >= 12:
                return head.strip(), tail.strip()
    return title, None


def classify(title: str) -> str:
    for kind, rx in KIND_RULES:
        if rx.search(title):
            return kind
    return "other"


def dup_key(exam_id: str, kind: str, title: str) -> str:
    words = [w for w in re.findall(r"[a-z0-9]+", title.lower()) if w not in STOP][:7]
    return f"{exam_id}|{kind}|{' '.join(words)}"


def is_fresh(item: dict, today: datetime) -> bool:
    pub = (item.get("publishedAt") or "")[:10]
    if pub:
        try:
            return (today.date() - datetime.fromisoformat(pub).date()).days <= KEEP_DATED_DAYS
        except ValueError:
            pass
    seen = (item.get("firstSeen") or "")[:10]
    try:
        return (today.date() - datetime.fromisoformat(seen).date()).days <= KEEP_UNDATED_DAYS if seen else True
    except ValueError:
        return True


def refine(item: dict, is_news: bool, today: datetime) -> dict | None:
    """Classify, strip the outlet from the headline, and drop prep content, generic news and stale items. None = drop."""
    title = clean_title(item.get("title") or "")
    if is_news:
        title, pub = split_publisher(title)
        if pub and not item.get("publisher"):
            item["publisher"] = pub
    item["title"] = title
    kind = classify(title)
    item["kind"] = kind
    if kind == "other" and (is_news or JUNK_RX.search(title)):
        return None
    if not is_fresh(item, today):
        return None
    return item


def collapse(items: list[dict]) -> list[dict]:
    """One row per story: outlets covering the same headline collapse into the newest, with alsoIn = how many carried it."""
    best: dict[str, dict] = {}
    for it in sorted(items, key=lambda u: (u.get("publishedAt") or u.get("firstSeen") or ""), reverse=True):
        k = dup_key(it["examId"], it.get("kind", "other"), it["title"])
        if k in best:
            best[k]["alsoIn"] = best[k].get("alsoIn", 1) + 1
        else:
            it["alsoIn"] = it.get("alsoIn", 1)
            best[k] = it
    return list(best.values())


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


def self_test() -> int:
    bad = 0
    cases = [
        ("SSC CGL 2026 Admit Card Release DATE; Tier 1 City Intimation Slip Released - Shiksha.com", "admit-card"),
        ("PFRDA Grade A 2026 Result Declared at pfrda.org.in - PW", "result"),
        ("SSC CGL 2026 Notification Out: Application begins for over 12,000 vacancies - Shiksha", "notification"),
        ("SSC CGL 2026 Exam Date OUT @ssc.gov.in; Tier 1 to begin on September 30 - Shiksha.com", "exam-date"),
        ("UPSC EPFO APFC Answer Key 2026 released, raise objections till Oct 20 - Jagran", "answer-key"),
        ("NICL AO cut-off 2026 released: category-wise marks - PW", "cut-off"),
        ("CONCOR Management Trainee interview schedule 2026 announced - Careers360", "interview"),
        ("SSC CGL 2026: Check Important Topics to Revise for Tier 1 exam - Shiksha", "other"),
        ("Will SSC CGL 2026 Be Delayed? Latest Updates on CGL - PW", "other"),
        ("SSC CGL Form Fees 2026 Details And How to Apply For SSC CGL 2026 - PW", "other"),
        ("SSC CGL 2026 New Changes Explained: Tier-II Update, AAO Paper & Age Limit Revision - PW", "other"),
        ("AAI Junior Executive 2026: Exam on Oct 18, reporting time and documents - Careers360", "exam-date"),
    ]
    for title, want in cases:
        got = classify(split_publisher(title)[0])
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} kind {got:<12} {title[:70]}")
    head, pub = split_publisher("SSC CGL 2026 Admit Card Released - Shiksha.com")
    ok = head == "SSC CGL 2026 Admit Card Released" and pub == "Shiksha.com"
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} publisher split -> {head!r} / {pub!r}")
    today = datetime(2026, 10, 15)
    kept = refine({"title": "SSC CGL 2026 Admit Card Out - PW", "publishedAt": "2026-10-10", "firstSeen": "2026-10-11T08:00:00"}, True, today)
    old = refine({"title": "SSC CGL 2026 Admit Card Out - PW", "publishedAt": "2026-06-10", "firstSeen": "2026-06-11T08:00:00"}, True, today)
    junk = refine({"title": "SSC CGL 2026 Best Books for Tier 1 - PW", "publishedAt": "2026-10-10", "firstSeen": "2026-10-11T08:00:00"}, True, today)
    official = refine({"title": "Important notice regarding CGL 2026 candidates", "publishedAt": None, "firstSeen": "2026-10-11T08:00:00"}, False, today)
    ok = kept is not None and kept["kind"] == "admit-card" and kept["publisher"] == "PW" and old is None and junk is None and official is not None and official["kind"] == "other"
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} refine kept={bool(kept)} old={old} junk={junk} official_kept={bool(official)}")
    rows = collapse([
        {"examId": "x", "kind": "admit-card", "title": "SSC CGL 2026 Admit Card Out, download link", "publishedAt": "2026-10-10"},
        {"examId": "x", "kind": "admit-card", "title": "SSC CGL 2026 admit card out: download link here", "publishedAt": "2026-10-11"},
        {"examId": "x", "kind": "result", "title": "SSC CGL 2026 result", "publishedAt": "2026-10-11"},
    ])
    ok = len(rows) == 2 and max(r["alsoIn"] for r in rows) == 2 and any(r["publishedAt"] == "2026-10-11" and r["kind"] == "admit-card" for r in rows)
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} collapse -> {[(r['kind'], r['alsoIn']) for r in rows]}")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if "--test" in argv:
        return self_test()
    dry = "--dry-run" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    all_sources = load_json("sources.json", {"sources": []})["sources"]
    sources = [s for s in all_sources if not only or s["examId"] == only]
    news_names = {s["name"] for s in all_sources if "news.google" in s.get("url", "")}
    updates_file = load_json("updates.json", {"updatedAt": None, "updates": []})
    today = now_ist()
    # Stored items go through the same rules every run, so old prep articles and stale headlines fall out.
    existing = {}
    for u in updates_file.get("updates", []):
        r = refine(u, u.get("source") in news_names, today)
        if r:
            existing[r["id"]] = r
    baseline = len(updates_file.get("updates", [])) == 0  # first ever run: everything is "new", don't alert on it
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
            item = refine({"id": uid, "examId": src["examId"], "title": it["title"], "url": it["url"], "source": src["name"], "publishedAt": it.get("publishedAt"), "firstSeen": stamp}, src["name"] in news_names, today)
            if not item:
                continue
            existing[uid] = item
            new_count += 1
        mark = "ok  " if row["ok"] else "fail"
        print(f"[{mark}] {src['name']:<34} {row['items']:>3} items via {row['via'] or '-'}{'  ' + row['error'] if row['error'] else ''}")

    merged = sorted(collapse(list(existing.values())), key=lambda u: (u.get("publishedAt") or u.get("firstSeen") or ""), reverse=True)[:500]
    kinds: dict[str, int] = {}
    for u in merged:
        kinds[u.get("kind", "other")] = kinds.get(u.get("kind", "other"), 0) + 1
    print(f"{new_count} new items; {sum(1 for r in status_rows if r['ok'])}/{len(status_rows)} sources ok; {len(merged)} kept ({', '.join(f'{k}: {v}' for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]))})")
    if dry:
        print("dry-run: not writing")
        return 0
    save_json("updates.json", {"updatedAt": stamp, "baseline": baseline, "updates": merged})
    save_json("scrape_status.json", {"lastRun": stamp, "sources": status_rows})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
