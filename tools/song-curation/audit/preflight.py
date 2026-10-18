#!/usr/bin/env python3
"""Pre-apply checks on apply_plan.json (make_sql.py) against a FRESH prod dump.

Problems (any one = don't apply): a song the plan touches changed or vanished
on prod since the snapshot the cards were built from (rebuild those cards or
reject them); one video on two songs after the apply; empty or padded names; a
year outside 1900..next year; unknown or empty genres; a new video that is not
playable / embeddable / allowed in Israel in the cached data; a start time past
the end of its video; a song left with no genre.
Warnings: prod changes the plan doesn't touch (e.g. songs uploaded during a long
review), and new videos that keep the old video's start time (the maintainer may
want to re-set them on the admin page afterwards).
Writes playtest_plan.json: every new video with its final start, to play-test
BEFORE the apply (the cached video data can be days old by now).

usage (from the batch folder): python <tools>/audit/preflight.py _dumps/<fresh catalog dump>.json
"""
import sys
import time

import common as C

plan = C.read_json("apply_plan.json")
now = {r["id"]: r for r in C.supabase_rows(sys.argv[1])}
snap = {r["id"]: r for r in C.read_json("catalog.json")}
GENRES = set(C.genres())
MAX_YEAR = int(time.strftime("%Y")) + 1
problems, warnings = [], []

by_song = {p["song_id"]: p for p in plan}
F = ["title", "artist", "youtube_id", "start_time", "release_year", "genres"]
changed = [(k, f) for k in snap if k in now for f in F if snap[k][f] != now[k][f]]
touched = [(k, f) for k, f in changed if k in by_song]
vanished = [k for k in by_song if k not in now]
if touched or vanished:
    problems.append(f"songs in the plan changed on prod since the snapshot: {touched[:10]}, gone: {vanished[:10]} "
                    f"(snapshot.py --compare shows them all)")
added = [k for k in now if k not in snap]
other = [(k, f) for k, f in changed if k not in by_song]
gone_other = [k for k in snap if k not in now and k not in by_song]
if added or other or gone_other:
    warnings.append(f"prod changed outside the plan (fine, the plan doesn't touch these): +{len(added)} songs, "
                    f"{len(other)} field changes, -{len(gone_other)} songs")
deleted = {p["song_id"] for p in plan if p["delete"]}
final_vid = {}
for sid, r in now.items():
    if sid in deleted:
        continue
    vid = by_song.get(sid, {}).get("set", {}).get("youtube_id", r["youtube_id"])
    final_vid.setdefault(vid, []).append(sid)
dups = {v: s for v, s in final_vid.items() if len(s) > 1}
if dups:
    problems.append(f"one video on two songs after apply: {dups}")

for p in plan:
    if p["delete"]:
        continue
    if p["song_id"] not in now:
        problems.append(f"{p['was']['title']} — {p['was']['artist']}: song no longer exists")
        continue
    s, st = now[p["song_id"]], p["set"]
    label = f"{s['title']} — {s['artist']}"
    for f in ("title", "artist"):
        if f in st and not (1 <= len(st[f].strip()) <= 200):
            problems.append(f"{label}: bad {f} {st[f]!r}")
        if f in st and st[f] != st[f].strip():
            problems.append(f"{label}: {f} has leading/trailing spaces {st[f]!r}")
    if "release_year" in st and st["release_year"] is not None and not 1900 <= st["release_year"] <= MAX_YEAR:
        problems.append(f"{label}: release_year {st['release_year']}")
    if "genres" in st and (not st["genres"] or set(st["genres"]) - GENRES):
        problems.append(f"{label}: genres {st['genres']}")
    vid = st.get("youtube_id", s["youtube_id"])
    start = st.get("start_time", s["start_time"])
    m = C.meta(vid)
    if not m:
        problems.append(f"{label}: no metadata for video {vid} (run yt.py info {vid} with the gateway up)")
        continue
    if "youtube_id" in st and (m.get("status") != "OK" or m.get("playableInEmbed") is False or m.get("il") is False):
        problems.append(f"{label}: new video {vid} not playable: {m.get('status')} "
                        f"embed={m.get('playableInEmbed')} IL={m.get('il')}")
    if m.get("length") and start > m["length"] - 15:
        problems.append(f"{label}: start {start}s is past the end of {vid} ({m['length']}s)")
    if "youtube_id" in st and "start_time" not in st and start > 0:
        warnings.append(f"{label}: new video keeps the old start {start}s")

for sid, r in now.items():
    if sid in deleted:
        continue
    g = by_song.get(sid, {}).get("set", {}).get("genres", [x for x in r["genres"].split(";") if x])
    if not g:
        problems.append(f"{r['title']} — {r['artist']}: no genre after apply")

play = [{"id": p["set"]["youtube_id"],
         "start": p["set"].get("start_time", now[p["song_id"]]["start_time"] if p["song_id"] in now else 0),
         "title": p["set"].get("title", p["was"]["title"])}
        for p in plan if not p["delete"] and "youtube_id" in p["set"]]
C.write_json("playtest_plan.json", play)
print(f"plan: {len(deleted)} deletes, {sum(1 for p in plan if not p['delete'])} updates; "
      f"catalog after apply: {len(now) - len(deleted)} songs")
print("PROBLEMS:", len(problems))
for x in problems:
    print("  -", x)
print("warnings:", len(warnings))
for x in warnings[:60]:
    print("  ~", x)
print(f"playtest_plan.json: {len(play)} new videos to play-test before applying")
