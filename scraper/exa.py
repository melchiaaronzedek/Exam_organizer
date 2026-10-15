#!/usr/bin/env python3
"""Exa (api.exa.ai) client for job research: neural web search with page text, and page reads for sites that block us.

Needs EXA_API_KEY. The key is sent only as a header and never logged. Both calls raise RuntimeError with the
conventional prefixes the portal scanner understands: "off (no key)" and "blocked (exa http N)".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import requests

from common import env

SEARCH_URL = "https://api.exa.ai/search"
CONTENTS_URL = "https://api.exa.ai/contents"
TIMEOUT = 45


def _key() -> str:
    key = env("EXA_API_KEY")
    if not key:
        raise RuntimeError("off (no key)")
    return key


def _post(url: str, payload: dict) -> dict:
    r = requests.post(url, json=payload, headers={"x-api-key": _key(), "Content-Type": "application/json", "Accept": "application/json"}, timeout=TIMEOUT)
    if r.status_code >= 400:
        raise RuntimeError(f"blocked (exa http {r.status_code})")
    return r.json()


def exa_search(query: str, num: int = 25, days: int = 21, exclude: list[str] | None = None, max_chars: int = 2500) -> list[dict]:
    """Fresh pages matching `query`, each with its text: [{title, url, publishedDate, author, text}]."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00.000Z")
    payload: dict = {"query": query, "type": "auto", "numResults": max(1, min(num, 100)), "startPublishedDate": since, "contents": {"text": {"maxCharacters": max_chars}}}
    if exclude:
        payload["excludeDomains"] = [d for d in exclude if d][:100]
    data = _post(SEARCH_URL, payload)
    return [
        {"title": r.get("title") or "", "url": r.get("url") or "", "publishedDate": r.get("publishedDate"), "author": r.get("author"), "text": r.get("text") or ""}
        for r in data.get("results") or [] if r.get("url")
    ]


def exa_contents(urls: list[str], max_chars: int = 4000) -> dict[str, str]:
    """Page text for each URL (Exa crawls live when its index lacks the page), keyed by the URL as given."""
    out: dict[str, str] = {}
    urls = [u for u in urls if u]
    for i in range(0, len(urls), 10):
        batch = urls[i:i + 10]
        data = _post(CONTENTS_URL, {"urls": batch, "text": {"maxCharacters": max_chars}, "livecrawl": "fallback"})
        got = {(r.get("url") or "").rstrip("/"): r.get("text") or "" for r in data.get("results") or []}
        for u in batch:
            text = got.get(u.rstrip("/")) or got.get(u.split("?")[0].rstrip("/")) or ""
            if text.strip():
                out[u] = text
    return out
