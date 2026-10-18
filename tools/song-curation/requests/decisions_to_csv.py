#!/usr/bin/env python3
"""decisions.json + candidates.js -> approved-songs-<batch>.csv, the same file
the review page's "Export approved CSV" button writes (review.js exportCsv):
title, artist, youtube_id, start_time, genres, release_year, with the
maintainer's edits (title, artist, year, genres, start, swapped video) applied.

Use it when the maintainer finished clicking but didn't press Export. It
refuses to write rows with no title, artist or genre, a bad video id, or a
video that failed to play during the review.

usage (from the batch folder): python <tools>/requests/decisions_to_csv.py
"""
import csv
import json
import re
from collections import Counter
from pathlib import Path

HERE = Path.cwd()  # the batch folder
VALID = {"rock", "pop", "hip-hop", "electronic", "soundtracks", "israeli-pop", "israeli-cover",
         "israeli-rock-pop", "israeli-rap-hip-hop", "mizrahit", "israeli-soundtracks"}
YT = re.compile(r"^[A-Za-z0-9_-]{11}$")
ENV_ERRORS = {152, 153}  # review.js: errors that say nothing about the video


def main() -> None:
    s = (HERE / "candidates.js").read_text(encoding="utf-8")
    cands = json.loads(s[s.index("["):s.rindex("]") + 1])
    doc = json.loads((HERE / "decisions.json").read_text(encoding="utf-8"))
    dec, errors = doc.get("decisions") or {}, doc.get("errors") or {}
    seen, rows, problems = Counter(), [], []
    for c in cands:
        seen[c["youtube_id"]] += 1
        key = c["youtube_id"] if seen[c["youtube_id"]] == 1 else f"{c['youtube_id']}~{seen[c['youtube_id']]}"
        r = dec.get(key) or {}
        if r.get("status") != "approved":
            continue
        genres_in = c.get("genres") or []
        if isinstance(genres_in, str):
            genres_in = [g.strip() for g in re.split(r"[;,]", genres_in) if g.strip()]
        title = (r["title"] if "title" in r else c.get("title") or "").strip()
        artist = (r["artist"] if "artist" in r else c.get("artist") or "").strip()
        vid = r.get("video") or c["youtube_id"]
        genres = [g for g in (r.get("genres") or genres_in) if g in VALID]
        year = r["release_year"] if "release_year" in r else c.get("release_year")
        start = r["start_time"] if isinstance(r.get("start_time"), (int, float)) \
            else max(0, round(c.get("start_time") or 0))
        name = f"{title or '(no title)'} — {artist or '(no artist)'}"
        if not title or not artist or not genres:
            problems.append(f"{name}: missing title, artist or genre")
        if not YT.match(vid):
            problems.append(f"{name}: bad youtube_id {vid}")
        err = errors.get(vid)
        if err and err.get("code") not in ENV_ERRORS:
            problems.append(f"{name}: video failed to play in the review (error {err.get('code')})")
        rows.append([title, artist, vid, int(start), ";".join(genres), "" if year is None else year])
    if problems:
        print("NOT WRITTEN — fix these on the review page first:")
        for p in problems:
            print("  -", p)
        raise SystemExit(1)
    out = HERE / f"approved-songs-{re.sub(r'[^A-Za-z0-9._-]', '_', HERE.name)}.csv"
    with open(out, "w", encoding="utf-8-sig", newline="") as f:  # same BOM + CRLF as the page's export
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(["title", "artist", "youtube_id", "start_time", "genres", "release_year"])
        w.writerows(rows)
    print(f"{len(rows)} approved -> {out.name}; by artist: "
          f"{dict(Counter(r[1].split(' & ')[0].split(' ft. ')[0] for r in rows).most_common(10))}")


if __name__ == "__main__":
    main()
