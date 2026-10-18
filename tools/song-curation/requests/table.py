#!/usr/bin/env python3
"""The mandatory eyeball pass: every card in candidates.js on one line,
  line | title — artist [year; genres; confidence] || YouTube title || channel badge views upload
into _dumps/table.txt (Read it; the console garbles Hebrew). Look for a channel
or title that doesn't match the performer or the song, a cover / tribute / live
upload where a studio version exists, and one artist with inconsistent genres.
Fix research/pN.json and re-run finalize.py (the gateway must still be up).

usage (from the batch folder): python <tools>/requests/table.py
"""
import json
from pathlib import Path

HERE = Path.cwd()  # the batch folder


def human(n):
    if n is None:
        return "?"
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.1f}{suf}"
    return str(n)


s = (HERE / "candidates.js").read_text(encoding="utf-8")
cards = json.loads(s[s.index("["):s.rindex("]") + 1])
out = []
for c in sorted(cards, key=lambda c: (c.get("artist") or "", c.get("title") or "")):
    req = c.get("request") or {}
    genres = c.get("genres") or []
    genres = ";".join(genres) if isinstance(genres, list) else genres
    flags = "; ".join(f["text"] for f in c.get("flags") or [] if f.get("level") != "info")
    out.append(f"{req.get('line', '?')} | {c.get('title')} — {c.get('artist')} [{c.get('release_year')}; {genres}; "
               f"{c.get('confidence')}] || {c.get('oembed_title')} || {c.get('channel')} {c.get('channel_badge') or ''} "
               f"{human(c.get('views'))} {c.get('upload_date') or ''}" + (f"  !! {flags}" if flags else ""))
(HERE / "_dumps").mkdir(exist_ok=True)
(HERE / "_dumps" / "table.txt").write_text("\n".join(out), encoding="utf-8", newline="\n")
print(f"{len(out)} cards -> _dumps/table.txt")
