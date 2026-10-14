#!/usr/bin/env python3
"""Discover openings that fit the profile from news / aggregator feeds.

Appends to public/data/opportunities.json -> discovered[] (capped, de-duplicated),
scoring each with fit.py. Usage: python discover.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import requests

from common import load_json, now_ist, save_json, today_ist
from fit import score
from scrape import UA, date_from_text, fetch, item_id, parse_markdown, parse_rss

DEADLINE_RX = re.compile(r"(last date|apply by|closes? on|till|upto|up to|before)[^0-9]{0,25}(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}\s+\w+\s+\d{4})", re.I)
ORG_RX = re.compile(r"^([A-Z][A-Za-z&.' ]{2,40}?)\s+(recruitment|notification|vacancy|hiring|jobs?|bharti)", re.I)
MIN_FIT = 40
# Titles that are about an exam already in progress, not a new opening.
NOISE_RX = re.compile(r"\b(answer key|cut ?off|hall ticket|admit card|call letter|result|score ?card|merit list|previous year|question papers?|syllabus|exam pattern|exam analysis|expected questions|mock test|preparation|study plan|salary structure|walk-?in|interview schedule|document verification|dv schedule|final select)\b", re.I)


def is_noise(title: str) -> bool:
    return bool(NOISE_RX.search(title))


def dedupe_key(org: str, post: str) -> str:
    words = re.findall(r"[a-z0-9]+", post.lower())
    return re.sub(r"[^a-z0-9]", "", org.lower())[:18] + "|" + " ".join(words[:2])
SECTOR_RX = [
    ("regulator", r"\b(sebi|rbi|nabard|sidbi|irdai|pfrda|nhb|exim|ifsca|reserve bank)\b"),
    ("insurance", r"\b(lic|niacl|nicl|oicl|uiic|gic|ecgc|aic|insurance|assurance)\b"),
    ("bank", r"\b(bank|ibps|sbi|pnb|canara|union bank|bob|grameena|gramin|cooperative)\b"),
    ("state", r"\b(appsc|tspsc|tgpsc|tnpsc|kpsc|psc|state government|govt of)\b"),
    ("psu", r"\b(psu|limited|ltd|corporation|ntpc|sail|bhel|ongc|gail|hpcl|bpcl|iocl|nhpc|nlc|coal india|power grid|rinl|fci|concor|aai|airports|railtel|ircon|rites|hudco|nsc|nfl|rcfl|iffco|kribhco|cotton corporation)\b"),
    ("nbfc", r"\b(nbfc|housing finance|finance ltd|capital ltd|hfl)\b"),
]


def guess_sector(title: str) -> str:
    t = title.lower()
    for sector, rx in SECTOR_RX:
        if re.search(rx, t):
            return sector
    return "central" if re.search(r"\b(upsc|ssc|ministry|niti|government of india|central)\b", t) else ""
CAP = 300


def guess_org_post(title: str) -> tuple[str, str]:
    m = ORG_RX.match(title)
    org = m.group(1).strip() if m else title.split(" ")[0]
    post = re.sub(r"\b(recruitment|notification|20\d\d|out|apply online|apply now|for|posts?|vacanc(y|ies))\b", " ", title, flags=re.I)
    post = re.sub(r"\s+", " ", post).strip(" :-–|")
    return org[:60], (post or title)[:140]


def guess_deadline(text: str) -> str | None:
    m = DEADLINE_RX.search(text)
    if m:
        d = date_from_text(m.group(2))
        if d:
            return d
        try:
            from dateutil import parser as dp  # type: ignore

            return dp.parse(m.group(2), dayfirst=True).date().isoformat()
        except Exception:  # noqa: BLE001
            return None
    return None


def scrape_source(src: dict) -> list[dict]:
    try:
        if src["type"] == "rss":
            return parse_rss({"url": src["url"], "keywords": []}, fetch(src["url"]).text)
        r = requests.get(f"https://r.jina.ai/{src['url']}", headers={"User-Agent": UA, "Accept": "text/plain"}, timeout=45)
        r.raise_for_status()
        return parse_markdown({"url": src["url"], "keywords": []}, r.text)
    except Exception as e:  # noqa: BLE001
        print(f"[fail] {src['name']}: {str(e)[:100]}")
        return []


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    profile = load_json("profile.json", {})
    sources = load_json("discovery_sources.json", {"sources": []})["sources"]
    opp = load_json("opportunities.json", {"curated": [], "discovered": []})
    existing = {d["id"]: d for d in opp.get("discovered", []) if not is_noise(d.get("title", ""))}
    baseline = len(existing) == 0
    stamp = now_ist().isoformat(timespec="seconds")
    today = today_ist()
    stale_cutoff = (today - timedelta(days=21)).isoformat()
    new = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(scrape_source, sources))

    seen_keys: set[str] = {dedupe_key(d.get("org", ""), d.get("post", "")) for d in existing.values()}
    for src, items in zip(sources, results):
        kept = 0
        for it in items:
            title = it["title"]
            if is_noise(title):
                continue
            if any(t in title.lower() for t in profile.get("excludeTerms", [])) and not any(r in title.lower() for r in profile.get("roles", [])):
                continue
            org, post = guess_org_post(title)
            sector = guess_sector(title)
            cand = {"org": org, "post": post, "title": title, "sector": sector, "track": src.get("track", "general"), "locations": []}
            fit, why = score(cand, profile)
            if fit < MIN_FIT:
                continue
            uid = item_id("discover", it["url"], title)
            if uid in existing:
                continue
            key = dedupe_key(org, post)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deadline = guess_deadline(title)
            pub = it.get("publishedAt")
            if pub and pub < stale_cutoff and not deadline:
                continue
            existing[uid] = {
                "id": uid, "org": org, "post": post, "title": title, "track": src.get("track", "general"), "sector": sector,
                "eligibility": "", "applyCloses": deadline, "examDate": None, "examDateType": "tba", "locations": [],
                "link": it["url"], "source": src["name"], "sourceType": "aggregator" if "feed" in src["name"].lower() or "reader" in src["name"].lower() else "news",
                "fit": fit, "fitWhy": why, "status": "open" if (deadline is None or deadline >= today.isoformat()) else "closed",
                "publishedAt": pub, "firstSeen": stamp, "curated": False,
            }
            new += 1
            kept += 1
        print(f"[ok  ] {src['name']:<36} {len(items):>3} items, {kept} kept")

    merged = sorted(existing.values(), key=lambda d: (d.get("firstSeen") or ""), reverse=True)[:CAP]
    # Expire: deadline passed -> closed
    for d in merged:
        if d.get("applyCloses") and d["applyCloses"] < today.isoformat():
            d["status"] = "closed"
    print(f"{new} new fitting openings; {len(merged)} kept")
    if dry:
        print("dry-run: not writing")
        return 0
    opp["discovered"] = merged
    opp["discoveredAt"] = stamp
    opp["discoverBaseline"] = baseline
    save_json("opportunities.json", opp)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
