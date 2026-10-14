#!/usr/bin/env python3
"""Scan job portals for fresher-friendly private roles that fit the profile.

Writes public/data/opportunities.json -> portal[] (capped, de-duplicated, expired after 30 days).
Rules (from profile.json):
  * experience: a listing qualifies only when its minimum experience is <= maxExperienceYears (0.5)
  * pay: private listings qualify only when the stated range reaches privateMinPayLakh (10 LPA)
    and its floor is at least privatePayFloorLakh (6 LPA); listings without a stated salary are dropped
  * role: the title must contain one of the role keywords and none of the exclusion terms
Usage: python portals.py [--dry-run] [--fixture path.json] [--only Name,Name] [--test]
"""
from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, NamedTuple

import requests
from bs4 import BeautifulSoup

from common import env, load_json, now_ist, save_json, today_ist
from fit import score

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CAP = 200
KEEP_DAYS = 30
TIMEOUT = 30
DETAIL_CAP = 320          # listings opened per run to read the real requirements
TIME_BUDGET = 420         # seconds of search fetching before the rest is skipped
FIXTURES = Path(__file__).parent / "fixtures"

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
SENIOR_RX = re.compile(r"\b(senior|sr\.?|head of|head\b|lead\b|director|vp\b|vice president|principal|chief|avp|agm|dgm|gm\b|specialist|expert|architect|l[2-9]\b|ii\b|iii\b)\b", re.I)
MANAGER_RX = re.compile(r"\bmanager\b", re.I)
JUNIOR_RX = re.compile(r"\b(trainee|fresher|graduate|campus|associate|junior|entry|apprentice|assistant|deputy)\b", re.I)
FRESHER_TITLE_RX = re.compile(r"\b(trainee|fresher|graduate|campus|programme|program|junior|entry[- ]level|voyage|leadership|rotational|early career|young)\b", re.I)
SALES_SPAM_RX = re.compile(r"\b(business development|bde|bda|inside sales|field sales|tele ?sales|tele ?call|cold call|door to door|insurance (?:agent|advisor)|recruiter|talent acquisition|hr executive|collection|loan officer|dsa\b|channel partner)\b", re.I)
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
    monthly = bool(re.search(r"(/|per|an?)\s*month|p\.?m\.?\b|monthly", t))
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


