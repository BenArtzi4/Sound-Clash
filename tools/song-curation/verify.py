#!/usr/bin/env python3
"""Verify candidate songs against YouTube oEmbed and emit candidates.js.

Input: a CSV in the upload column order (title,artist,youtube_id,start_time,
genres) — optionally a trailing ``source`` column noting where the pick came
from. For every row this script calls the keyless YouTube oEmbed endpoint
(https://www.youtube.com/oembed) to confirm the id is real AND embeddable, and
to fetch the *actual* video title + channel. It then scores how well the
proposed title/artist match what YouTube returns, flags catalog duplicates, and
writes ``candidates.js`` (``window.CANDIDATES = [...]``) for review.html.

stdlib only — no new dependency. Network egress is blocked in the sandbox, so
run this with the sandbox disabled (the harness supports that).

Usage:
    python verify.py candidates_in.csv \
        --existing prod_catalog.csv \
        --out batches/2026-06-18/candidates.js
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

VALID_SLUGS = {
    "rock",
    "pop",
    "hip-hop",
    "electronic",
    "soundtracks",
    "israeli-pop",
    "israeli-cover",
    "israeli-rock-pop",
    "israeli-rap-hip-hop",
    "mizrahit",
    "israeli-soundtracks",
}

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
HEBREW_NIQQUD = re.compile(r"[֑-ׇ]")
# Promotional noise we strip from YouTube titles before token-matching.
NOISE = re.compile(
    r"\b(official|video|audio|music|lyric|lyrics|hd|hq|4k|mv|m/?v|prod|"
    r"visualizer|remaster(ed)?|version|live|clip|feat|ft)\b",
    re.IGNORECASE,
)


def normalize(text: str) -> str:
    """Casefold, drop diacritics (latin) + Hebrew niqqud, strip punctuation."""
    text = HEBREW_NIQQUD.sub("", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.casefold()
    text = re.sub(r"[^\w֐-׿]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> set[str]:
    return {t for t in normalize(NOISE.sub(" ", text)).split() if len(t) > 1}


def oembed(video_id: str) -> dict | None:
    """Return oEmbed JSON for an embeddable video, or None if unusable."""
    url = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
        {"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "soundclash-curation/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        # 401 = embedding disabled, 403/404 = private/removed. All unusable.
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def match_status(
    title: str,
    artist: str,
    oembed_title: str,
    oembed_author: str,
) -> str:
    """ok / check-title / check-artist / mismatch from token overlap."""
    haystack = tokens(oembed_title) | tokens(oembed_author)
    title_tok = tokens(title)
    artist_tok = tokens(artist)

    def covered(needles: set[str]) -> bool:
        if not needles:
            return True
        hit = len(needles & haystack)
        return hit / len(needles) >= 0.6

    title_ok = covered(title_tok)
    artist_ok = covered(artist_tok)
    if title_ok and artist_ok:
        return "ok"
    if title_ok:
        return "check-artist"
    if artist_ok:
        return "check-title"
    return "mismatch"


def load_existing(paths: list[str]) -> tuple[set[str], set[tuple[str, str]]]:
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for p in paths:
        text = Path(p).read_text(encoding="utf-8-sig")
        reader = csv.DictReader(text.splitlines())
        for row in reader:
            vid = (row.get("youtube_id") or "").strip()
            if vid:
                ids.add(vid)
            t = normalize(row.get("title") or "")
            a = normalize(row.get("artist") or "")
            if t and a:
                pairs.add((t, a))
    return ids, pairs


def parse_input(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    rows: list[dict] = []
    for i, raw in enumerate(reader, start=2):
        vid = (raw.get("youtube_id") or "").strip()
        title = (raw.get("title") or "").strip()
        artist = (raw.get("artist") or "").strip()
        if not vid and not title:
            continue
        if not YOUTUBE_ID.match(vid):
            print(f"  row {i}: bad youtube_id {vid!r} (kept, flagged)", file=sys.stderr)
        start_raw = (raw.get("start_time") or "0").strip()
        try:
            start = max(0, int(start_raw)) if start_raw else 0
        except ValueError:
            start = 0
        genres = [g.strip() for g in (raw.get("genres") or "").split(";") if g.strip()]
        bad = [g for g in genres if g not in VALID_SLUGS]
        if bad:
            print(f"  row {i}: unknown genre slug(s) {bad} (kept; fix in review tool)", file=sys.stderr)
        rows.append(
            {
                "title": title,
                "artist": artist,
                "youtube_id": vid,
                "start_time": start,
                "genres": genres,
                "source": (raw.get("source") or "").strip(),
            }
        )
    return rows


def verify_row(row: dict, existing_ids: set[str], existing_pairs: set[tuple[str, str]]) -> dict:
    vid = row["youtube_id"]
    out = dict(row)
    if not YOUTUBE_ID.match(vid):
        out.update(valid=False, oembed_title="", oembed_author="", thumbnail="", match_status="bad-id-format")
        return out

    data = oembed(vid)
    if data is None:
        out.update(
            valid=False,
            oembed_title="",
            oembed_author="",
            thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            match_status="invalid",
        )
        return out

    o_title = data.get("title", "")
    o_author = data.get("author_name", "")
    thumb = data.get("thumbnail_url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

    if vid in existing_ids or (
        normalize(row["title"]) and (normalize(row["title"]), normalize(row["artist"])) in existing_pairs
    ):
        status = "duplicate"
    else:
        status = match_status(row["title"], row["artist"], o_title, o_author)

    out.update(
        valid=True,
        oembed_title=o_title,
        oembed_author=o_author,
        thumbnail=thumb,
        match_status=status,
    )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="candidate CSV (upload column order, optional 'source')")
    ap.add_argument(
        "--existing",
        action="append",
        default=[],
        help="CSV with youtube_id/title/artist of already-catalogued songs (repeatable)",
    )
    ap.add_argument("--out", default=None, help="output candidates.js path")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    rows = parse_input(args.input)
    if not rows:
        print("No candidate rows found.", file=sys.stderr)
        return 1
    existing_ids, existing_pairs = load_existing(args.existing)
    print(
        f"Verifying {len(rows)} candidates against oEmbed "
        f"({len(existing_ids)} existing ids loaded for dedup)…",
        file=sys.stderr,
    )

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda r: verify_row(r, existing_ids, existing_pairs), rows))

    by_status: dict[str, int] = {}
    for r in results:
        by_status[r["match_status"]] = by_status.get(r["match_status"], 0) + 1

    out_path = Path(args.out) if args.out else Path(__file__).parent / "batches" / date.today().isoformat() / "candidates.js"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = "window.CANDIDATES = " + json.dumps(results, ensure_ascii=False, indent=2) + ";\n"
    out_path.write_text(payload, encoding="utf-8")

    print(f"Wrote {len(results)} candidates → {out_path}", file=sys.stderr)
    for status, n in sorted(by_status.items(), key=lambda kv: -kv[1]):
        print(f"  {status:16} {n}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
