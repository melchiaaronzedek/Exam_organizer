#!/usr/bin/env python3
"""List files under public/documents/<examId>/<type>__<name> into public/data/documents.json."""
from __future__ import annotations

import json
from pathlib import Path

from common import ROOT, save_json

DOCS = Path(ROOT) / "public" / "documents"
TYPES = {"application", "hall-ticket", "notification", "receipt", "photo", "result", "other"}


def main() -> None:
    out = []
    if DOCS.exists():
        for f in sorted(DOCS.rglob("*")):
            if not f.is_file() or f.name.startswith("."):
                continue
            rel = f.relative_to(DOCS)
            exam_id = rel.parts[0] if len(rel.parts) > 1 else "other"
            name = f.name
            typ, _, rest = name.partition("__")
            if typ not in TYPES:
                low = name.lower()
                if any(k in low for k in ("hall", "admit", "call_letter", "call letter", "calllet")):
                    typ = "hall-ticket"
                elif "applic" in low:
                    typ = "application"
                elif any(k in low for k in ("receipt", "payment", "fee")):
                    typ = "receipt"
                elif any(k in low for k in ("result", "score", "marks")):
                    typ = "result"
                elif any(k in low for k in ("notif", "advert", "advt")):
                    typ = "notification"
                else:
                    typ = "other"
                rest = name
            out.append(
                {
                    "examId": exam_id,
                    "type": typ,
                    "name": rest.replace("_", " ").rsplit(".", 1)[0],
                    "file": rest,
                    "url": "documents/" + "/".join(rel.parts),
                    "size": f.stat().st_size,
                    "ext": f.suffix.lower().lstrip("."),
                }
            )
    save_json("documents.json", {"count": len(out), "documents": out})
    print(f"{len(out)} documents listed")


if __name__ == "__main__":
    main()
