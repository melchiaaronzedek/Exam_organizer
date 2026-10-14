#!/usr/bin/env python3
"""Score how well an opening fits the public profile. Mirrored in src/lib/fit.ts."""
from __future__ import annotations

import re
import sys

from common import load_json

SOUTH = ["andhra", "telangana", "tamil nadu", "karnataka", "chennai", "hyderabad", "visakhapatnam", "vizag", "bengaluru", "bangalore", "tirupati", "vijayawada", "all india", "pan india", "across india", "anywhere in india"]


def score(item: dict, profile: dict) -> tuple[int, list[str]]:
    text = " ".join(str(item.get(k, "")) for k in ("org", "post", "eligibility", "sector", "track", "title", "summary")).lower()
    why: list[str] = []
    s = 0
    roles = [r for r in profile.get("roles", []) if r in text]
    if roles:
        s += 40
        why.append("role: " + roles[0])
    quals = profile.get("qualifications", [])
    if any(q in text for q in ("mba", "pgdm", "management")) and "mba" in quals:
        s += 20
        why.append("MBA eligible")
    elif any(q in text for q in ("graduate", "any degree", "bachelor", "degree")):
        s += 15
        why.append("graduate eligible")
    if "agricultur" in text and "agriculture" in quals:
        s += 20
        why.append("agriculture degree")
    sector = str(item.get("sector", "")).lower()
    if sector and sector in profile.get("sectors", []):
        s += 15
        why.append(sector)
    locs = " ".join(item.get("locations", []) or []).lower() + " " + text
    if any(x in locs for x in SOUTH):
        s += 10
        why.append("South / all-India")
    pay = item.get("payLakh")
    if isinstance(pay, (int, float)) and pay >= profile.get("minPayLakh", 0):
        s += 10
        why.append(f"pay ≥ {profile.get('minPayLakh')} LPA")
    excl = [t for t in profile.get("excludeTerms", []) if t in text]
    if excl and not roles:
        s -= 30
        why.append("likely needs " + excl[0].strip())
    exp = re.search(r"(\d+)\s*(\+)?\s*(yrs?|years?)('?s)?\s*(of\s+)?(post[- ]qualification\s+)?(work\s+)?exp", text)
    if exp and int(exp.group(1)) >= 2:
        s -= 35
        why.append(f"needs {exp.group(1)}+ yrs experience")
    if "deputation" in text or "contract" in text and "retired" in text:
        s -= 30
        why.append("deputation / retiree post")
    age = item.get("ageMax")
    if isinstance(age, (int, float)) and age < 26:
        s -= 20
        why.append("age limit below 26")
    return max(0, min(100, s)), why


def main(argv: list[str]) -> int:
    profile = load_json("profile.json", {})
    if "--test" in argv:
        cases = [
            {"org": "NABARD", "post": "Grade A Assistant Manager (RDBS)", "eligibility": "Graduate / agriculture", "sector": "regulator", "locations": ["All India"]},
            {"org": "NTPC", "post": "Executive Trainee (Mechanical)", "eligibility": "B.Tech", "sector": "psu"},
            {"org": "IBPS", "post": "Specialist Officer – Marketing", "eligibility": "MBA Marketing", "sector": "bank", "payLakh": 8},
            {"org": "APPSC", "post": "Group 1 Services", "eligibility": "Any degree", "sector": "state", "locations": ["Andhra Pradesh"]},
            {"org": "SSC", "post": "Constable GD", "eligibility": "10th pass", "sector": "central"},
        ]
        for c in cases:
            sc, why = score(c, profile)
            print(f"{sc:>3}  {c['org']:<7} {c['post']:<40} {', '.join(why)}")
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
