#!/usr/bin/env python3
"""Scan job portals for fresher-friendly private roles that fit the profile.

Writes public/data/opportunities.json -> portal[] (capped, de-duplicated, expired after 30 days).
Rules (from profile.json):
  * experience: a listing qualifies only when its minimum experience is <= maxExperienceYears (0.5)
  * pay: private listings qualify only when the stated range reaches privateMinPayLakh (10 LPA)
    and its floor is at least privatePayFloorLakh (6 LPA); listings without a stated salary are dropped
  * role: the title must contain one of the role keywords and none of the exclusion terms
Usage: python portals.py [--dry-run] [--fixture path.json] [--test]
"""
from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from common import load_json, now_ist, save_json, today_ist
from fit import score

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CAP = 200
KEEP_DAYS = 30
TIMEOUT = 30

QUERIES = [
    "management trainee",
    "marketing trainee",
    "marketing executive fresher",
    "brand management",
    "market research analyst",
    "business analyst fresher",
    "product marketing associate",
    "leadership program MBA",
    "sales management trainee",
    "growth associate",
]
ROLE_RX = re.compile(
    r"\b(management trainee|marketing|brand|market research|business analyst|product (?:marketing|manager|analyst)|"
    r"growth|strategy|consultant|category|sales trainee|leadership|associate|analyst|officer|relationship manager|"
    r"account manager|customer success|business development|key account|client|partnership|program manager|"
    r"operations (?:associate|executive|manager|trainee)|graduate trainee|executive trainee)\b",
    re.I,
)
EXCLUDE_RX = re.compile(
    r"\b(engineer|developer|software|sde|devops|java|python|\.net|node|react|data scientist|machine learning|ml |ai engineer|"
    r"qa|tester|testing|android|ios|cloud|security|network|hardware|embedded|cad|mechanical|civil|electrical|chemical|"
    r"nurse|doctor|pharma(?:cist)?|chartered accountant|ca\b|company secretary|lawyer|legal|advocate|teacher|tutor|faculty|"
    r"telecall|bpo|voice process|delivery|driver|technician|intern(?:ship)?|freelance|part[- ]time|work from home|wfh)\b",
    re.I,
)
SOUTH_RX = re.compile(r"\b(chennai|hyderabad|bengaluru|bangalore|visakhapatnam|vizag|vijayawada|tirupati|coimbatore|kochi|mysuru|mysore|madurai|andhra|telangana|tamil nadu|karnataka|kerala|pan india|all india|remote|anywhere)\b", re.I)


# ───────────────────────── parsers ─────────────────────────
def parse_experience(text: str | None) -> float | None:
    """Minimum years of experience a listing asks for; None when it does not say."""
    if not text:
        return None
    t = text.lower().replace("–", "-")
    if re.search(r"\b(fresher|freshers|no experience|entry[- ]level|0 ?(?:-|to) ?\d)", t):
        return 0.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:yrs?|years?)", t)
    if m:
        return float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:yrs?|years?)", t)
    if m:
        return float(m.group(1))
    m = re.search(r"(\d+)\s*(?:-|to)?\s*(\d+)?\s*months?", t)
    if m:
        return int(m.group(1)) / 12
    return None


def parse_salary(text: str | None) -> tuple[float, float] | None:
    """(min_lakh, max_lakh) per annum, or None when the listing does not state a salary."""
    if not text:
        return None
    t = text.lower().replace("₹", " ").replace("rs.", " ").replace("rs", " ").replace("inr", " ").replace("–", "-")
    if "not disclosed" in t or "undisclosed" in t:
        return None
    monthly = bool(re.search(r"(/|per)\s*month|p\.?m\.?\b|monthly", t))
    unit = None
    if re.search(r"\b(lacs?|lakhs?|lpa|l\.p\.a|lac)\b", t) or re.search(r"\d\s*l\b", t):
        unit = "lakh"
    elif re.search(r"\b(cr|crore)s?\b", t):
        unit = "crore"
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", t)]
    nums = [n for n in nums if n > 0]
    if not nums:
        return None
    if unit == "lakh":
        vals = [n for n in nums if n < 1000]
    elif unit == "crore":
        vals = [n * 100 for n in nums if n < 100]
    else:
        vals = [n / 100000 for n in nums if n >= 10000]
        if not vals and monthly:
            vals = [n / 100000 for n in nums if n >= 1000]
    if not vals:
        return None
    if monthly:
        vals = [v * 12 for v in vals]
    lo, hi = min(vals[:2]), max(vals[:2])
    if hi > 500:
        return None
    return (round(lo, 1), round(hi, 1))


