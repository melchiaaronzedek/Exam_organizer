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
SENIOR_RX = re.compile(r"\b(senior|sr\.?|head of|head\b|lead\b|director|vp\b|vice president|principal|chief|avp|agm|dgm|gm\b|specialist|expert|architect|l[2-9]\b|ii\b|iii\b)\b", re.I)
MANAGER_RX = re.compile(r"\bmanager\b", re.I)
JUNIOR_RX = re.compile(r"\b(trainee|fresher|graduate|campus|program|programme|associate|junior|entry|intern|apprentice|assistant|deputy|officer|executive|analyst|voyage|leadership)\b", re.I)
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


def _sample_url(name: str, q: str) -> str:
    q = requests.utils.quote(q)
    return {
        "Foundit": f"https://www.foundit.in/middleware/jobsearch?sort=1&limit=2&query={q}&experienceRanges=0~1&start=0",
        "Unstop": f"https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=2&oppstatus=open&searchTerm={q}",
        "Naukri": f"https://www.naukri.com/jobapi/v3/search?noOfResults=2&urlType=search_by_keyword&searchType=adv&keyword={q}&experience=0",
    }.get(name, "about:blank")


PORTALS = [("Naukri", naukri), ("Foundit", foundit), ("Unstop", unstop), ("LinkedIn", linkedin), ("Internshala", internshala)]


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


def is_known_employer(company: str) -> bool:
    c = " " + re.sub(r"[^a-z0-9&.' ]", " ", company.lower()) + " "
    c = re.sub(r"\s+", " ", c)
    for n in KNOWN:
        if len(n.strip()) <= 4:
            if re.search(r"(?<![a-z0-9])" + re.escape(n.strip()) + r"(?![a-z0-9])", c):
                return True
        elif n in c:
            return True
    return False


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
        src = raw.get("source")
        if src == "LinkedIn":
            d = linkedin_detail(raw.get("url") or "")
        elif src == "Internshala":
            d = internshala_detail(raw.get("url") or "")
        else:
            d = {}
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
        if trust != "verified" and (lo >= 30 or (WFH_RX.search(raw.get("location") or "") and lo >= 15)):
            return None, "pay implausible for unknown employer"
    elif trust != "verified":
        return None, "salary not stated"
    elif exp_unknown or not FRESHER_TITLE_RX.search(title):
        # No pay and nothing in the listing that says it is a fresher programme: not worth showing.
        return None, "salary not stated"
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
        "trust": trust, "website": raw.get("website"), "checked": bool(raw.get("verified")),
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
            err = str(e)[:120]
            # Log a sample of the payload once so the next edit can be based on the real shape.
            try:
                if "float()" in err or "NoneType" in err or "dict" in err or "KeyError" in err:
                    r = get(_sample_url(name, q), {"Accept": "application/json"}, attempts=1)
                    print(f"[sample] {name}: {r.text[:700]!r}")
            except Exception:  # noqa: BLE001
                pass
            return name, q, [], err

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
    existing = {}
    for d in opp.get("portal", []):
        if (d.get("firstSeen") or "")[:10] < keep_after:
            continue
        re_item, _ = qualify({**d, "company": d.get("org"), "title": d.get("post"), "url": d.get("link"), "salaryText": d.get("pay"), "experienceText": None if d.get("experienceText") == "not stated" else d.get("experienceText"), "location": ", ".join(d.get("locations") or []), "source": d.get("source"), "description": d.get("summary") or "", "verified": d.get("checked")}, profile)
        if not re_item:
            continue
        for k in ("org", "locations", "trust", "fit", "fitWhy", "payStated"):
            d[k] = re_item[k]
        existing[d["id"]] = d
    baseline = not opp.get("portal")
    seen = {dedupe_key(d["org"], d["post"]) for d in existing.values()}

    raws, status = fetch_all(fixture)
    reasons: dict[str, int] = {}
    samples: dict[str, list[str]] = {}
    new = 0
    # Stage 1: cheap title checks. Stage 2: open the surviving listings (LinkedIn, Internshala) to read the real requirements.
    survivors = []
    for raw in raws:
        reason = prefilter(raw)
        if reason:
            reasons[reason] = reasons.get(reason, 0) + 1
            if len(samples.setdefault(reason, [])) < 6:
                samples[reason].append(f"{raw.get('source', '?')}: {(raw.get('title') or '')[:48]} @ {(raw.get('company') or '')[:22]}")
        else:
            survivors.append(raw)
    to_check = [r for r in survivors if r.get("source") in ("LinkedIn", "Internshala") and r.get("url")][:260]
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
