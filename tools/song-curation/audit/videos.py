#!/usr/bin/env python3
"""The mandatory eyeball pass: every card that changes a video, one block each,
current video vs proposed, into _dumps/videos.txt (Read it; the console garbles
Hebrew). The commonest failure is the wrong performer: a cover or tribute, or
the right artist's other song. Drop a bad card by adding its id to
drop_items.txt (or fix the agent's proposals file) and re-run merge.py.

usage (from the batch folder): python <tools>/audit/videos.py
"""
import common as C


def human(n):
    if n is None:
        return "?"
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.1f}{suf}"
    return str(n)


def mmss(s):
    return "?" if s is None else f"{s // 60}:{s % 60:02d}"


out, n = [], 0
for it in C.read_json("items.json")["items"]:
    if not it.get("candidates"):
        continue
    n += 1
    s = it["songs"][0]
    y = s["yt"]
    out.append(f"[{it['id']}] {it['kind']} sev{it['severity']} {it.get('confidence') or ''} — {s['title']} — {s['artist']} "
               f"({s['release_year']}; {';'.join(s['genres'])}; start {s['start_time']}s; played {s['plays']}x)")
    out.append(f"   now : {y.get('channel')} [{y.get('badge')}] {human(y.get('views'))} {mmss(y.get('length'))} | {y.get('title')}")
    for c in it["candidates"]:
        out.append(f"   new : {c.get('channel')} [{c.get('badge')}] {human(c.get('views'))} {mmss(c.get('length'))} "
                   f"| {c.get('title')} | {c['youtube_id']}")
        if c.get("note"):
            out.append(f"         {c['note']}")
    out.append(f"   why : {it['summary']}")
    out.append("")
(C.HERE / "_dumps").mkdir(exist_ok=True)
(C.HERE / "_dumps" / "videos.txt").write_text("\n".join(out), encoding="utf-8", newline="\n")
print(f"{n} video cards -> _dumps/videos.txt")