def fmt_pay(rng: tuple[float, float] | None) -> str | None:
    if not rng:
        return None
    lo, hi = rng
    f = lambda v: (f"{v:.0f}" if float(v).is_integer() else f"{v:.1f}")  # noqa: E731
    return f"₹{f(lo)} LPA" if lo == hi else f"₹{f(lo)}–{f(hi)} LPA"


def get(url: str, headers: dict | None = None, attempts: int = 2) -> requests.Response:
    last: Exception | None = None
    for i in range(attempts):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json, text/html;q=0.9, */*;q=0.8", "Accept-Language": "en-IN,en;q=0.9", **(headers or {})}, timeout=TIMEOUT)
            if r.status_code == 429 and i + 1 < attempts:
                time.sleep(3)
                continue
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5)
    raise last or RuntimeError("fetch failed")


def ms_to_iso(ms) -> str | None:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).date().isoformat()
    except Exception:  # noqa: BLE001
        return None


def find_key(obj, *names, depth: int = 4):
    """Depth-limited search for the first key whose lowercase name contains any of `names`."""
    if depth < 0 or not isinstance(obj, (dict, list)):
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if any(n in k.lower() for n in names) and not isinstance(v, (dict, list)):
                return v
        for v in obj.values():
            r = find_key(v, *names, depth=depth - 1)
            if r is not None:
                return r
    else:
        for v in obj[:5]:
            r = find_key(v, *names, depth=depth - 1)
            if r is not None:
                return r
    return None


# ───────────────────────── portals ─────────────────────────
def naukri(q: str) -> list[dict]:
    url = f"https://www.naukri.com/jobapi/v3/search?noOfResults=40&urlType=search_by_keyword&searchType=adv&keyword={requests.utils.quote(q)}&experience=0&k={requests.utils.quote(q)}&src=jobsearchDesk&latLong="
    data = get(url, {"appid": "109", "systemid": "Naukri", "gid": "LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE", "Referer": "https://www.naukri.com/"}).json()
    out = []
    for j in data.get("jobDetails", []) or []:
        ph = {p.get("type"): p.get("label") for p in j.get("placeholders", []) or []}
        link = j.get("jdURL") or ""
        out.append({
            "title": j.get("title") or "", "company": j.get("companyName") or "", "location": ph.get("location") or "",
            "url": link if link.startswith("http") else "https://www.naukri.com" + link,
            "salaryText": ph.get("salary"), "experienceText": ph.get("experience"),
            "postedAt": ms_to_iso(j.get("createdDate")), "description": (j.get("jobDescription") or "")[:600],
        })
    return out


def foundit(q: str) -> list[dict]:
    url = f"https://www.foundit.in/middleware/jobsearch?sort=1&limit=40&query={requests.utils.quote(q)}&experienceRanges=0~1&start=0"
    data = get(url, {"Referer": "https://www.foundit.in/"}).json()
    jobs = (data.get("jobSearchResponse") or {}).get("data") or data.get("data") or []
    out = []
    for j in jobs:
        lo, hi = j.get("minimumSalary"), j.get("maximumSalary")
        sal = f"{lo} - {hi} per annum" if lo and hi and float(hi) > 0 else None
        elo, ehi = j.get("minimumExperience"), j.get("maximumExperience")
        exp = f"{elo}-{ehi} years" if elo is not None else None
        link = j.get("seoJdUrl") or j.get("jdUrl") or ""
        out.append({
            "title": j.get("title") or "", "company": j.get("companyName") or "", "location": j.get("locations") or ", ".join(j.get("locationsList") or []),
            "url": link if link.startswith("http") else "https://www.foundit.in" + link,
            "salaryText": sal, "experienceText": exp, "postedAt": (j.get("createdAt") or j.get("postedAt") or "")[:10] or None,
            "description": (j.get("description") or "")[:600],
        })
    return out


def unstop(q: str) -> list[dict]:
    url = f"https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=40&oppstatus=open&searchTerm={requests.utils.quote(q)}"
    data = get(url, {"Referer": "https://unstop.com/"}).json()
    items = ((data.get("data") or {}).get("data")) if isinstance(data.get("data"), dict) else data.get("data")
    out = []
    for j in items or []:
        org = j.get("organisation") or {}
        lo = find_key(j, "min_salary", "minsalary", "min_ctc")
        hi = find_key(j, "max_salary", "maxsalary", "max_ctc")
        sal = f"{lo} - {hi} per annum" if lo and hi else None
        exp = find_key(j, "experience")
        link = j.get("public_url") or j.get("seo_url") or ""
        end = find_key(j, "end_regn_dt", "end_date", "deadline")
        out.append({
            "title": j.get("title") or "", "company": org.get("name") if isinstance(org, dict) else str(org or ""),
            "location": ", ".join(str(x.get("name", x)) if isinstance(x, dict) else str(x) for x in (j.get("locations") or j.get("jobLocation") or [])[:4]) if isinstance(j.get("locations") or j.get("jobLocation"), list) else str(j.get("locations") or ""),
            "url": link if link.startswith("http") else "https://unstop.com/" + link.lstrip("/"),
            "salaryText": sal, "experienceText": str(exp) if exp else None, "postedAt": None, "applyCloses": str(end)[:10] if end else None,
            "description": (j.get("details") or j.get("description") or "")[:600] if isinstance(j.get("details") or j.get("description"), str) else "",
        })
    return out


def linkedin(q: str) -> list[dict]:
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={requests.utils.quote(q)}&location=India&f_E=2&f_TPR=r604800&start=0"
    soup = BeautifulSoup(get(url).text, "lxml")
    out = []
    for li in soup.select("li"):
        a = li.select_one("a.base-card__full-link, a[href*='/jobs/view/']")
        if not a:
            continue
        title = (li.select_one(".base-search-card__title") or a).get_text(" ", strip=True)
        company = (li.select_one(".base-search-card__subtitle") or li.select_one(".hidden-nested-link"))
        loc = li.select_one(".job-search-card__location")
        sal = li.select_one(".job-search-card__salary-info")
        tm = li.select_one("time")
        out.append({
            "title": title, "company": company.get_text(" ", strip=True) if company else "", "location": loc.get_text(" ", strip=True) if loc else "",
            "url": a["href"].split("?")[0], "salaryText": sal.get_text(" ", strip=True) if sal else None, "experienceText": "entry level",
            "postedAt": tm.get("datetime") if tm else None, "description": "",
        })
    return out


def internshala(q: str) -> list[dict]:
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    url = f"https://internshala.com/jobs/keywords-{slug}/"
    soup = BeautifulSoup(get(url).text, "lxml")
    out = []
    for card in soup.select(".individual_internship"):
        a = card.select_one("a.job-title-href, h3 a, a[href*='/job/detail/']")
        if not a:
            continue
        text = card.get_text(" ", strip=True)
        comp = card.select_one(".company-name, .company_name, p.company-name")
        loc = card.select_one(".locations, .location_link, [class*=location]")
        sal_m = re.search(r"₹\s*[\d,.]+(?:\s*-\s*₹?\s*[\d,.]+)?\s*(?:/\s*month|/\s*year|LPA|per annum|per month)?", text, re.I)
        exp_m = re.search(r"(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*years?)(?:\s*\(?\s*(?:of)?\s*experience)?|fresher", text, re.I)
        href = a.get("href") or ""
        out.append({
            "title": a.get_text(" ", strip=True), "company": comp.get_text(" ", strip=True) if comp else "", "location": loc.get_text(" ", strip=True) if loc else "",
            "url": href if href.startswith("http") else "https://internshala.com" + href,
            "salaryText": sal_m.group(0) if sal_m else None, "experienceText": exp_m.group(0) if exp_m else None, "postedAt": None, "description": "",
        })
    return out


PORTALS = [("Naukri", naukri), ("Foundit", foundit), ("Unstop", unstop), ("LinkedIn", linkedin), ("Internshala", internshala)]


# ───────────────────────── pipeline ─────────────────────────
def qualify(raw: dict, profile: dict) -> tuple[dict | None, str]:
    title = (raw.get("title") or "").strip()
    company = (raw.get("company") or "").strip()
    if not title or not company:
        return None, "incomplete"
    hay = f"{title} {raw.get('description', '')}"
    if EXCLUDE_RX.search(title):
        return None, "excluded role"
    if not ROLE_RX.search(title):
        return None, "role mismatch"
    exp_min = parse_experience(raw.get("experienceText"))
    if exp_min is None:
        exp_min = parse_experience(hay)
    max_exp = float(profile.get("maxExperienceYears", 0.5))
    if exp_min is None:
        if not re.search(r"\b(trainee|fresher|graduate|campus|entry|associate|junior|program)\b", title, re.I):
            return None, "experience unknown"
        exp_min = 0.0
    if exp_min > max_exp:
        return None, f"needs {exp_min:g}+ yrs"
    sal = parse_salary(raw.get("salaryText")) or parse_salary(hay if "lpa" in hay.lower() or "lakh" in hay.lower() or "lac" in hay.lower() else None)
    if not sal:
        return None, "salary not stated"
    lo, hi = sal
    if hi < float(profile.get("privateMinPayLakh", 10)) or lo < float(profile.get("privatePayFloorLakh", 6)):
        return None, f"pay {fmt_pay(sal)}"
    locs = [x.strip() for x in re.split(r"[,/|]", raw.get("location") or "") if x.strip()][:6]
    cand = {"org": company, "post": title, "title": title, "sector": "private", "track": "private", "locations": locs, "payLakh": lo, "eligibility": raw.get("experienceText") or ""}
    fit, why = score(cand, profile)
    fit = min(100, fit + 10)  # stated salary clears the private bar
    why = [w for w in why if not w.startswith("needs")] + ([f"pay {fmt_pay(sal)}"] if f"pay ≥ {profile.get('minPayLakh')} LPA" not in why else [])
    if exp_min <= max_exp:
        why.append("fresher OK")
    if SOUTH_RX.search(" ".join(locs)):
        pass
    return {
        "org": company[:80], "post": title[:140], "title": title, "sector": "private", "track": "private",
        "eligibility": raw.get("experienceText") or "", "experienceText": raw.get("experienceText") or ("fresher" if exp_min == 0 else f"{exp_min:g} yrs"),
        "experienceMinYears": exp_min, "pay": fmt_pay(sal), "payLakh": lo, "payMinLakh": lo, "payMaxLakh": hi,
        "locations": locs, "link": raw.get("url"), "source": raw.get("source"), "sourceType": "portal",
        "fit": fit, "fitWhy": why, "status": "open", "postedAt": raw.get("postedAt"), "applyCloses": raw.get("applyCloses"),
        "examDate": None, "examDateType": "tba", "curated": False, "kind": "portal",
    }, "ok"


def dedupe_key(org: str, post: str) -> str:
    words = re.findall(r"[a-z0-9]+", post.lower())
    return re.sub(r"[^a-z0-9]", "", org.lower())[:18] + "|" + " ".join(words[:3])


def item_id(url: str, org: str, post: str) -> str:
    import hashlib

    return "portal-" + hashlib.sha1((url or org + post).encode()).hexdigest()[:12]


def fetch_all(fixture: str | None) -> tuple[list[dict], list[dict]]:
    """Returns (raw items with source, per-portal status)."""
    if fixture:
        raws = json.loads(Path(fixture).read_text())
        return raws, [{"name": "fixture", "ok": True, "fetched": len(raws)}]
    jobs = [(name, fn, q) for name, fn in PORTALS for q in QUERIES]

    def run(job):
        name, fn, q = job
        try:
            items = fn(q)
            for it in items:
                it["source"] = name
            return name, q, items, None
        except Exception as e:  # noqa: BLE001
            return name, q, [], str(e)[:120]

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, jobs))
    raws: list[dict] = []
    status: dict[str, dict] = {name: {"name": name, "ok": False, "fetched": 0, "errors": 0, "error": None} for name, _ in PORTALS}
    for name, q, items, err in results:
        st = status[name]
        if err:
            st["errors"] += 1
            st["error"] = err
            print(f"[fail] {name:<11} {q:<28} {err}")
        else:
            st["ok"] = True
            st["fetched"] += len(items)
            print(f"[ok  ] {name:<11} {q:<28} {len(items):>3} items")
        raws.extend(items)
    return raws, list(status.values())


def main(argv: list[str]) -> int:
    if "--test" in argv:
        return self_test()
    dry = "--dry-run" in argv
    fixture = argv[argv.index("--fixture") + 1] if "--fixture" in argv else None
    profile = load_json("profile.json", {})
    opp = load_json("opportunities.json", {"curated": [], "discovered": [], "portal": []})
    today = today_ist()
    stamp = now_ist().isoformat(timespec="seconds")
    keep_after = (today - timedelta(days=KEEP_DAYS)).isoformat()
    existing = {d["id"]: d for d in opp.get("portal", []) if (d.get("firstSeen") or "")[:10] >= keep_after}
    baseline = not opp.get("portal")
    seen = {dedupe_key(d["org"], d["post"]) for d in existing.values()}

    raws, status = fetch_all(fixture)
    reasons: dict[str, int] = {}
    new = 0
    for raw in raws:
        item, reason = qualify(raw, profile)
        reasons[reason] = reasons.get(reason, 0) + 1
        if not item:
            continue
        key = dedupe_key(item["org"], item["post"])
        uid = item_id(item["link"], item["org"], item["post"])
        if uid in existing:
            existing[uid]["lastSeen"] = stamp
            continue
        if key in seen:
            continue
        seen.add(key)
        item["id"] = uid
        item["firstSeen"] = stamp
        item["lastSeen"] = stamp
        existing[uid] = item
        new += 1
    merged = sorted(existing.values(), key=lambda d: ((d.get("payMinLakh") or 0), d.get("firstSeen") or ""), reverse=True)[:CAP]
    for d in merged:
        if d.get("applyCloses") and d["applyCloses"] < today.isoformat():
            d["status"] = "closed"
    print(f"{len(raws)} listings scanned, {new} new qualifying, {len(merged)} kept")
    print("  " + ", ".join(f"{k}: {v}" for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])))
    if dry:
        print("dry-run: not writing")
        return 0
    opp["portal"] = merged
    opp["portalAt"] = stamp
    opp["portalBaseline"] = baseline
    opp["portalStatus"] = [{**s, "scanned": s.get("fetched", 0)} for s in status]
    save_json("opportunities.json", opp)
    return 0


def self_test() -> int:
    cases = [
        ("10-15 Lacs PA", (10.0, 15.0)), ("₹ 12,00,000 - 18,00,000 P.A.", (12.0, 18.0)), ("Not Disclosed", None), ("8 LPA", (8.0, 8.0)),
        ("₹ 90,000 /month", (10.8, 10.8)), ("1000000 - 1500000 per annum", (10.0, 15.0)), ("1.2 Cr", (120.0, 120.0)), ("₹4 - 6 LPA", (4.0, 6.0)),
    ]
    bad = 0
    for s, want in cases:
        got = parse_salary(s)
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} salary {s!r:<36} -> {got}")
    for s, want in [("0-2 Yrs", 0.0), ("1-3 years", 1.0), ("Fresher", 0.0), ("2+ years", 2.0), ("entry level", 0.0), ("6 months", 0.5), (None, None)]:
        got = parse_experience(s)
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} exp    {s!r:<36} -> {got}")
    profile = load_json("profile.json", {})
    raws = [
        {"title": "Management Trainee - Marketing", "company": "Hindustan Unilever", "location": "Mumbai, Chennai", "url": "https://x/1", "salaryText": "12-15 Lacs PA", "experienceText": "0-1 Yrs", "source": "Naukri"},
        {"title": "Marketing Executive", "company": "ABC Pvt Ltd", "location": "Hyderabad", "url": "https://x/2", "salaryText": "3-5 Lacs PA", "experienceText": "0-2 Yrs", "source": "Naukri"},
        {"title": "Brand Manager", "company": "XYZ", "location": "Bengaluru", "url": "https://x/3", "salaryText": "18-25 Lacs PA", "experienceText": "3-6 Yrs", "source": "Naukri"},
        {"title": "Software Engineer Trainee", "company": "TCS", "location": "Chennai", "url": "https://x/4", "salaryText": "10-12 Lacs PA", "experienceText": "0-1 Yrs", "source": "Naukri"},
        {"title": "Business Analyst", "company": "Deloitte", "location": "Hyderabad", "url": "https://x/5", "salaryText": "Not Disclosed", "experienceText": "0-1 Yrs", "source": "Naukri"},
    ]
    for r in raws:
        item, reason = qualify(r, profile)
        print(f"{reason:<20} {r['company']:<20} {r['title']:<32} {(item or {}).get('fit', '')} {(item or {}).get('pay', '')}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
