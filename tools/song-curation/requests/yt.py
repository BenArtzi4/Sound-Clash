#!/usr/bin/env python3
"""CLI for the local YouTube gateway (ytproxy.py on :8791). Never call YouTube
directly from an agent: go through this so requests are paced and cached.

  yt.py search "artist song" [-n 8] [--views]   one line per hit:
        id | views | m:ss | channel [badge] | title | age
        (--views: most viewed first instead of relevance; one page, ~20 hits,
        so vary the query — "<artist>", "<artist> Topic", album names — for more)
  yt.py info ID [ID ...]              one block per video:
        status/embed/IL, views, length, upload date, channel [badge], title,
        YouTube's own music credits (song / artist / album) when present
  yt.py status                        gateway queue / cooldown
"""
from __future__ import annotations
import json, sys, urllib.parse, urllib.request

BASE = "http://127.0.0.1:8791"


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=1000) as r:
        return json.loads(r.read().decode("utf-8"))


def human(n):
    if n is None:
        return "?"
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.1f}{suf}"
    return str(n)


def mmss(s):
    return "?" if s is None else f"{s // 60}:{s % 60:02d}"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "status":
        print(get("/status"))
    elif cmd == "search":
        n = int(sys.argv[sys.argv.index("-n") + 1]) if "-n" in sys.argv else 8
        q = sys.argv[2]
        sort = "&sort=views" if "--views" in sys.argv else ""
        for h in get(f"/search?n={n}{sort}&q=" + urllib.parse.quote(q)):
            badge = f" [{h['badge']}]" if h.get("badge") else ""
            print(f"{h['id']} | {human(h['views'])} | {mmss(h['length'])} | {h['channel']}{badge} | {h['title']} | {h.get('age') or ''}")
    elif cmd == "info":
        for vid in sys.argv[2:]:
            try:
                d = get("/info?id=" + urllib.parse.quote(vid))
            except Exception as e:  # noqa: BLE001
                print(f"{vid}: ERROR {e}")
                continue
            badge = "artist" if "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in (d.get("badges") or []) else (
                "verified" if "BADGE_STYLE_TYPE_VERIFIED" in (d.get("badges") or []) else "")
            print(f"{vid}: status={d.get('status')} {d.get('reason') or ''} embed={d.get('playableInEmbed')} IL={d.get('il')}")
            print(f"   views={human(d.get('views'))} len={mmss(d.get('length'))} uploaded={(d.get('uploadDate') or '')[:10]} live={d.get('isLive')}")
            print(f"   channel={d.get('author')} [{badge}] subs={d.get('subs')}")
            print(f"   title={d.get('title')}")
            for m in d.get("music") or []:
                print(f"   music: {json.dumps(m, ensure_ascii=False)}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
