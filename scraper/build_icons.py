#!/usr/bin/env python3
"""Render PWA icons (PNG) from a simple monogram. Needs Pillow."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from common import ROOT

OUT = Path(ROOT) / "public" / "icons"
BG = (11, 13, 18)
ACCENT = (244, 164, 66)
BONE = (236, 230, 217)


def font(size: int):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = int(size * (0.18 if maskable else 0.08))
    r = int(size * 0.22)
    d.rounded_rectangle((pad, pad, size - pad, size - pad), radius=r, fill=(21, 25, 35), outline=(40, 44, 56), width=max(2, size // 128))
    d.rounded_rectangle((pad + size * 0.12, size - pad - size * 0.17, size - pad - size * 0.12, size - pad - size * 0.12), radius=size // 64, fill=ACCENT)
    f = font(int(size * 0.42))
    text = "Pd"
    bbox = d.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1] - size * 0.04), text, font=f, fill=BONE)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(192, False).save(OUT / "icon-192.png")
    render(512, False).save(OUT / "icon-512.png")
    render(512, True).save(OUT / "icon-maskable-512.png")
    render(180, False).save(OUT / "apple-touch-icon.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
