#!/usr/bin/env python3
"""wanted.json -> packets/<n>.json for the research agents.

Keeps every song of one artist in the same packet (consistent genre/spelling
calls) and attaches the catalog songs that share an artist with the request,
so agents can spot spelling variants of songs we already have.

usage (from the batch folder): python <tools>/requests/make_packets.py [n_packets]
Also renders AGENT_GUIDE.template.md into the batch folder as AGENT_GUIDE.md.
"""
import json
import sys
from pathlib import Path

from parse_requests import artist_overlap, artist_parts

HERE = Path.cwd()  # always run from the batch folder


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    wanted = json.loads((HERE / "wanted.json").read_text(encoding="utf-8"))
    catalog = json.loads((HERE / "_dumps" / "catalog_raw.json").read_text(encoding="utf-8"))["rows"]

    by_artist = {}
    for w in wanted:
        key = sorted(artist_parts(w["artist"]), key=len)[0]
        by_artist.setdefault(key, []).append(w)
    groups = sorted(by_artist.values(), key=len, reverse=True)
    bins = [[] for _ in range(n)]
    for g in groups:
        min(bins, key=len).extend(g)

    out = HERE / "packets"
    out.mkdir(exist_ok=True)
    for i, b in enumerate(bins, 1):
        b.sort(key=lambda w: w["req"])
        for w in b:
            w["catalog_same_artist"] = [
                f"{c['title']} | {c['artist']} | {c['youtube_id']} | {c['release_year']} | {c['genres']}"
                for c in catalog if artist_overlap(w["artist"], c["artist"])
            ]
        (out / f"p{i}.json").write_text(json.dumps(b, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"p{i}: {len(b)} songs")

    tools = Path(__file__).resolve().parent
    guide = (tools / "AGENT_GUIDE.template.md").read_text(encoding="utf-8")
    guide = guide.replace("{BATCH_DIR}", HERE.resolve().as_posix()).replace("{TOOLS}", tools.as_posix())
    (HERE / "AGENT_GUIDE.md").write_text(guide, encoding="utf-8")
    print("wrote AGENT_GUIDE.md")


if __name__ == "__main__":
    main()
