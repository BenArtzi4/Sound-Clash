#!/usr/bin/env python3
"""Turn the read-only prod dumps in _dumps/ into the audit's working files.

Inputs (each the stdout of `supabase db query --linked "<sql>" > _dumps/<file>`,
the exact SQL is in the audit-songs skill):
  _dumps/catalog_raw.json   songs + ';'-joined genre slugs
  _dumps/plays_raw.json     times each youtube_id was played in real games
  _dumps/genres_raw.json    every genre slug

Outputs: catalog.json, plays.json, genres.json, snapshot.json (when it was
taken), and a short report: catalog size, gaps, and how many songs were added
since the newest earlier audit (those are the ones agents research by default).

usage (from the batch folder): python <tools>/audit/snapshot.py
       python <tools>/audit/snapshot.py --compare _dumps/<fresh dump>.json
           prints every difference between the snapshot and a fresh dump
           (run before applying: the cards are only valid if nothing changed)
"""
from __future__ import annotations

import collections
import sys
import time

import common as C

F = ["title", "artist", "youtube_id", "start_time", "release_year", "genres"]


def compare(path: str) -> None:
    snap = {r["id"]: r for r in C.read_json("catalog.json")}
    now = {r["id"]: r for r in C.supabase_rows(path)}
    added = [now[k] for k in now if k not in snap]
    gone = [snap[k] for k in snap if k not in now]
    changed = [(k, f, snap[k][f], now[k][f]) for k in snap if k in now for f in F if snap[k][f] != now[k][f]]
    print(f"snapshot {len(snap)} songs, prod now {len(now)}: +{len(added)} added, -{len(gone)} gone, "
          f"{len(changed)} field changes")
    for r in added[:20]:
        print(f"  + {r['title']} — {r['artist']} ({r['id'][:8]})")
    for r in gone[:20]:
        print(f"  - {r['title']} — {r['artist']} ({r['id'][:8]})")
    for k, f, a, b in changed[:40]:
        print(f"  ~ {snap[k]['title']} — {snap[k]['artist']} ({k[:8]}) {f}: {a!r} -> {b!r}")
    print("UNCHANGED" if not (added or gone or changed) else "CHANGED")


def main() -> None:
    if "--compare" in sys.argv:
        return compare(sys.argv[sys.argv.index("--compare") + 1])
    rows = C.supabase_rows(C.HERE / "_dumps" / "catalog_raw.json")
    C.write_json("catalog.json", rows)
    plays = {r["youtube_id"]: int(r["plays"]) for r in C.supabase_rows(C.HERE / "_dumps" / "plays_raw.json")}
    C.write_json("plays.json", plays, indent=None)
    genres = sorted(r["slug"] for r in C.supabase_rows(C.HERE / "_dumps" / "genres_raw.json"))
    C.write_json("genres.json", genres, indent=None)
    # UTC, like songs.created_at: the next audit treats songs created after it as new
    C.write_json("snapshot.json", {"taken_at_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
                                   "songs": len(rows)})

    h = C.history()
    since = h["cutoff"]
    new = [r for r in rows if C.is_new(r, h)]
    gc = collections.Counter(g for r in rows for g in r["genres"].split(";") if g)
    print(f"catalog {len(rows)} songs; genres {dict(gc)}")
    print(f"no genre {sum(1 for r in rows if not r['genres'])}, no year "
          f"{sum(1 for r in rows if r['release_year'] is None)}, flagged unavailable "
          f"{sum(1 for r in rows if r.get('unavailable_at'))}, title==artist "
          f"{sum(1 for r in rows if r['title'].strip().casefold() == r['artist'].strip().casefold())}")
    print(f"played in games: {sum(1 for r in rows if plays.get(r['youtube_id']))} songs")
    print(f"genre slugs: {', '.join(genres)}")
    if since:
        print(f"earlier audits: {', '.join(h['audits'])}; {len(new)} songs added after {since} UTC; "
              f"{len(h['rejected'])} rejected changes + {len(h['kept_groups'])} kept duplicate groups will not be re-offered")
    else:
        print("no earlier audit found in batches/ (a fresh clone has none: copy the old *-audit folders over "
              "first, or everything the maintainer rejected before comes back): this is a full audit")


if __name__ == "__main__":
    main()
