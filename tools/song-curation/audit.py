#!/usr/bin/env python3
"""Audit: does every row's final artist+title actually match the real YouTube
video (oEmbed title + channel)? Re-scores the *final* names (after validate.py),
classifies, and writes suspects.json sorted worst-first for fixing."""
from __future__ import annotations
import json, re, unicodedata
from pathlib import Path

HERE = Path(__file__).parent
d = Path(HERE / "candidates.js").read_text(encoding="utf-8")
ROWS = json.loads(d.split("=", 1)[1].rsplit(";", 1)[0])

NIQQUD = re.compile(r"[֑-ׇ]")
def norm(s: str) -> str:
    s = NIQQUD.sub("", s or "")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = s.casefold()
    s = re.sub(r"[^\w֐-׿]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

STOP = {"ft", "feat", "the", "and", "x", "official", "video", "audio", "prod", "by",
        "ועד", "עם", "של", "live", "remix", "version", "hd", "mv"}
def toks(s: str):
    return [t for t in norm(s).split() if len(t) > 1 and t not in STOP]

def coverage(needle: str, haystack_norm: str) -> float:
    ts = toks(needle)
    if not ts:
        return 1.0
    return sum(1 for t in ts if t in haystack_norm) / len(ts)

ok, suspects = 0, []
for r in ROWS:
    artist, title = r.get("artist", ""), r.get("title", "")
    hay = norm((r.get("oembed_title") or "") + " " + (r.get("oembed_author") or ""))
    a_cov, t_cov = coverage(artist, hay), coverage(title, hay)
    # reversal check: artist text appears where title should and vice-versa
    reversed_ = coverage(artist, norm(r.get("title", ""))) if False else None
    if a_cov >= 0.5 and t_cov >= 0.5:
        ok += 1
    else:
        suspects.append({
            "id": r["youtube_id"], "artist": artist, "title": title,
            "a_cov": round(a_cov, 2), "t_cov": round(t_cov, 2),
            "oembed": r.get("oembed_title", ""), "channel": r.get("oembed_author", ""),
            "genre": r["genres"][0] if r["genres"] else "",
        })

suspects.sort(key=lambda s: s["a_cov"] + s["t_cov"])
Path(HERE / "suspects.json").write_text(json.dumps(suspects, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"audited {len(ROWS)} | clean match: {ok} | suspects: {len(suspects)} ({100*ok//len(ROWS)}% clean)")
