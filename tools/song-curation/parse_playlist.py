#!/usr/bin/env python3
"""Parse a scraped YouTube-playlist dump into upload-format candidate rows.

Input: a JSON array of {"id": <11-char>, "title": <video title>} (produced by
scraping a playlist page with Playwright). Video titles are typically
"Artist - Song (Prod. by ...)" — this splits artist/song on the first dash,
strips production credits / bracketed noise / trailing pipe segments, tags the
given genre, and APPENDS rows to a CSV in the importer's column order.

The artist/song split is best-effort; a separate clean-context validation pass
(and the human review tool) is expected to fix mislabels. Real video ids come
straight from YouTube, so they are guaranteed to exist (verify.py still confirms
embeddability + dedups against the live catalog).

Usage:
    python parse_playlist.py pl_dump.json --genre mizrahit --source "mako hitlist 2024" --out master.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
DASH = re.compile(r"\s+[-–—]\s+")  # surrounded-by-space hyphen / en / em dash
BRACKETS = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
NOISE = re.compile(
    r"(הקליפ הרשמי|קליפ רשמי|הרשמי|official music video|official video|official audio|"
    r"official|visualizer|lyrics?|audio|prod\.?\s*by.*|by\s+\w+.*|מתוך.*|live.*|"
    r"\bhd\b|\b4k\b|\bmv\b)",
    re.IGNORECASE,
)


def clean(text: str) -> str:
    text = BRACKETS.sub(" ", text)
    text = text.split("|")[0]  # drop "| English transliteration" / "| Official"
    text = text.split("//")[0]
    text = NOISE.sub(" ", text)
    text = re.sub(r"[\"'״]+", "", text)
    return re.sub(r"\s+", " ", text).strip(" -–—\t")


def parse(items: list[dict], genre: str, source: str) -> list[dict]:
    rows = []
    for it in items:
        vid = (it.get("id") or "").strip()
        raw = (it.get("title") or "").strip()
        if not YOUTUBE_ID.match(vid) or not raw:
            continue
        parts = DASH.split(raw, maxsplit=1)
        if len(parts) == 2:
            artist, song = clean(parts[0]), clean(parts[1])
        else:
            # No clear "Artist - Song" split; keep whole thing as title, blank
            # artist so the validation pass / reviewer notices and fixes it.
            artist, song = "", clean(raw)
        if not song:
            continue
        # Drop playlist banner / promo entries (no artist split + emoji or
        # playlist-marketing words or absurd length).
        if not artist and (
            len(song) > 45
            or re.search(r"[\U0001F000-\U0001FAFF☀-➿]", song)
            or any(w in song for w in ("פלייליסט", "מצעד", "playlist"))
        ):
            continue
        rows.append(
            {
                "title": song,
                "artist": artist,
                "youtube_id": vid,
                "start_time": "5",
                "genres": genre,
                "source": source,
            }
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dump", help="playlist dump JSON (array of {id,title})")
    ap.add_argument("--genre", required=True, help="genre slug to tag these rows")
    ap.add_argument("--source", default="youtube-playlist")
    ap.add_argument("--out", required=True, help="CSV to append to (created with header if absent)")
    args = ap.parse_args()

    items = json.loads(Path(args.dump).read_text(encoding="utf-8"))
    rows = parse(items, args.genre, args.source)

    fields = ["title", "artist", "youtube_id", "start_time", "genres", "source"]
    out = Path(args.out)
    exists = out.exists()
    with out.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if not exists:
            w.writeheader()
        w.writerows(rows)
    print(f"parsed {len(rows)} rows ({len(items)} items) → {out} [genre={args.genre}]")
    blank = sum(1 for r in rows if not r["artist"])
    if blank:
        print(f"  note: {blank} rows had no clear artist split (flagged blank artist)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