def _date_any(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return ms_to_iso(v if v > 10**11 else v * 1000)
    m = re.search(r"\d{4}-\d{2}-\d{2}", str(v))
    return m.group(0) if m else None


def num(v) -> float | None:
    """A number out of a scalar or a small dict like {"amount": 1200000} / {"min": 10, "max": 12}."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"\d[\d,]*(?:\.\d+)?", v)
        return float(m.group(0).replace(",", "")) if m else None
    if isinstance(v, dict):
        for k in ("amount", "value", "min", "minimum", "from", "max", "maximum", "to"):
            if k in v:
                return num(v[k])
        for x in v.values():
            r = num(x)
            if r is not None:
                return r
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
    variants = [
        {"appid": "109", "systemid": "Naukri", "Accept": "application/json", "gid": "LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE", "Referer": "https://www.naukri.com/", "Content-Type": "application/json"},
        {"appid": "109", "systemid": "109", "Accept": "application/json", "Referer": "https://www.naukri.com/"},
    ]
    data = None
    last = None
    for h in variants:
        try:
            data = get(url, h, attempts=1).json()
            break
        except Exception as e:  # noqa: BLE001
            last = e
    if data is None:
        # Naukri answers "recaptcha required" to datacenter IPs and renders its search page client-side,
        # so neither the API nor the reader fallback yields cards from GitHub Actions. Report it plainly.
        raise RuntimeError(f"blocked (recaptcha) — {str(last)[:60]}")
    if not isinstance(data, dict) or "jobDetails" not in data:
        if "captcha" in json.dumps(data)[:400].lower():
            raise RuntimeError("blocked (recaptcha)")
        raise RuntimeError(f"parse (no jobDetails: {json.dumps(data)[:80]})")
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


NAUKRI_CARD_RX = re.compile(r"\[([^\]]{6,140})\]\((https://www\.naukri\.com/job[^)\s]+)\)")


def naukri_reader(q: str) -> list[dict]:
    """Fallback: the rendered search page through the r.jina.ai reader, parsed from markdown."""
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    page = f"https://www.naukri.com/{slug}-jobs?experience=0"
    r = requests.get(f"https://r.jina.ai/{page}", headers={"User-Agent": UA, "Accept": "text/plain", "X-Return-Format": "markdown"}, timeout=60)
    r.raise_for_status()
    md = r.text
    links = re.findall(r"\[([^\]]{3,80})\]\((https?://[^)\s]+)\)", md)
    jl = [l for l in links if "naukri.com/job" in l[1] or "job-listings" in l[1]]
    print(f"[sample] Naukri reader {len(md)} chars, {len(links)} links, {len(jl)} job links; first: {links[8:14]!r}")
    out = []
    cards = list(NAUKRI_CARD_RX.finditer(md))
    for i, m in enumerate(cards):
        title, link = m.group(1).strip(), m.group(2)
        chunk = md[m.end(): cards[i + 1].start() if i + 1 < len(cards) else m.end() + 900][:900]
        comp = re.search(r"\n\s*\[?([A-Z][^\n\]]{2,60}?)\]?\s*(?:\(https://www\.naukri\.com/[^)]*\))?\s*\n", chunk)
        exp = re.search(r"(\d+\s*-\s*\d+\s*Yrs?|\d+\+?\s*Yrs?|Fresher)", chunk, re.I)
        sal = re.search(r"(\d[\d.,]*\s*-\s*\d[\d.,]*\s*(?:Lacs|Lakhs?|LPA)\s*P?A?|Not disclosed)", chunk, re.I)
        loc = re.search(r"\n\s*([A-Z][A-Za-z ,/()]{2,80})\s*\n", chunk[chunk.find(exp.group(0)) if exp else 0:])
        out.append({
            "title": title, "company": comp.group(1).strip() if comp else "", "location": loc.group(1).strip() if loc else "",
            "url": link.split("?")[0], "salaryText": sal.group(0) if sal else None, "experienceText": exp.group(0) if exp else None, "postedAt": None, "description": "",
        })
    return out


def foundit(q: str) -> list[dict]:
    url = f"https://www.foundit.in/middleware/jobsearch?sort=1&limit=40&query={requests.utils.quote(q)}&experienceRanges=0~1&start=0"
    data = get(url, {"Referer": "https://www.foundit.in/"}).json()
    jobs = (data.get("jobSearchResponse") or {}).get("data") or data.get("data") or []
    if not isinstance(jobs, list):
        jobs = []
    out = []
    for j in jobs:
        lo, hi = num(j.get("minimumSalary")), num(j.get("maximumSalary"))
        if (lo is None or hi is None) and isinstance(j.get("salary"), (dict, str)):
            lo, hi = num(find_key(j.get("salary"), "min", "from") if isinstance(j.get("salary"), dict) else j.get("salary")), num(find_key(j.get("salary"), "max", "to") if isinstance(j.get("salary"), dict) else j.get("salary"))
        sal = f"{lo:.0f} - {hi:.0f} per annum" if lo and hi and hi > 0 else None
        elo, ehi = num(j.get("minimumExperience")), num(j.get("maximumExperience"))
        if elo == 0 and (ehi == 0 or ehi is None):
            elo = ehi = None  # Foundit reports 0-0 when the poster left it blank
        exp = f"{elo:g}-{ehi:g} years" if elo is not None and ehi is not None else (f"{elo:g} years" if elo is not None else None)
        link = j.get("seoJdUrl") or j.get("jdUrl") or ""
        locs = j.get("locations")
        if isinstance(locs, list):
            locs = ", ".join(str(x.get("name", x)) if isinstance(x, dict) else str(x) for x in locs[:5])
        comp = j.get("companyName")
        if isinstance(comp, dict):
            comp = comp.get("name") or ""
        out.append({
            "title": j.get("title") or "", "company": comp or "", "location": locs or ", ".join(j.get("locationsList") or []),
            "url": link if link.startswith("http") else "https://www.foundit.in" + link,
            "salaryText": sal, "experienceText": exp, "postedAt": _date_any(j.get("createdAt") or j.get("postedAt") or j.get("updatedAt")),
            "description": (j.get("description") or "")[:600],
        })
    return out


def _locs(v) -> str:
    if isinstance(v, list):
        return ", ".join(str((x.get("city") or x.get("name") or x.get("location") or "")) if isinstance(x, dict) else str(x) for x in v[:5] if x)
    if isinstance(v, dict):
        return str(v.get("city") or v.get("name") or "")
    return str(v or "")


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
            "location": _locs(j.get("locations") or j.get("jobLocation") or j.get("job_locations")),
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


def _slug(q: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")


def _text(el) -> str:
    return el.get_text(" ", strip=True) if el else ""


def _zero_sample(name: str, text: str, hint: str = "", link_pat: str | None = None) -> None:
    """Print what a page that was fetched fine but yielded no cards looks like, so the parser can be fixed from the log."""
    head = re.sub(r"\s+", " ", text[:400])
    print(f"[sample] {name}: {len(text)} chars{(' · ' + hint) if hint else ''}; head: {head!r}")
    print(f"[sample] {name}: next_data={'__NEXT_DATA__' in text} rsc_pushes={text.count('__next_f.push')} ldjson={text.count('application/ld+json')} "
          f"links={len(re.findall(link_pat, text)) if link_pat else '-'}")
    rsc = _rsc_text(text)
    if rsc:
        print(f"[sample] {name}: rsc {len(rsc)} chars; head: {re.sub(r'\s+', ' ', rsc[:500])!r}")
    nd = _next_data(text)
    if nd:
        pp = (nd.get("props") or {}).get("pageProps") or {}
        print(f"[sample] {name}: __NEXT_DATA__ keys={list(nd)[:8]} pageProps keys={list(pp)[:20] if isinstance(pp, dict) else type(pp).__name__}")
        blob = json.dumps(pp if pp else nd)
        print(f"[sample] {name}: pageProps head: {blob[:600]!r}")
        for k, v in (pp.items() if isinstance(pp, dict) else []):
            if isinstance(v, (dict, list)) and len(json.dumps(v)) > 800:
                shape = list(v)[:25] if isinstance(v, dict) else f"list[{len(v)}] first={list(v[0])[:15] if v and isinstance(v[0], dict) else str(v[:1])[:200]}"
                print(f"[sample] {name}: pageProps.{k} ({len(json.dumps(v))} chars): {shape}")
                if isinstance(v, dict):
                    for k2, v2 in v.items():
                        if isinstance(v2, (dict, list)) and len(json.dumps(v2)) > 600:
                            print(f"[sample] {name}: pageProps.{k}.{k2} ({len(json.dumps(v2))} chars): {json.dumps(v2)[:400]!r}")
        for hit in re.finditer(r'"(?:api|endpoint|url|baseUrl|apiHost)[A-Za-z]*"\s*:\s*"((?:https?:)?//[^"]{10,160})"', blob):
            print(f"[sample] {name}: api-ish url: {hit.group(1)}")
            break
        hit = re.search(r'"(job[A-Za-z_]{2,20})"\s*:', blob)
        if hit:
            print(f"[sample] {name}: first job-ish key {hit.group(1)!r} at: {blob[max(0, hit.start() - 150): hit.start() + 350]!r}")
    print(f"[sample] {name}: 'yrs' mentions={len(re.findall(r'\byrs?\b', text, re.I))} api paths={sorted(set(re.findall(r'(?:https?:)?//[a-z0-9.-]*iimjobs\.com/[a-z0-9_./-]*api[a-z0-9_./-]*', text)))[:6]}")
    for label, hay in (("html", text), ("rsc", rsc)):
        m = re.search(link_pat, hay) if link_pat and hay else None
        if m:
            print(f"[sample] {name}: around first link in {label}: {hay[max(0, m.start() - 400): m.start() + 500]!r}")
            break
    m = re.search(r"<(?:li|div|article)[^>]{0,200}(?:job|card|tuple)[^>]{0,200}>", text, re.I)
    if m:
        print(f"[sample] {name}: first job-ish tag at {m.start()}: {text[m.start(): m.start() + 400]!r}")


# ── generic record extraction: JSON-LD, __NEXT_DATA__, Next.js RSC payloads ──
TITLE_KEYS = ("jJT", "jobTitle", "job_title", "jobtitle", "title", "designation", "roleTitle", "jobName")
COMPANY_KEYS = ("jCName", "companyName", "company_name", "company", "organisation", "organization", "hiringOrganization", "recruiterName", "employer", "orgName", "employerName")
URL_KEYS = ("url", "jobUrl", "jobURL", "jSlug", "seo_url", "seoUrl", "slug", "link", "applyUrl", "detailUrl", "jdURL", "jdUrl", "href", "jobLink", "canonicalUrl")
SALARY_KEYS = ("jSal", "salary", "ctc", "payRange", "baseSalary", "compensation", "salaryRange", "package")
EXP_KEYS = ("jExp", "experience", "exp", "experienceRequirements", "experienceText", "expRange", "yearsOfExperience")
DATE_KEYS = ("jPDate", "postedDate", "datePosted", "createdAt", "postedOn", "posted_at", "created", "publishedAt", "jobPostedDate")
DESC_KEYS = ("jJD", "description", "jd", "snippet", "summary", "jobDescription", "shortDescription")
RECORD_KEY_RX = re.compile(r'"(?:jJT|jobTitle|job_title|jobtitle|title|designation|roleTitle|jobName)"\s*:\s*"')


def _rsc_text(html: str) -> str:
    """Concatenated, unescaped Next.js app-router payloads (self.__next_f.push([1,"..."]))."""
    parts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)', html):
        try:
            parts.append(json.loads('"' + m.group(1) + '"'))
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(parts)


def _balanced_object(text: str, start: int, limit: int = 8000) -> str | None:
    depth, in_str, esc = 0, False, False
    for i in range(start, min(len(text), start + limit)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start: i + 1]
    return None


def _json_records(text: str, max_records: int = 300) -> list[dict]:
    """Every JSON object in `text` that carries both a title-ish and a company-ish key (smallest enclosing object wins)."""
    out, seen_starts = [], set()
    for m in RECORD_KEY_RX.finditer(text):
        pos = m.start()
        for _ in range(4):
            start = text.rfind("{", max(0, pos - 4000), pos)
            if start < 0 or start in seen_starts:
                break
            seen_starts.add(start)
            raw = _balanced_object(text, start)
            if raw is None:
                break
            try:
                obj = json.loads(raw)
            except Exception:  # noqa: BLE001
                pos = start
                continue
            if isinstance(obj, dict) and _pick(obj, *TITLE_KEYS) and _pick(obj, *COMPANY_KEYS):
                out.append(obj)
                break
            pos = start
        if len(out) >= max_records:
            break
    return out


def _ldjson_jobs(html: str) -> list[dict]:
    """schema.org JobPosting objects embedded as JSON-LD."""
    jobs: list[dict] = []

    def walk(o, depth=0):
        if depth > 6:
            return
        if isinstance(o, dict):
            t = o.get("@type")
            if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                jobs.append(o)
            for v in o.values():
                walk(v, depth + 1)
        elif isinstance(o, list):
            for v in o:
                walk(v, depth + 1)

    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            walk(json.loads(m.group(1).strip()))
        except Exception:  # noqa: BLE001
            continue
    out = []
    for j in jobs:
        org = j.get("hiringOrganization") or {}
        locs = j.get("jobLocation") or []
        if isinstance(locs, dict):
            locs = [locs]
        loc = ", ".join(str(((x.get("address") or {}) if isinstance(x, dict) else {}).get("addressLocality") or "") for x in locs if isinstance(x, dict)).strip(", ")
        bs = j.get("baseSalary") or {}
        val = bs.get("value") if isinstance(bs, dict) else None
        sal = None
        if isinstance(val, dict) and (val.get("minValue") or val.get("value")):
            lo, hi = val.get("minValue") or val.get("value"), val.get("maxValue") or val.get("value")
            unit = (val.get("unitText") or "YEAR").lower()
            sal = f"{lo} - {hi} per {'month' if 'month' in unit else 'annum'}"
        exp = j.get("experienceRequirements")
        if isinstance(exp, dict):
            exp = f"{exp.get('monthsOfExperience', 0)} months" if exp.get("monthsOfExperience") is not None else None
        out.append({
            "title": str(j.get("title") or ""), "company": str(org.get("name") if isinstance(org, dict) else org or ""), "location": loc,
            "url": str(j.get("url") or ""), "salaryText": sal, "experienceText": str(exp) if exp else None,
            "postedAt": _date_any(j.get("datePosted")), "description": re.sub(r"<[^>]+>", " ", str(j.get("description") or ""))[:600],
        })
    return out


def _records_to_raws(records: list[dict], base: str) -> list[dict]:
    out, seen = [], set()
    for j in records:
        title = _pick(j, *TITLE_KEYS)
        comp = _pick(j, *COMPANY_KEYS)
        if isinstance(comp, dict):
            comp = comp.get("name") or comp.get("companyName") or comp.get("title") or ""
        link = _pick(j, *URL_KEYS) or ""
        if isinstance(link, dict):
            link = link.get("url") or link.get("href") or ""
        link = str(link)
        if link and not link.startswith("http"):
            link = base.rstrip("/") + "/" + link.lstrip("/")
        key = link or (str(title) + "|" + str(comp))
        if key in seen:
            continue
        seen.add(key)
        sal = _pick(j, *SALARY_KEYS)
        if isinstance(sal, dict):
            lo, hi = num(_pick(sal, "min", "from", "minValue")), num(_pick(sal, "max", "to", "maxValue"))
            sal = f"{lo:.0f} - {hi:.0f} per annum" if lo and hi else None
        exp = _pick(j, *EXP_KEYS)
        if exp is None and (j.get("minExp") is not None or j.get("minExperience") is not None):
            lo, hi = num(j.get("minExp", j.get("minExperience"))), num(j.get("maxExp", j.get("maxExperience")))
            exp = f"{lo:g}-{hi:g} yrs" if lo is not None and hi is not None else (f"{lo:g} yrs" if lo is not None else None)
        if isinstance(exp, dict):
            exp = f"{num(_pick(exp, 'min', 'from')) or 0:g}-{num(_pick(exp, 'max', 'to')) or 0:g} yrs"
        desc = _pick(j, *DESC_KEYS)
        out.append({
            "title": str(title), "company": str(comp or ""), "location": _locs(_pick(j, "jLoc", "location", "locations", "city", "jobLocation", "cities")),
            "url": link, "salaryText": str(sal) if sal and not isinstance(sal, (dict, list)) else None,
            "experienceText": str(exp) if exp and not isinstance(exp, (dict, list)) else None,
            "postedAt": _date_any(_pick(j, *DATE_KEYS)), "description": re.sub(r"<[^>]+>", " ", str(desc or ""))[:600],
        })
    return out


def _embedded_jobs(html: str, base: str) -> list[dict]:
    """Job records from JSON-LD, then __NEXT_DATA__, then RSC payloads, then any inline JSON."""
    items = _ldjson_jobs(html)
    if items:
        return items
    nd = _next_data(html)
    if nd:
        items = _records_to_raws(_json_records(json.dumps(nd)), base)
        if items:
            return items
    rsc = _rsc_text(html)
    if rsc:
        items = _records_to_raws(_json_records(rsc), base)
        if items:
            return items
    return _records_to_raws(_json_records(html), base)


def _reader_sample(name: str, md: str) -> None:
    links = re.findall(r"\]\((https?://[^)\s]+)\)", md)
    print(f"[sample] {name} reader {len(md)} chars, {len(links)} links; head: {re.sub(r'\s+', ' ', md[:500])!r}")
    print(f"[sample] {name} reader links: {[l[:90] for l in links[:12]]}")


def parse_generic_md(md: str, link_rx: re.Pattern, name: str = "reader") -> list[dict]:
    """Job cards out of reader markdown: each matching link is a title; the lines after it carry company / experience / pay / place."""
    marker = _reader_blocked(md)
    if marker:
        raise RuntimeError(f"blocked (cloudflare: {marker})")
    code = _reader_upstream_error(md)
    if code:
        raise RuntimeError(f"blocked (http {code})")
    out, seen = [], set()
    for title, link, chunk in _md_cards(md, link_rx):
        key = link.split("?")[0]
        if key in seen or len(title) < 4:
            continue
        seen.add(key)
        out.append({
            "title": title, "company": _md_line(chunk, r"\n\s*\**\[?([A-Z][^\n*\]]{2,60}?)\]?\**\s*(?:\(https?://[^)]*\))?\s*\n") or "",
            "location": _md_line(chunk, CITY_LINE_RX) or "",
            "url": key, "salaryText": _md_line(chunk, r"((?:rs\.?|₹)\s*[\d.,]+\s*(?:-\s*[\d.,]+)?\s*(?:lacs?|lakhs?|lpa|p\.?a\.?|per annum|/\s*month|a month)[^\n]{0,12}|\d[\d.,]*\s*-\s*\d[\d.,]*\s*(?:lacs?|lakhs?|lpa)[^\n]{0,8})"),
            "experienceText": _md_line(chunk, r"((?:\d+\s*(?:-|to)\s*\d+|\d+\+?)\s*(?:yrs?|years?)|fresher)"), "postedAt": None, "description": chunk[:600],
        })
    if not out:
        _reader_sample(name, md)
        raise RuntimeError("blocked (reader: no job links)")
    return out


BLOCK_MARKERS = ("just a moment", "verify you are human", "additional verification required", "security check", "access denied", "are you a human", "cf-chl", "enable javascript and cookies", "request blocked")


def _reader(url: str, timeout: int = 45) -> str:
    """The rendered page as markdown via the r.jina.ai reader (works for some JS-only sites)."""
    r = requests.get(f"https://r.jina.ai/{url}", headers={"User-Agent": UA, "Accept": "text/plain", "X-Return-Format": "markdown"}, timeout=timeout)
    if r.status_code >= 400:
        raise RuntimeError(f"blocked (reader http {r.status_code})")
    return r.text


def _reader_html(url: str, timeout: int = 75, wait_for: str | None = None) -> str:
    """The page rendered by the reader's browser, as HTML (keeps JSON-LD / __NEXT_DATA__ / RSC payloads intact)."""
    headers = {"User-Agent": UA, "Accept": "text/html", "X-Return-Format": "html", "X-No-Cache": "true", "X-Timeout": "30"}
    if wait_for:
        headers["X-Wait-For-Selector"] = wait_for
    r = requests.get(f"https://r.jina.ai/{url}", headers=headers, timeout=timeout)
    if r.status_code >= 400:
        raise RuntimeError(f"blocked (reader http {r.status_code})")
    code = _reader_upstream_error(r.text)
    if code:
        raise RuntimeError(f"blocked (http {code})")
    return r.text


def _reader_upstream_error(text: str) -> str | None:
    """The reader relays the target's own error page ("Warning: Target URL returned error 403: Forbidden")."""
    m = re.search(r"Target URL returned error (\d{3})", text[:1200])
    return m.group(1) if m else None


def _link_shapes(text: str, host: str) -> list[str]:
    """Distinct first path segments of links to `host` with counts, to spot the job-detail URL pattern from the log."""
    counts: dict[str, int] = {}
    for m in re.finditer(r"https?://(?:www\.)?" + re.escape(host) + r"(/[^\s\"'<>)?#]*)", text):
        seg = "/".join(m.group(1).split("/")[:2])
        counts[seg] = counts.get(seg, 0) + 1
    return [f"{k} ×{v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])[:15]]


def _reader_blocked(md: str) -> str | None:
    low = md[:4000].lower()
    for m in BLOCK_MARKERS:
        if m in low:
            return m
    return None


def _md_cards(md: str, link_rx: re.Pattern) -> list[tuple[str, str, str]]:
    """(title, url, chunk-after-link) for every markdown link matching link_rx."""
    hits = list(link_rx.finditer(md))
    out = []
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else m.end() + 900
        out.append((m.group(1).strip(), m.group(2), md[m.end(): end][:900]))
    return out


def _md_line(chunk: str, rx: str) -> str | None:
    m = re.search(rx, chunk, re.I)
    return m.group(1).strip() if m else None


def post_json(url: str, payload: dict, headers: dict | None = None) -> dict:
    r = requests.post(url, json=payload, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


# ── iimjobs (MBA-focused; listing is public, detail pages need a login) ──
def _api_hints(html: str, base: str, host_word: str) -> list[str]:
    """API hosts/paths referenced by the page's JS chunks (for a listing that is fetched client-side)."""
    hints: set[str] = set()
    srcs = re.findall(r'<script[^>]+src="([^"]+/_next/static/[^"]+\.js)"', html)
    picked = [u for u in srcs if re.search(r"pages/|app/|main-|webpack", u)][:4] or srcs[:3]
    for src in picked:
        try:
            js = requests.get(src if src.startswith("http") else base + src, headers={"User-Agent": UA}, timeout=20).text
        except Exception as e:  # noqa: BLE001
            print(f"[sample] chunk {src[-60:]}: {str(e)[:80]}")
            continue
        for m in re.finditer(r'["\'](https?://[a-z0-9.-]*' + re.escape(host_word) + r'[^"\'\s]{0,80})["\']', js):
            hints.add(m.group(1))
        for m in re.finditer(r'["\'](/(?:api|v\d|search|jobs?)[A-Za-z0-9_./-]{3,60})["\']', js):
            hints.add(m.group(1))
    return sorted(hints)[:40]


IIMJOBS_ROLE_WORD_RX = re.compile(r"\b(?:manager|trainee|analyst|associate|executive|lead|head|officer|specialist|consultant|intern|director|partner|engineer|role|program|marketing|brand|sales|product|research|strategy|growth|category|chief|vp|president|founder|fresher|mba|graduate|management|scientist|developer|designer|writer|strategist|leader|modeler|planner|coordinator|recruiter|buyer|merchandiser)\b", re.I)
IIMJOBS_CARD_RX = re.compile(r"^(?P<head>.*?)\s*\(?\s*(?P<lo>\d{1,2})\s*-\s*(?P<hi>\d{1,2})\s*yrs?\s*\)?\s*(?P<tail>.*)$", re.I | re.S)


def _iimjobs_card(text: str, href: str, company: str) -> dict:
    """One listing from the text of its card: 'Role - Industry (0-2 yrs) [lo-hi LPA] City Posted 2 days ago'."""
    t = re.sub(r"\s+", " ", text).strip()
    m = IIMJOBS_CARD_RX.match(t)
    head, tail = (m.group("head"), m.group("tail")) if m else (t, "")
    exp = f"{m.group('lo')}-{m.group('hi')} yrs" if m else None
    sal = re.search(r"(\d{1,3}(?:\.\d)?\s*-\s*\d{1,3}(?:\.\d)?\s*LPA)", tail or t, re.I)
    posted = re.search(r"posted\s+(\d+)\s*(day|week|month|hour)s?\s*ago", tail or t, re.I)
    days = {"hour": 0, "day": 1, "week": 7, "month": 30}[posted.group(2).lower()] * int(posted.group(1)) if posted else None
    loc = re.sub(r"\d{1,3}(?:\.\d)?\s*-\s*\d{1,3}(?:\.\d)?\s*LPA|posted.*$|\d(?:\.\d)?\s*\d+\+?\s*reviews?", "", tail, flags=re.I).strip(" |·-")
    title = head.strip(" -|·")
    if not company:
        # Disclosed employers lead the heading ("Rebel Foods - General Manager - Brands"); confidential ones start with the role.
        parts = [x.strip() for x in title.split(" - ") if x.strip()]
        if len(parts) >= 2 and len(parts[0].split()) <= 4 and not IIMJOBS_ROLE_WORD_RX.search(parts[0]):
            company, title = parts[0], " - ".join(parts[1:])
    return {
        "title": title, "company": company, "location": loc[:80],
        "url": href if href.startswith("http") else "https://www.iimjobs.com" + href,
        "salaryText": sal.group(1) if sal else None, "experienceText": exp,
        "postedAt": (today_ist() - timedelta(days=days)).isoformat() if days is not None else None, "description": t[:600],
    }


def parse_iimjobs(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.select("a[href*='/j/']"):
        href = (a.get("href") or "").split("?")[0]
        if not re.search(IIMJOBS_LINK_PAT, href) or href in seen:
            continue
        t = _text(a)
        if len(t) < 8:
            continue
        seen.add(href)
        card = a
        for _ in range(4):  # the link may be just the heading; the card around it carries the company and the rest
            nxt = card.parent
            if nxt is None or nxt.name in ("body", "html", "ul", "section") or len(_text(nxt)) > 3 * len(t) + 200:
                break
            card = nxt
        comp_el = card.select_one("[data-testid*='company'], [data-testid*='recruiter'], [class*='company'], [class*='comp-name'], [class*='recruiter'], [class*='postedBy'], [class*='posted-by']")
        company = re.sub(r"^\s*(?:posted by|recruiter)\s*:?\s*", "", _text(comp_el), flags=re.I)
        if company and re.search(r"\b(?:yrs?|LPA|posted)\b", company, re.I):
            company = ""
        item = _iimjobs_card(_text(card), href, company)
        heading = card.select_one("[data-testid='job_title'], [class*='joblist__title']")
        if heading is not None and len(_text(heading)) >= 6:
            fixed = _iimjobs_card(_text(heading) + " " + re.sub(re.escape(_text(heading)), " ", _text(card), count=1), href, company)
            item.update({k: fixed[k] for k in ("title", "company") if fixed.get(k)})
        out.append(item)
    if out:
        return out
    items = _embedded_jobs(html, "https://www.iimjobs.com")
    for it in items:
        if not it.get("experienceText"):
            m = re.search(r"\(\s*(\d+\s*-\s*\d+)\s*yrs?\s*\)", it["title"], re.I)
            if m:
                it["experienceText"] = f"{m.group(1)} yrs"
                it["title"] = re.sub(r"\s*\(\s*\d+\s*-\s*\d+\s*yrs?\s*\)\s*$", "", it["title"]).strip()
    return items


GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
IIMJOBS_LINK_PAT = r"/j/[a-z0-9-]+-\d{4,}(?:\.html)?(?=[?#\"'\s]|$)"
IIMJOBS_TAG_RX = re.compile(r"\b(?:marketing|brand|market research|product|analytics|consult|strateg|general management|management trainee|leadership|campus|fresher|corporate development)", re.I)
IIMJOBS_TAG_SKIP_RX = re.compile(r"\b(?:sales|head|director|vp|cxo|senior|engineering|it\b|tech|software)", re.I)
_IIMJOBS_TAGS: dict[str, list[str]] = {}


def _iimjobs_tags(html: str) -> list[str]:
    """Tag slugs from the page's own category nav (metaData.header.meta.tabsList) that fit marketing / general management."""
    nd = _next_data(html) or {}

    def find_list(o, depth=8):
        if depth < 0 or not isinstance(o, (dict, list)):
            return None
        if isinstance(o, dict):
            if isinstance(o.get("tabsList"), list):
                return o["tabsList"]
            vals = o.values()
        else:
            vals = o[:5]
        for v in vals:
            r = find_list(v, depth - 1)
            if r is not None:
                return r
        return None

    tabs = find_list(nd) or []
    tags: list[str] = []
    for tab in tabs if isinstance(tabs, list) else []:
        for item in [tab] + list(tab.get("menu") or []):
            tag = str(item.get("tag") or "").strip()
            if tag and IIMJOBS_TAG_RX.search(tag) and not IIMJOBS_TAG_SKIP_RX.search(tag) and tag not in tags:
                tags.append(tag)
    return tags


def iimjobs(q: str) -> list[dict]:
    """The listing is rendered server-side only for crawlers, and only on real tag pages (free-text /k/ pages 404)."""
    url = f"https://www.iimjobs.com/k/{_slug(q)}-jobs"
    try:
        r = get(url, headers={"User-Agent": GOOGLEBOT_UA})
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"[info] iimjobs: no tag page for {q!r}")
            return []
        raise
    if "/login" in r.url or re.search(r"(sign in|login) to (view|see)", r.text[:20000], re.I):
        raise RuntimeError("blocked (login wall)")
    items = parse_iimjobs(r.text)
    if not _IIMJOBS_TAGS:
        _IIMJOBS_TAGS["tags"] = _iimjobs_tags(r.text)
        print(f"[info] iimjobs: tag pages that fit: {_IIMJOBS_TAGS['tags'][:30]}")
        a = BeautifulSoup(r.text, "lxml").select_one("a[href*='/j/']")
        if a is not None:
            card = a.parent if a.parent is not None and a.parent.name not in ("body", "html") else a
            ids = [t.get("data-testid") for t in card.select("[data-testid]")]
            print(f"[sample] iimjobs first card: ids={ids[:20]} text={_text(card)[:400]!r}")
            print(f"[sample] iimjobs first card parsed: {items[0] if items else None}")
    if not items and len(r.text) > 20000:
        _zero_sample("iimjobs", r.text, url, IIMJOBS_LINK_PAT)
        raise RuntimeError(f"parse (0 cards in {len(r.text)} chars)")
    return items


IIMJOBS_SEED = "brand management"


# ── TimesJobs (classic server-rendered search) ──
def parse_timesjobs(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for li in soup.select("li.job-bx, li.clearfix.job-bx, [class*='job-bx']"):
        a = li.select_one("h2 a, h3 a, a[href*='job-detail']")
        if not a:
            continue
        comp = _text(li.select_one("h3.joblist-comp-name, .joblist-comp-name, [class*='comp-name']"))
        comp = re.sub(r"\(?\s*more jobs\s*\)?", "", comp, flags=re.I).strip()
        for icon in li.select("i.material-icons, i"):
            icon.decompose()  # the icon font's ligature text ("card_travel", "Rs") sits inside the li
        dtl = [_text(x) for x in li.select("ul.top-jd-dtl li, .top-jd-dtl li")]
        exp = next((d for d in dtl if re.search(r"\byrs?\b|year", d, re.I)), None)
        sal = next((d for d in dtl if re.search(r"\b(?:lacs?|lakhs?|lpa|rs)\b|₹", d, re.I)), None)
        loc = dtl[-1] if dtl else _text(li.select_one("[class*='loc']"))
        posted = _text(li.select_one("span.sim-posted, .sim-posted"))
        m = re.search(r"(\d+)\s*days?\s*ago", posted, re.I)
        posted_at = (today_ist() - timedelta(days=int(m.group(1)))).isoformat() if m else (today_ist().isoformat() if re.search(r"today|few", posted, re.I) else None)
        href = a.get("href") or ""
        out.append({
            "title": _text(a), "company": comp, "location": re.sub(r"^\s*location\s*:?", "", loc, flags=re.I).strip() if loc and loc != exp and loc != sal else "",
            "url": href if href.startswith("http") else "https://www.timesjobs.com" + href,
            "salaryText": sal, "experienceText": exp, "postedAt": posted_at,
            "description": _text(li.select_one("ul.list-job-dtl, .list-job-dtl"))[:600],
        })
    return out


TIMESJOBS_LINK_RX = re.compile(r"\[([^\]]{4,140})\]\((https?://www\.timesjobs\.com/(?:job-detail|jobs?/[a-z0-9-]+)/[^)\s]+)\)")


TIMESJOBS_DETAIL_RX = r"timesjobs\.com/(?:job-detail|jobs?/[a-z0-9-]+)/"


def parse_timesjobs_links(html: str) -> list[dict]:
    """Cards from the rendered Next.js listing: every anchor to a job page, with the text of its enclosing card."""
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.select("a[href*='/job-detail/'], a[href*='/job/'], a[href*='/jobs/']"):
        href = a.get("href") or ""
        if not re.search(r"/(?:job-detail|jobs?)/[a-z0-9-]{6,}", href) or href in seen:
            continue
        title = _text(a)
        if len(title) < 4 or re.search(r"^(?:view|apply|more|see)\b", title, re.I):
            continue
        seen.add(href)
        card = a
        for _ in range(5):
            if card.parent is None or len(_text(card)) > 80:
                break
            card = card.parent
        txt = _text(card)
        exp = re.search(r"((?:\d+\s*(?:-|to)\s*\d+|\d+\+?)\s*(?:yrs?|years?)|fresher)", txt, re.I)
        sal = re.search(r"((?:rs\.?|₹)\s*[\d.,]+\s*(?:-\s*[\d.,]+)?\s*(?:lacs?|lakhs?|lpa|p\.?a\.?|per annum)[^|•\n]{0,10}|\d[\d.,]*\s*-\s*\d[\d.,]*\s*(?:lacs?|lakhs?|lpa))", txt, re.I)
        out.append({
            "title": title, "company": _text(card.select_one("[class*='comp'], [class*='company'], h4, h3 + *")) if card is not a else "",
            "location": _text(card.select_one("[class*='loc'], [class*='city']")),
            "url": href if href.startswith("http") else "https://www.timesjobs.com" + href,
            "salaryText": sal.group(1) if sal else None, "experienceText": exp.group(1) if exp else None, "postedAt": None, "description": txt[:600],
        })
    return out


def _timesjobs_from_html(html: str) -> list[dict]:
    return parse_timesjobs(html) or _embedded_jobs(html, "https://www.timesjobs.com") or parse_timesjobs_links(html)


def timesjobs(q: str) -> list[dict]:
    # The classic candidate/job-search.html listing now redirects to a Next.js app that renders jobs client-side.
    url = f"https://www.timesjobs.com/job-search?keywords={requests.utils.quote(q)}&experience=0"
    try:
        r = get(url)
    except (requests.exceptions.ConnectionError, requests.HTTPError):
        r = None  # the site refuses GitHub's address range; the reader renders it from elsewhere
    if r is not None:
        items = _timesjobs_from_html(r.text)
        if items:
            return items
        if len(r.text) > 20000:
            _zero_sample("TimesJobs", r.text, url, TIMESJOBS_DETAIL_RX)
            print(f"[sample] TimesJobs direct link shapes: {_link_shapes(r.text, 'timesjobs.com')}")
    # The app fetches its listing after the first paint: ask the reader to wait for a job link before returning.
    html = _reader_html(url, wait_for="a[href*='/job-detail/'], a[href*='/jobs/'], a[href*='/job/']")
    items = _timesjobs_from_html(html)
    if items:
        return items
    _zero_sample("TimesJobs", html, "reader html " + url, TIMESJOBS_DETAIL_RX)
    print(f"[sample] TimesJobs reader-html link shapes: {_link_shapes(html, 'timesjobs.com')} api hints: {_api_hints(html, 'https://www.timesjobs.com', 'timesjobs')}")
    raise RuntimeError("blocked (listing loads client-side)")


def parse_timesjobs_detail(html: str) -> dict:
    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)
    out: dict = {}
    m = re.search(r"(\d+\s*-\s*\d+\s*yrs?|fresher)", text, re.I)
    if m:
        out["experienceText"] = m.group(1)
    m = re.search(r"((?:rs\.?|₹)\s*[\d.,]+\s*-\s*[\d.,]+\s*lacs?\s*p\.?a\.?)", text, re.I)
    if m:
        out["salaryText"] = m.group(1)
    m = re.search(r"job description\s*\n(.{40,4000})", text, re.I | re.S)
    out["description"] = (m.group(1) if m else text)[:4000]
    return out


def timesjobs_detail(url: str) -> dict:
    return parse_timesjobs_detail(get(url).text)


# ── Shine (Next.js: job cards live in the __NEXT_DATA__ JSON) ──
def _pick(d: dict, *keys):
    for k in keys:
        if k in d and d[k] not in (None, "", []):
            return d[k]
    for k in keys:
        for dk, v in d.items():
            if k.lower() in dk.lower() and v not in (None, "", [], {}):
                return v
    return None


def _walk_lists(obj, depth: int = 8):
    if depth < 0:
        return
    if isinstance(obj, list):
        if len(obj) >= 3 and all(isinstance(x, dict) for x in obj[:3]):
            yield obj
        for x in obj[:50]:
            yield from _walk_lists(x, depth - 1)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_lists(v, depth - 1)


def _next_data(html: str) -> dict | None:
    m = re.search(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:  # noqa: BLE001
        return None


def parse_shine(html: str) -> list[dict]:
    data = _next_data(html)
    out = []
    if not data:
        # App-router build: the job list sits in RSC payloads (or JSON-LD), not in __NEXT_DATA__.
        out = _embedded_jobs(html, "https://www.shine.com")
        if out:
            return out
    if data:
        cards = None
        for lst in _walk_lists(data):
            d0 = lst[0]
            if _pick(d0, "jJT", "jobTitle", "title") and _pick(d0, "jCName", "companyName", "company"):
                cards = lst
                break
        for j in cards or []:
            title = _pick(j, "jJT", "jobTitle", "title")
            comp = _pick(j, "jCName", "companyName", "company")
            if isinstance(comp, dict):
                comp = comp.get("name") or ""
            slug = _pick(j, "jSlug", "jURL", "url", "slug") or ""
            link = slug if str(slug).startswith("http") else "https://www.shine.com/jobs/" + str(slug).lstrip("/") if slug else ""
            exp = _pick(j, "jExp", "experience", "exp")
            sal = _pick(j, "jSal", "salary", "ctc")
            out.append({
                "title": str(title), "company": str(comp or ""), "location": _locs(_pick(j, "jLoc", "location", "city")),
                "url": link, "salaryText": str(sal) if sal and not isinstance(sal, (dict, list)) else None,
                "experienceText": str(exp) if exp and not isinstance(exp, (dict, list)) else None,
                "postedAt": _date_any(_pick(j, "jPDate", "postedDate", "posted", "createdAt")),
                "description": str(_pick(j, "jJD", "description", "desc") or "")[:600],
            })
    if not out:
        soup = BeautifulSoup(html, "lxml")
        for card in soup.select("[class*='jobCard'], [class*='job-card'], [class*='jobTuple']"):
            a = card.select_one("a[href*='/jobs/']")
            h = card.select_one("h2, h3")
            if not a or not h:
                continue
            txt = _text(card)
            exp = re.search(r"(\d+\s*(?:-|to)\s*\d+\s*yrs?)", txt, re.I)
            sal = re.search(r"(\d[\d.,]*\s*(?:-|to)\s*\d[\d.,]*\s*(?:lacs?|lakh|lpa)[^\s]*)", txt, re.I)
            href = a.get("href") or ""
            out.append({
                "title": _text(h), "company": _text(card.select_one("[class*='company'], [class*='comp']")), "location": _text(card.select_one("[class*='location'], [class*='loc']")),
                "url": href if href.startswith("http") else "https://www.shine.com" + href,
                "salaryText": sal.group(1) if sal else None, "experienceText": exp.group(1) if exp else None, "postedAt": None, "description": txt[:600],
            })
    return out


def shine(q: str) -> list[dict]:
    url = f"https://www.shine.com/job-search/{_slug(q)}-jobs"
    r = get(url)
    items = parse_shine(r.text)
    if not items and len(r.text) > 20000:
        _zero_sample("Shine", r.text, url, r"shine\.com/jobs/[a-z0-9-]+")
        raise RuntimeError(f"parse (0 cards in {len(r.text)} chars)")
    return items


def parse_shine_detail(html: str) -> dict:
    out: dict = {}
    nd = _next_data(html)
    if nd:
        exp = find_key(nd, "jexp", "experience", depth=8)
        sal = find_key(nd, "jsal", "salary", "ctc", depth=8)
        desc = find_key(nd, "jjd", "description", "jobdescription", depth=8)
        if exp:
            out["experienceText"] = str(exp)
        if sal:
            out["salaryText"] = str(sal)
        if desc:
            out["description"] = re.sub(r"<[^>]+>", " ", str(desc))[:4000]
    if "description" not in out:
        text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)
        out["description"] = text[:4000]
        m = re.search(r"(\d+\s*(?:-|to)\s*\d+\s*yrs?)", text, re.I)
        if m and "experienceText" not in out:
            out["experienceText"] = m.group(1)
    return out


def shine_detail(url: str) -> dict:
    return parse_shine_detail(get(url).text)


# ── Freshersworld (fresher-only board) ──
def parse_freshersworld(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for card in soup.select("[class*='job-container'], [class*='job_container'], [class*='latest-job']"):
        title = card.get("data-job-display-name") or _text(card.select_one("[class*='wrap-title'], h3 a, h2 a, a[href*='/jobs/']"))
        a = card.select_one("a[href*='/jobs/'], a[href*='freshersworld.com']")
        href = card.get("data-url") or (a.get("href") if a else "") or ""
        if not title or not href:
            continue
        txt = _text(card)
        exp = re.search(r"experience[:\s]*((?:\d+\s*(?:-|to)\s*\d+|\d+)\s*(?:years?|yrs?)|fresher)", txt, re.I)
        sal = re.search(r"salary[:\s]*([^\n]{3,40}?(?:per annum|lakh|lpa|p\.a\.|lacs?)[^\n]{0,10})", txt, re.I)
        posted = re.search(r"posted[:\s]*(\d{4}-\d{2}-\d{2})", txt, re.I)
        out.append({
            "title": title, "company": card.get("data-company-name") or _text(card.select_one("[class*='company-name'], [class*='company'], [class*='latest-jobs-title']")),
            "location": card.get("data-job-location") or _text(card.select_one("[class*='job-location'], [class*='location']")),
            "url": href if href.startswith("http") else "https://www.freshersworld.com" + href,
            "salaryText": sal.group(1).strip() if sal else None, "experienceText": exp.group(1) if exp else None,
            "postedAt": posted.group(1) if posted else None, "description": txt[:600],
        })
    return out


FRESHERSWORLD_LINK_RX = re.compile(r"\[([^\]]{4,140})\]\((https?://www\.freshersworld\.com/jobs/[a-z0-9-]+-\d+[^)\s]*)\)")


def freshersworld(q: str) -> list[dict]:
    url = f"https://www.freshersworld.com/jobs/jobsearch/{_slug(q)}-jobs"
    try:
        r = get(url)
    except (requests.exceptions.ConnectionError, requests.HTTPError) as e:
        if isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code not in (403, 429, 503):
            raise
        # 403 for datacenter IPs (the reader's too); a crawler UA sometimes passes, else give the reader a try.
        try:
            r = get(url, headers={"User-Agent": GOOGLEBOT_UA}, attempts=1)
        except Exception:  # noqa: BLE001
            return parse_generic_md(_reader(url), FRESHERSWORLD_LINK_RX, "Freshersworld")
    items = parse_freshersworld(r.text)
    if not items:
        items = _embedded_jobs(r.text, "https://www.freshersworld.com")
    if not items and len(r.text) > 20000:
        _zero_sample("Freshersworld", r.text, url, r"freshersworld\.com/jobs/[a-z0-9-]+-\d+")
        raise RuntimeError(f"parse (0 cards in {len(r.text)} chars)")
    return items


def parse_freshersworld_detail(html: str) -> dict:
    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)
    out: dict = {"description": text[:4000]}
    m = re.search(r"experience[:\s]*\n?\s*((?:\d+\s*(?:-|to)\s*\d+|\d+)\s*(?:years?|yrs?)|fresher)", text, re.I)
    if m:
        out["experienceText"] = m.group(1)
    m = re.search(r"salary[:\s]*\n?\s*([^\n]{3,50}?(?:per annum|lakh|lpa|p\.a\.|lacs?|/\s*month)[^\n]{0,10})", text, re.I)
    if m:
        out["salaryText"] = m.group(1).strip()
    return out


def freshersworld_detail(url: str) -> dict:
    return parse_freshersworld_detail(get(url).text)


# ── Indeed and Glassdoor (bot-protected; best effort through the reader) ──
INDEED_LINK_RX = re.compile(r"\[([^\]]{4,140})\]\((https://in\.indeed\.com/(?:viewjob\?jk=|rc/clk|pagead/clk|m/viewjob\?jk=)[^)\s]+)\)")
GLASSDOOR_LINK_RX = re.compile(r"\[([^\]]{4,140})\]\((https://www\.glassdoor\.co\.in/job-listing/[^)\s]+)\)")
CITY_LINE_RX = r"\n\s*([A-Z][A-Za-z .]{2,40}(?:,\s*[A-Z][A-Za-z .]{2,30})?(?:\s*\d{6})?)\s*\n"


def parse_indeed_md(md: str) -> list[dict]:
    marker = _reader_blocked(md)
    if marker:
        raise RuntimeError(f"blocked (cloudflare: {marker})")
    out, seen = [], set()
    for title, link, chunk in _md_cards(md, INDEED_LINK_RX):
        jk = re.search(r"jk=([0-9a-f]+)", link)
        key = jk.group(1) if jk else link
        if key in seen:
            continue
        seen.add(key)
        sal = _md_line(chunk, r"(₹\s*[\d,]+(?:\s*-\s*₹?\s*[\d,]+)?\s*(?:a|per)\s*(?:month|year|annum))")
        out.append({
            "title": title, "company": _md_line(chunk, r"\n\s*\**([A-Z][^\n*]{2,60}?)\**\s*\n") or "", "location": _md_line(chunk, CITY_LINE_RX) or "",
            "url": link.split("&")[0] if "viewjob" in link else link, "salaryText": sal, "experienceText": None, "postedAt": None, "description": chunk[:600],
        })
    if not out:
        raise RuntimeError("blocked (reader: no job links)")
    return out


def indeed(q: str) -> list[dict]:
    md = _reader(f"https://in.indeed.com/jobs?q={requests.utils.quote(q)}&l=India&fromage=7&explvl=entry_level")
    links = len(re.findall(r"\]\((https?://[^)\s]+)\)", md))
    print(f"[sample] Indeed reader {len(md)} chars, {links} links; head: {re.sub(r'\s+', ' ', md[:160])!r}")
    return parse_indeed_md(md)


def parse_glassdoor_md(md: str) -> list[dict]:
    marker = _reader_blocked(md)
    if marker:
        raise RuntimeError(f"blocked (cloudflare: {marker})")
    out, seen = [], set()
    for title, link, chunk in _md_cards(md, GLASSDOOR_LINK_RX):
        if link in seen:
            continue
        seen.add(link)
        sal = _md_line(chunk, r"(₹\s*[\d,.]+[KL]?(?:\s*-\s*₹?\s*[\d,.]+[KL]?)?\s*(?:\(.*?\))?\s*(?:a|per)?\s*(?:month|year|annum)?)")
        out.append({
            "title": title, "company": _md_line(chunk, r"\n\s*\**([A-Z][^\n*]{2,60}?)\**\s*\n") or "", "location": _md_line(chunk, CITY_LINE_RX) or "",
            "url": link.split("?")[0], "salaryText": sal, "experienceText": None, "postedAt": None, "description": chunk[:600],
        })
    if not out:
        if re.search(r"sign in|create account", md[:6000], re.I):
            raise RuntimeError("blocked (login wall)")
        _reader_sample("Glassdoor", md)
        raise RuntimeError("blocked (reader: no job links)")
    return out


def glassdoor(q: str) -> list[dict]:
    slug = _slug(q)
    url = f"https://www.glassdoor.co.in/Job/india-{slug}-jobs-SRCH_IL.0,5_IN115_KO6,{6 + len(slug)}.htm"
    md = _reader(url)
    links = len(re.findall(r"\]\((https?://[^)\s]+)\)", md))
    print(f"[sample] Glassdoor reader {len(md)} chars, {links} links; head: {re.sub(r'\s+', ' ', md[:160])!r}")
    return parse_glassdoor_md(md)


# ── Adzuna and Jooble (official APIs; run only when the repo secrets are set) ──
def parse_adzuna(data: dict) -> list[dict]:
    out = []
    for j in data.get("results", []) or []:
        lo, hi = j.get("salary_min"), j.get("salary_max")
        predicted = str(j.get("salary_is_predicted", "0")) == "1"
        sal = f"{float(lo):.0f} - {float(hi):.0f} per annum" if lo and hi and not predicted else None
        out.append({
            "title": j.get("title") or "", "company": (j.get("company") or {}).get("display_name") or "",
            "location": (j.get("location") or {}).get("display_name") or "", "url": j.get("redirect_url") or "",
            "salaryText": sal, "experienceText": None, "postedAt": _date_any(j.get("created")), "description": (j.get("description") or "")[:600],
        })
    return out


def adzuna(q: str) -> list[dict]:
    app_id, key = env("ADZUNA_APP_ID"), env("ADZUNA_APP_KEY")
    url = f"https://api.adzuna.com/v1/api/jobs/in/search/1?app_id={app_id}&app_key={key}&what={requests.utils.quote(q)}&max_days_old=14&results_per_page=50&sort_by=date&content-type=application/json"
    try:
        return parse_adzuna(get(url).json())
    except requests.HTTPError as e:  # never echo the URL: it carries the key
        raise RuntimeError(f"http {e.response.status_code if e.response is not None else '?'}") from None


def parse_jooble(data: dict) -> list[dict]:
    out = []
    for j in data.get("jobs", []) or []:
        out.append({
            "title": j.get("title") or "", "company": j.get("company") or "", "location": j.get("location") or "",
            "url": j.get("link") or "", "salaryText": j.get("salary") or None, "experienceText": None,
            "postedAt": _date_any(j.get("updated")), "description": re.sub(r"<[^>]+>", " ", j.get("snippet") or "")[:600],
        })
    return out


def jooble(q: str) -> list[dict]:
    try:
        return parse_jooble(post_json(f"https://jooble.org/api/{env('JOOBLE_API_KEY')}", {"keywords": q, "location": "India"}))
    except requests.HTTPError as e:
        raise RuntimeError(f"http {e.response.status_code if e.response is not None else '?'}") from None


def _sample_url(name: str, q: str) -> str:
    qq = requests.utils.quote(q)
    return {
        "Foundit": f"https://www.foundit.in/middleware/jobsearch?sort=1&limit=2&query={qq}&experienceRanges=0~1&start=0",
        "Unstop": f"https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=2&oppstatus=open&searchTerm={qq}",
        "Naukri": f"https://www.naukri.com/jobapi/v3/search?noOfResults=2&urlType=search_by_keyword&searchType=adv&keyword={qq}&experience=0",
        "iimjobs": f"https://www.iimjobs.com/k/{_slug(q)}-jobs",
        "TimesJobs": f"https://www.timesjobs.com/candidate/job-search.html?searchType=personalizedSearch&from=submit&txtKeywords={qq}",
        "Shine": f"https://www.shine.com/job-search/{_slug(q)}-jobs",
        "Freshersworld": f"https://www.freshersworld.com/jobs/jobsearch/{_slug(q)}-jobs",
    }.get(name, "about:blank")


# ───────────────────────── pipeline ─────────────────────────
EMPLOYERS = json.loads((Path(__file__).parent / "employers.json").read_text(encoding="utf-8"))
KNOWN = [n.lower() for n in EMPLOYERS["names"]]
SUSPICIOUS_RX = re.compile(r"\b(" + "|".join(re.escape(t) for t in EMPLOYERS["suspiciousCompanyTerms"]) + r")\b", re.I)
SCAM_RX = re.compile("|".join(re.escape(t) for t in EMPLOYERS["scamTerms"]), re.I)
SHADY_DOMAINS = EMPLOYERS["shadyDomains"]
WFH_RX = re.compile(r"\b(work from home|wfh|remote)\b", re.I)


def clean_company(name: str) -> str:
    c = re.sub(r"\s*(actively hiring|hiring now|urgent(ly)? hiring).*$", "", name or "", flags=re.I)
    c = re.sub(r"\s+", " ", c)
    c = re.sub(r"\s+[A-Z]$", "", c)
    return c.strip(" -|·,")


def known_employer(company: str) -> str | None:
    """The allow-list entry that matches this company name (whole words only), or None."""
    c = " " + re.sub(r"[^a-z0-9&.' ]", " ", company.lower()) + " "
    c = re.sub(r"\s+", " ", c)
    head = " ".join(c.split()[:4])  # the brand has to be in the first few words, not a distributor's "(oppo-tamilnadu)" suffix
    for n in KNOWN:
        tok = n.strip()
        if tok and re.search(r"(?<![a-z0-9])" + re.escape(tok) + r"(?![a-z0-9])", " " + head + " "):
            return tok
    return None


def is_known_employer(company: str) -> bool:
    return known_employer(company) is not None


def trust_of(company: str, text: str, website: str | None) -> tuple[str, str | None]:
    """('verified' | 'unverified' | 'reject', reason)."""
    if SCAM_RX.search(text):
        return "reject", "scam wording"
    if website and any(d in website.lower() for d in SHADY_DOMAINS):
        return "reject", "shady website"
    if is_known_employer(company):
        return "verified", None
    if SUSPICIOUS_RX.search(company):
        return "reject", "agency / shady company name"
    return "unverified", None


def prefilter(raw: dict) -> str | None:
    """Cheap title-level checks before any detail fetch. Returns a rejection reason or None."""
    title = re.sub(r"\s+", " ", (raw.get("title") or "")).strip(" -|·")
    company = clean_company(raw.get("company") or "")
    raw["title"], raw["company"] = title, company
    if not title or not company:
        return "incomplete"
    if EXCLUDE_RX.search(title):
        return "excluded role"
    if SENIOR_RX.search(title):
        return "senior title"
    if MANAGER_RX.search(title) and not JUNIOR_RX.search(title):
        return "manager title"
    if SALES_SPAM_RX.search(title) and not re.search(r"\b(trainee|program|programme|management|leadership|graduate)\b", title, re.I):
        return "sales / BD spam"
    if not ROLE_RX.search(title):
        return "role mismatch"
    return None


# ───────────────────────── detail verification ─────────────────────────
def linkedin_detail(url: str) -> dict:
    m = re.search(r"-(\d{6,})/?(?:\?|$)", url) or re.search(r"/view/(\d{6,})", url)
    if not m:
        return {}
    soup = BeautifulSoup(get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{m.group(1)}").text, "lxml")
    desc = soup.select_one(".show-more-less-html__markup, .description__text")
    crit = {}
    for li in soup.select(".description__job-criteria-item"):
        h = li.select_one("h3")
        v = li.select_one("span")
        if h and v:
            crit[h.get_text(" ", strip=True).lower()] = v.get_text(" ", strip=True)
    sal = soup.select_one(".salary, .compensation__salary")
    out = {"description": desc.get_text(" ", strip=True)[:4000] if desc else "", "seniority": crit.get("seniority level"), "employment": crit.get("employment type")}
    if sal:
        out["salaryText"] = sal.get_text(" ", strip=True)
    return out


def internshala_detail(url: str) -> dict:
    soup = BeautifulSoup(get(url).text, "lxml")
    text = soup.get_text("\n", strip=True)
    out: dict = {"description": text[:4000]}
    m = re.search(r"Experience\s*\n?\s*(\d+(?:\.\d+)?\s*(?:-|–|to)?\s*\d*(?:\.\d+)?\s*years?|fresher)", text, re.I)
    if m:
        out["experienceText"] = m.group(1)
    m = re.search(r"(?:CTC|Salary|Compensation)\s*\n?\s*(₹[^\n]{3,60})", text, re.I)
    if m:
        out["salaryText"] = m.group(1)
    for a in soup.select("a[href^='http']"):
        href = a.get("href", "")
        host = re.sub(r"^https?://(www\.)?", "", href).split("/")[0].lower()
        if host and not any(x in host for x in ("internshala", "google", "apple.com", "play.google", "twitter", "x.com", "youtube", "linkedin.com/company/internshala")):
            if re.search(r"website|visit|\.com|\.in|\.io|\.org", a.get_text(" ", strip=True) + href, re.I) and "linkedin.com" not in host and "instagram" not in host and "facebook" not in host:
                out["website"] = host
                break
    return out


def verify(raw: dict) -> dict:
    """Open the listing itself to read experience, pay and the description. Never raises."""
    try:
        portal = PORTAL_BY_NAME.get(raw.get("source") or "")
        d = portal.detail(raw.get("url") or "") if portal and portal.detail and raw.get("url") else {}
        for k, v in d.items():
            if v and not raw.get(k):
                raw[k] = v
        if d:
            raw["verified"] = True
    except Exception as e:  # noqa: BLE001
        raw["verifyError"] = str(e)[:80]
    return raw


def qualify(raw: dict, profile: dict) -> tuple[dict | None, str]:
    pre = prefilter(raw)
    if pre:
        return None, pre
    title, company = raw["title"], raw["company"]
    desc = raw.get("description") or ""
    hay = f"{title} {desc}"
    trust, treason = trust_of(company, f"{title} {company} {desc}", raw.get("website"))
    if trust == "reject":
        return None, treason or "untrusted"
    # Experience: the listing's own field first, then the description text.
    exp_min = parse_experience(raw.get("experienceText"))
    if exp_min is None:
        exp_min = parse_experience(hay)
    if exp_min is None and (raw.get("seniority") or "").lower() in ("entry level", "internship"):
        exp_min = 0.0
    max_exp = float(profile.get("maxExperienceYears", 0.5))
    exp_unknown = exp_min is None
    if exp_unknown:
        exp_min = 0.0
    if exp_min > max_exp:
        return None, f"needs {exp_min:g}+ yrs"
    if re.search(r"\b(\d+)\s*\+?\s*(?:-|to)?\s*\d*\s*(?:yrs?|years?)\s+(?:of\s+)?(?:relevant\s+|prior\s+|work\s+)?experience\s+(?:is\s+)?(?:required|mandatory|must)", hay, re.I):
        m = re.search(r"\b(\d+)\s*\+?\s*(?:-|to)?\s*\d*\s*(?:yrs?|years?)\s+(?:of\s+)?(?:relevant\s+|prior\s+|work\s+)?experience\s+(?:is\s+)?(?:required|mandatory|must)", hay, re.I)
        if m and float(m.group(1)) > max_exp:
            return None, f"needs {m.group(1)}+ yrs"
    # Pay
    sal = parse_salary(raw.get("salaryText")) or parse_salary(hay if re.search(r"\b(lpa|lakh|lacs?|ctc|per annum|p\.a\.)\b", hay, re.I) else None)
    pay_floor = float(profile.get("privatePayFloorLakh", 6))
    pay_bar = float(profile.get("privateMinPayLakh", 10))
    if sal:
        lo, hi = sal
        if hi < pay_bar or lo < pay_floor:
            return None, f"pay {fmt_pay(sal)}"
        if trust != "verified" and lo >= 30:
            return None, "pay implausible for unknown employer"
    elif trust != "verified" or not FRESHER_TITLE_RX.search(title):
        # No pay: only a known employer's explicitly fresher programme (trainee / graduate / campus / leadership) is worth showing.
        return None, "salary not stated"
    if trust != "verified" and exp_unknown:
        return None, "experience not stated (unknown employer)"
    if trust != "verified" and WFH_RX.search(raw.get("location") or ""):
        return None, "work-from-home offer from unknown employer"
    locs = [x.strip() for x in re.split(r"[,/|]", raw.get("location") or "") if x.strip()][:6]
    cand = {"org": company, "post": title, "title": title, "sector": "private", "track": "private", "locations": locs, "payLakh": sal[0] if sal else None, "eligibility": raw.get("experienceText") or ""}
    fit, why = score(cand, profile)
    why = [w for w in why if not w.startswith("needs") and not w.startswith("pay")]
    if sal:
        fit = min(100, fit + 10)
        why.append(f"pay {fmt_pay(sal)}")
    else:
        fit = max(0, fit - 10)
        why.append("pay not listed")
    if trust == "verified":
        fit = min(100, fit + 5)
        why.append("verified employer")
    else:
        why.append("employer not in the known list")
    if exp_unknown:
        fit = max(0, fit - 15)
        why.append("experience not stated")
    else:
        why.append("fresher OK")
    if raw.get("verified"):
        why.append("listing opened and checked")
    return {
        "org": company[:80], "post": title[:140], "title": title, "sector": "private", "track": "private",
        "eligibility": raw.get("experienceText") or ("experience not stated" if exp_unknown else ""),
        "experienceText": "not stated" if exp_unknown else (raw.get("experienceText") or ("fresher" if exp_min == 0 else f"{exp_min:g} yrs")),
        "experienceMinYears": None if exp_unknown else exp_min,
        "pay": fmt_pay(sal), "payLakh": sal[0] if sal else None, "payMinLakh": sal[0] if sal else None, "payMaxLakh": sal[1] if sal else None, "payStated": bool(sal),
        "trust": trust, "trustWhy": known_employer(company) if trust == "verified" else None, "website": raw.get("website"), "checked": bool(raw.get("verified")),
        "locations": locs, "link": raw.get("url"), "source": raw.get("source"), "sourceType": "portal",
        "fit": fit, "fitWhy": why, "status": "open", "postedAt": raw.get("postedAt"), "applyCloses": raw.get("applyCloses"),
        "examDate": None, "examDateType": "tba", "curated": False, "kind": "portal",
        "summary": re.sub(r"\s+", " ", desc)[:280] if desc else None,
    }, "ok"


def dedupe_key(org: str, post: str) -> str:
    words = re.findall(r"[a-z0-9]+", post.lower())
    return re.sub(r"[^a-z0-9]", "", org.lower())[:18] + "|" + " ".join(words[:3])


def item_id(url: str, org: str, post: str) -> str:
    import hashlib

    return "portal-" + hashlib.sha1((url or org + post).encode()).hexdigest()[:12]


# ───────────────────────── registry ─────────────────────────
class Portal(NamedTuple):
    name: str
    fn: Callable[[str], list[dict]]
    queries: tuple[str, ...] | None = None                 # None → every entry of QUERIES
    enabled: Callable[[], str | None] = lambda: None       # a reason string when the portal is OFF
    detail: Callable[[str], dict] | None = None            # opens one listing to read the real requirements
    needs_detail: Callable[[dict], bool] = lambda r: True


CORE_QUERIES = ("management trainee", "marketing trainee", "brand management", "market research analyst", "business analyst fresher", "leadership program MBA")
_missing_fields = lambda r: not r.get("experienceText") or not r.get("salaryText")  # noqa: E731
_needs_keys = lambda *names: (lambda: None if all(env(n) for n in names) else f"no key ({' / '.join(names)})")  # noqa: E731

# Slow reader portals go first so they overlap with the fast ones.
PORTALS: list[Portal] = [
    Portal("Indeed", indeed, ("management trainee", "marketing trainee", "business analyst fresher")),
    Portal("Glassdoor", glassdoor, ("management trainee", "marketing trainee")),
    Portal("Naukri", naukri),
    Portal("Foundit", foundit),
    Portal("Unstop", unstop),
    Portal("LinkedIn", linkedin, detail=linkedin_detail),
    Portal("Internshala", internshala, detail=internshala_detail),
    # Tag pages that exist on the site (from its category nav); free-text searches have no crawler-rendered page.
    Portal("iimjobs", iimjobs, (IIMJOBS_SEED, "marketing", "market research", "fmcg marketing", "analytics", "marketing communications")),
    Portal("TimesJobs", timesjobs, detail=timesjobs_detail, needs_detail=_missing_fields),
    Portal("Shine", shine, CORE_QUERIES, detail=shine_detail, needs_detail=_missing_fields),
    Portal("Freshersworld", freshersworld, CORE_QUERIES, detail=freshersworld_detail, needs_detail=_missing_fields),
    Portal("Adzuna", adzuna, enabled=_needs_keys("ADZUNA_APP_ID", "ADZUNA_APP_KEY")),
    Portal("Jooble", jooble, CORE_QUERIES, enabled=_needs_keys("JOOBLE_API_KEY")),
]
PORTAL_BY_NAME = {p.name: p for p in PORTALS}
BLOCKED: set[str] = set()


def _status_state(st: dict) -> tuple[str, str | None]:
    """('ok' | 'partial' | 'empty' | 'blocked' | 'error', short reason for the footer)."""
    err = st.get("error") or ""
    if st["fetched"] == 0 and err.startswith("blocked"):
        m = re.search(r"\((.*?)\)", err)
        return "blocked", (m.group(1) if m else "blocked")[:24]
    if st["fetched"] == 0 and st["errors"]:
        m = re.search(r"\b(\d{3}) client error|\bhttp (\d{3})", err, re.I)
        if m:
            return "error", f"http {m.group(1) or m.group(2)}"
        if "timed out" in err.lower() or "timeout" in err.lower():
            return "error", "timeout"
        if err.startswith("parse"):
            return "error", "parse"
        return "error", err[:24]
    if st["fetched"] == 0:
        return "empty", "no results"
    if st["errors"]:
        return "partial", "some queries failed"
    return "ok", None


def fetch_all(fixture: str | None, only: set[str] | None = None) -> tuple[list[dict], list[dict]]:
    """Returns (raw items with source, per-portal status)."""
    if fixture:
        raws = json.loads(Path(fixture).read_text())
        return raws, [{"name": "fixture", "ok": True, "fetched": len(raws), "errors": 0, "error": None, "state": "ok", "reason": None}]
    portals = [p for p in PORTALS if not only or p.name in only]
    status: dict[str, dict] = {}
    jobs = []
    for p in portals:
        off = p.enabled()
        status[p.name] = {"name": p.name, "ok": False, "fetched": 0, "errors": 0, "error": off, "state": "off" if off else None, "reason": "no key" if off else None}
        if off:
            print(f"[off ] {p.name:<13} {off}")
            continue
        jobs += [(p, q) for q in (p.queries or tuple(QUERIES))]
    deadline = time.monotonic() + TIME_BUDGET

    def run(job):
        p, q = job
        if p.name in BLOCKED:
            return p.name, q, [], "skipped (portal blocked)"
        if time.monotonic() > deadline:
            return p.name, q, [], "skipped (time budget)"
        try:
            items = p.fn(q)
            for it in items:
                it["source"] = p.name
            return p.name, q, items, None
        except Exception as e:  # noqa: BLE001
            err = str(e)[:120]
            if err.startswith("blocked"):
                BLOCKED.add(p.name)
            # Log a sample of the payload once so the next edit can be based on the real shape.
            try:
                if any(x in err for x in ("float()", "NoneType", "dict", "KeyError", "list index", "subscriptable")):
                    r = get(_sample_url(p.name, q), {"Accept": "application/json"}, attempts=1)
                    print(f"[sample] {p.name}: {r.text[:700]!r}")
            except Exception:  # noqa: BLE001
                pass
            return p.name, q, [], err

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, jobs))
    raws: list[dict] = []
    for name, q, items, err in results:
        st = status[name]
        if err and err.startswith("skipped"):
            print(f"[skip] {name:<13} {q:<28} {err}")
            continue
        if err:
            st["errors"] += 1
            st["error"] = err
            print(f"[fail] {name:<13} {q:<28} {err}")
        else:
            st["ok"] = True
            st["fetched"] += len(items)
            print(f"[ok  ] {name:<13} {q:<28} {len(items):>3} items")
        raws.extend(items)
    for st in status.values():
        if st["state"] != "off":
            st["state"], st["reason"] = _status_state(st)
            st["ok"] = st["state"] in ("ok", "partial", "empty")
    return raws, list(status.values())


def _interleave_by_source(rows: list[dict]) -> list[dict]:
    """Round-robin across sources so one portal cannot consume the whole detail budget."""
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r.get("source") or "", []).append(r)
    out: list[dict] = []
    queues = list(by.values())
    while queues:
        for qlist in list(queues):
            out.append(qlist.pop(0))
            if not qlist:
                queues.remove(qlist)
    return out


def main(argv: list[str]) -> int:
    if "--test" in argv:
        return self_test()
    dry = "--dry-run" in argv
    fixture = argv[argv.index("--fixture") + 1] if "--fixture" in argv else None
    only = {x.strip() for x in argv[argv.index("--only") + 1].split(",") if x.strip()} if "--only" in argv else None
    if only and (unknown := only - set(PORTAL_BY_NAME)):
        print(f"unknown portal(s) {sorted(unknown)}; known: {', '.join(PORTAL_BY_NAME)}")
        return 2
    profile = load_json("profile.json", {})
    opp = load_json("opportunities.json", {"curated": [], "discovered": [], "portal": []})
    today = today_ist()
    stamp = now_ist().isoformat(timespec="seconds")
    keep_after = (today - timedelta(days=KEEP_DAYS)).isoformat()
    existing = {}
    for d in opp.get("portal", []):
        if (d.get("firstSeen") or "")[:10] < keep_after:
            continue
        re_item, _ = qualify({**d, "company": d.get("org"), "title": d.get("post"), "url": d.get("link"), "salaryText": d.get("pay"), "experienceText": None if d.get("experienceText") in ("not stated", "0-0 years") else d.get("experienceText"), "location": ", ".join(d.get("locations") or []), "source": d.get("source"), "description": d.get("summary") or "", "verified": d.get("checked")}, profile)
        if not re_item:
            continue
        for k in ("org", "locations", "trust", "trustWhy", "fit", "fitWhy", "payStated"):
            d[k] = re_item[k]
        existing[d["id"]] = d
    baseline = not opp.get("portal")
    seen = {dedupe_key(d["org"], d["post"]) for d in existing.values()}

    raws, status = fetch_all(fixture, only)
    reasons: dict[str, int] = {}
    samples: dict[str, list[str]] = {}
    new = 0
    # Stage 1: cheap title checks. Stage 2: open the surviving listings (where the portal allows it) to read the real requirements.
    survivors = []
    for raw in raws:
        reason = prefilter(raw)
        if reason:
            reasons[reason] = reasons.get(reason, 0) + 1
            if len(samples.setdefault(reason, [])) < 6:
                samples[reason].append(f"{raw.get('source', '?')}: {(raw.get('title') or '')[:48]} @ {(raw.get('company') or '')[:22]}")
        else:
            survivors.append(raw)
    cands = [r for r in survivors if (p := PORTAL_BY_NAME.get(r.get("source") or "")) and p.detail and p.needs_detail(r) and r.get("url")]
    cands = _interleave_by_source([r for r in cands if is_known_employer(r.get("company") or "")]) + _interleave_by_source([r for r in cands if not is_known_employer(r.get("company") or "")])
    to_check = cands[:DETAIL_CAP]
    if to_check and not fixture:
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(verify, to_check))
        print(f"opened {sum(1 for r in to_check if r.get('verified'))}/{len(to_check)} listings to check requirements")
    for raw in survivors:
        item, reason = qualify(raw, profile)
        key = "pay below bar" if reason.startswith("pay ") else reason
        reasons[key] = reasons.get(key, 0) + 1
        if len(samples.setdefault(key, [])) < 6:
            samples[key].append(f"{raw.get('source', '?')}: {(raw.get('title') or '')[:48]} @ {(raw.get('company') or '')[:22]} [{raw.get('experienceText') or '-'} | {raw.get('salaryText') or '-'}]")
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
    for k, v in samples.items():
        if k != "ok":
            print(f"  [{k}]")
            for line in v:
                print(f"     {line}")
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
        ("₹25,000 a month", (3.0, 3.0)), ("Rs 2.00 - 4.00 Lacs p.a.", (2.0, 4.0)),
    ]
    bad = 0
    for s, want in cases:
        got = parse_salary(s)
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} salary {s!r:<36} -> {got}")
    for s, want in [("0-2 Yrs", 0.0), ("1-3 years", 1.0), ("Fresher", 0.0), ("2+ years", 2.0), ("entry level", 0.0), ("6 months", 0.5), (None, None), ("0 - 3 yrs", 0.0), ("0 to 2 Yrs", 0.0)]:
        got = parse_experience(s)
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} exp    {s!r:<36} -> {got}")

    # Parser fixtures: tiny hand-written pages per portal, exercised offline.
    def fixture(name: str) -> str:
        return (FIXTURES / name).read_text(encoding="utf-8")

    parser_cases = [
        ("iimjobs", parse_iimjobs, "iimjobs.html", 3, {"experienceText": "0-2 yrs", "salaryText": "12-15 LPA", "company": "Hindustan Unilever", "title": "Management Trainee - Marketing - FMCG"}),
        ("TimesJobs", parse_timesjobs, "timesjobs.html", 2, {"experienceText": "0 - 2 yrs"}),
        ("Shine", parse_shine, "shine.html", 2, {"experienceText": "0 to 2 Yrs"}),
        ("Freshersworld", parse_freshersworld, "freshersworld.html", 2, {}),
        ("Indeed", parse_indeed_md, "indeed.md", 2, {}),
        ("Glassdoor", parse_glassdoor_md, "glassdoor.md", 1, {}),
        ("Adzuna", lambda t: parse_adzuna(json.loads(t)), "adzuna.json", 2, {"salaryText": "600000 - 900000 per annum"}),
        ("Jooble", lambda t: parse_jooble(json.loads(t)), "jooble.json", 1, {}),
        ("Shine RSC", parse_shine, "shine_rsc.html", 3, {"experienceText": "0 to 2 Yrs", "salaryText": "12 - 15 Lacs P.A."}),
        ("iimjobs RSC", parse_iimjobs, "iimjobs_rsc.html", 2, {"experienceText": "0-2 yrs", "company": "Hindustan Unilever"}),
        ("TimesJobs md", lambda t: parse_generic_md(t, TIMESJOBS_LINK_RX), "timesjobs_reader.md", 2, {"experienceText": "0 - 2 yrs", "salaryText": "Rs 12.00 - 15.00 Lacs p.a.", "company": "Hindustan Unilever Limited"}),
        ("TimesJobs next", parse_timesjobs_links, "timesjobs_next.html", 2, {"experienceText": "0 - 2 yrs", "salaryText": "Rs 12.00 - 15.00 Lacs p.a.", "company": "Hindustan Unilever Limited"}),
    ]
    for name, fn, fname, min_n, expect in parser_cases:
        try:
            items = fn(fixture(fname))
            problems = []
            if len(items) < min_n:
                problems.append(f"only {len(items)} items")
            for it in items:
                if not it.get("title") or not it.get("company") or not str(it.get("url", "")).startswith("http"):
                    problems.append(f"incomplete item {it.get('title')!r} / {it.get('company')!r} / {it.get('url')!r}")
                    break
            for k, v in expect.items():
                if items and items[0].get(k) != v:
                    problems.append(f"{k}={items[0].get(k)!r}, expected {v!r}")
            ok = not problems
        except Exception as e:  # noqa: BLE001
            ok, problems, items = False, [f"raised {e}"], []
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} parser {name:<13} {len(items):>2} items {'; '.join(problems)}")
    try:
        parse_indeed_md(fixture("indeed_blocked.md"))
        bad += 1
        print("BAD parser Indeed blocked page did not raise")
    except RuntimeError as e:
        ok = "blocked" in str(e)
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} parser Indeed blocked page -> {e}")
    try:
        parse_generic_md("Title: 403 Forbidden\n\nURL Source: https://www.freshersworld.com/jobs/x\n\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\n# 403 Forbidden\n", FRESHERSWORLD_LINK_RX, "Freshersworld")
        bad += 1
        print("BAD parser reader-relayed 403 did not raise")
    except RuntimeError as e:
        ok = str(e) == "blocked (http 403)"
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} parser reader-relayed 403 -> {e}")
    for name, fn, fname in [("TimesJobs", parse_timesjobs_detail, "timesjobs_detail.html"), ("Shine", parse_shine_detail, "shine_detail.html"), ("Freshersworld", parse_freshersworld_detail, "freshersworld_detail.html")]:
        d = fn(fixture(fname))
        ok = bool(d.get("experienceText")) and bool(d.get("salaryText"))
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} detail {name:<13} exp={d.get('experienceText')!r} sal={d.get('salaryText')!r}")
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
    tj = parse_timesjobs(fixture("timesjobs.html"))[0]
    tj["source"] = "TimesJobs"
    item, reason = qualify(tj, profile)
    ok = reason == "ok" and (item or {}).get("pay") == "₹12–15 LPA"
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} qualify TimesJobs card -> {reason} {(item or {}).get('pay')}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
