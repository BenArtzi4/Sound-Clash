#!/usr/bin/env python3
"""After the apply: card-by-card proof that every approved decision is live on
prod exactly as decided, every rejected one is not, and nothing outside the
decisions changed. Also writes playtest_songs.json (every new video + its
start) for tools/song-curation/playtest/.

usage (from the batch folder):
  python <tools>/audit/validate.py _dumps/<catalog dump taken after the apply>.json
"""
import sys

import common as C

items = {i["id"]: i for i in C.read_json("items.json")["items"]}
dec = C.read_json("decisions.json", {})
before = {r["id"]: r for r in C.read_json("catalog.json")}
now = {r["id"]: r for r in C.supabase_rows(sys.argv[1])}


def val(r, f):
    return sorted(x for x in r["genres"].split(";") if x) if f == "genres" else r[f]


def norm(f, v):
    return sorted(v) if f == "genres" else v


undecided = [k for k in items if (dec.get(k) or {}).get("status") not in ("approved", "rejected")]
ok_cards, bad, rej_ok, rej_overlap = 0, [], 0, []
deleted_by_decision, expected = set(), {}
# duplicates first, so a field card on a deleted copy counts as moot
order = sorted(dec.items(), key=lambda kv: items[kv[0]]["kind"] not in ("duplicate", "maybe_dup") if kv[0] in items else 1)
for iid, d in order:
    if iid not in items or not d:
        continue
    it, st = items[iid], d.get("status")
    p = it.get("proposal") or {}
    if st == "approved":
        if it["kind"] in ("duplicate", "maybe_dup"):
            keep = d.get("keep") or p.get("keep")
            for s in it["songs"]:
                if s["id"] == keep:
                    if keep not in now:
                        bad.append((iid, "kept copy is missing"))
                    for f, v in (d["fields"] if "fields" in d else p.get("fields") or {}).items():
                        expected.setdefault(keep, {})[f] = norm(f, v)
                        if keep in now and val(now[keep], f) != norm(f, v):
                            bad.append((iid, f"kept {f}", norm(f, v), val(now[keep], f)))
                else:
                    deleted_by_decision.add(s["id"])
                    if s["id"] in now:
                        bad.append((iid, "duplicate copy still present", s["title"]))
            ok_cards += 1
            continue
        sid = it["songs"][0]["id"]
        if p.get("action") == "delete":
            deleted_by_decision.add(sid)
            if sid in now:
                bad.append((iid, "song should be deleted"))
            ok_cards += 1
            continue
        if sid in deleted_by_decision or sid not in now:
            ok_cards += 1  # moot: song deleted via its duplicate card
            continue
        for f, v in (d["fields"] if "fields" in d else (p.get("fields") or {})).items():
            expected.setdefault(sid, {})[f] = norm(f, v)
            if val(now[sid], f) != norm(f, v):
                bad.append((iid, it["songs"][0]["title"], f, norm(f, v), val(now[sid], f)))
        ok_cards += 1
    elif st == "rejected":
        if it["kind"] in ("duplicate", "maybe_dup"):
            gone = [s for s in it["songs"] if s["id"] not in now and s["id"] not in deleted_by_decision]
            if gone:
                rej_overlap.append((iid, "rejected duplicate but a copy is gone", [s["title"] for s in gone]))
            else:
                rej_ok += 1
            continue
        sid = it["songs"][0]["id"]
        if sid not in now:
            rej_overlap.append((iid, "song gone (deleted by another approved card)"))
            continue
        applied = [f for f, v in (p.get("fields") or {}).items()
                   if norm(f, v) == val(now[sid], f) and norm(f, v) != val(before[sid], f)]
        if applied:
            rej_overlap.append((iid, it["songs"][0]["title"], "same value applied by another card:", applied))
        else:
            rej_ok += 1

F = ["title", "artist", "youtube_id", "start_time", "release_year", "genres"]
stray = []
for sid, r in before.items():
    if sid not in now:
        if sid not in deleted_by_decision:
            stray.append(("deleted without a decision", r["title"], r["artist"]))
        continue
    for f in F:
        if val(now[sid], f) != val(r, f) and f not in expected.get(sid, {}):
            stray.append(("changed without a decision", r["title"], f, val(r, f), val(now[sid], f)))
new_songs = [k for k in now if k not in before]

play = [{"id": now[sid]["youtube_id"], "start": now[sid]["start_time"], "title": now[sid]["title"]}
        for sid in now if sid in before and now[sid]["youtube_id"] != before[sid]["youtube_id"]]
C.write_json("playtest_songs.json", play)

print(f"cards: {len(items)} | undecided (= rejected): {len(undecided)}")
print(f"approved cards live exactly as decided: {ok_cards} | mismatches: {len(bad)}")
for b in bad[:20]:
    print("   !", b)
print(f"rejected cards not applied: {rej_ok} | rejected-but-same-value-applied-elsewhere: {len(rej_overlap)}")
for b in rej_overlap[:20]:
    print("   ~", b)
print(f"songs deleted: {sum(1 for k in before if k not in now)} (by decisions: {len(deleted_by_decision)}); "
      f"songs added on prod since the snapshot (not the audit's doing): {len(new_songs)}")
print(f"changes on prod not explained by a decision: {len(stray)}")
for s in stray[:20]:
    print("   !", s)
print(f"prod now: {len(now)} songs, no genre: {sum(1 for r in now.values() if not r['genres'])}, "
      f"duplicate videos: {len(now) - len({r['youtube_id'] for r in now.values()})}, "
      f"flagged unavailable: {sum(1 for r in now.values() if r.get('unavailable_at'))}")
print(f"playtest_songs.json: {len(play)} new videos to play-test")
