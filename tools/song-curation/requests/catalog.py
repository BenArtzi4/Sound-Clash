#!/usr/bin/env python3
"""Search the live-catalog snapshot (_dumps/catalog_raw.json, read-only).

  python <tools>/requests/catalog.py <text> [<text> ...]   rows whose title OR artist contains
                                          every given text (case/niqqud/punct-
                                          insensitive, Hebrew יי/וו collapsed)
One line per hit: title | artist | youtube_id | year | genres
"""
import json
import sys
import unicodedata
from pathlib import Path

HERE = Path.cwd()  # always run from the batch folder
PUNCT = set("'\"`´׳״’‘“”|,.!?/\\-–—_:;+*()[]{}&")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = "".join(" " if ch in PUNCT else ch for ch in s.casefold())
    s = s.replace("יי", "י").replace("וו", "ו")
    return " ".join(s.split())


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    needles = [norm(a) for a in sys.argv[1:]]
    rows = json.loads((HERE / "_dumps" / "catalog_raw.json").read_text(encoding="utf-8"))["rows"]
    hits = 0
    for r in rows:
        hay = norm(r["title"]) + " | " + norm(r["artist"])
        if all(n in hay for n in needles):
            hits += 1
            print(f"{r['title']} | {r['artist']} | {r['youtube_id']} | {r['release_year']} | {r['genres']}")
    if not hits:
        print("(no catalog match)")


if __name__ == "__main__":
    main()
