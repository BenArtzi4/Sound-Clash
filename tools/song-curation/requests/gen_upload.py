#!/usr/bin/env python3
"""Approved CSV (from the review page) -> idempotent upload SQL + a verify query.

Run from the batch folder AFTER the human review:

    python <tools>/requests/gen_upload.py approved-songs-<date>.csv
        writes upload_<batch>.sql   INSERT songs + song_genres, keyed on youtube_id,
                                    safe to re-run (present songs are skipped,
                                    genre links use ON CONFLICT DO NOTHING)
               verify_<batch>.sql   read-only SELECT of the same youtube_ids
               playtest_songs.json  every id + start, for playtest/playtest.mjs

    python <tools>/requests/gen_upload.py approved-songs-<date>.csv --check verify_result.json
        compares the verify query's JSON output (what `supabase db query` prints)
        with the CSV row by row: title, artist, start_time, release_year, genres.

The CSV columns are the review page's export: title,artist,youtube_id,start_time,
genres,release_year (genres ';'-joined slugs). This script never connects to a
database; applying the SQL is a maintainer step with their own credentials.
"""
import csv
import json
import sys
from pathlib import Path

HERE = Path.cwd()  # the batch folder

VALID_SLUGS = {
    "rock", "pop", "hip-hop", "electronic", "soundtracks", "israeli-pop",
    "israeli-cover", "israeli-rock-pop", "israeli-rap-hip-hop", "mizrahit",
    "israeli-soundtracks",
}


def q(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def load_rows(src: Path) -> list:
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    if not rows:
        raise SystemExit("no rows in the approved CSV")
    return rows


def generate(src: Path, rows: list) -> None:
    svals, gvals, problems, seen = [], [], [], set()
    for r in rows:
        vid = (r.get("youtube_id") or "").strip()
        title = (r.get("title") or "").strip()
        artist = (r.get("artist") or "").strip()
        slugs = [s.strip() for s in (r.get("genres") or "").split(";") if s.strip()]
        year = (r.get("release_year") or "").strip()
        start = (r.get("start_time") or "0").strip() or "0"

        if len(vid) != 11:
            problems.append(f"bad youtube_id: {vid!r}")
        if vid in seen:
            problems.append(f"duplicate youtube_id in CSV: {vid}")
        seen.add(vid)
        if not title or not artist:
            problems.append(f"{vid}: missing title/artist")
        bad = [s for s in slugs if s not in VALID_SLUGS]
        if bad:
            problems.append(f"{vid}: invalid genre slug(s) {bad}")
        if not slugs:
            problems.append(f"{vid}: no genre")
        if year and not (year.isdigit() and 1900 <= int(year) <= 2100):
            problems.append(f"{vid}: implausible release_year {year!r}")
        if not start.isdigit():
            problems.append(f"{vid}: bad start_time {start!r}")

        svals.append(f"  ({q(title)}, {q(artist)}, {q(vid)}, {int(start) if start.isdigit() else 0}, {year if year else 'NULL'})")
        gvals += [f"  ({q(vid)}, {q(s)})" for s in slugs]

    if problems:
        print("REFUSING TO GENERATE -- fix these first:")
        for p in problems:
            print("  -", p)
        raise SystemExit(1)

    name = HERE.name
    sep = ",\n"
    sblock, gblock = sep.join(svals), sep.join(gvals)
    sql = f"""-- Sound Clash: {len(svals)} approved songs from batch {name} ({src.name}).
-- Idempotent: keyed on youtube_id, safe to re-run.
BEGIN;

INSERT INTO songs (title, artist, youtube_id, start_time, release_year)
SELECT s.title, s.artist, s.youtube_id, s.start_time, s.release_year
FROM (VALUES
{sblock}
) AS s(title, artist, youtube_id, start_time, release_year)
WHERE NOT EXISTS (SELECT 1 FROM songs WHERE songs.youtube_id = s.youtube_id);

INSERT INTO song_genres (song_id, genre_id)
SELECT songs.id, genres.id
FROM songs
JOIN (VALUES
{gblock}
) AS m(youtube_id, slug) ON songs.youtube_id = m.youtube_id
JOIN genres ON genres.slug = m.slug
ON CONFLICT (song_id, genre_id) DO NOTHING;

COMMIT;
"""
    ids = ", ".join(q(r["youtube_id"].strip()) for r in rows)
    verify = (
        "select s.youtube_id, s.title, s.artist, s.start_time, s.release_year, s.unavailable_at, "
        "coalesce(string_agg(g.slug, ';' order by g.slug), '') as genres, "
        "(select count(*) from songs) as catalog "
        "from songs s left join song_genres sg on sg.song_id = s.id "
        "left join genres g on g.id = sg.genre_id "
        f"where s.youtube_id in ({ids}) group by s.id\n"
    )
    up, ve = HERE / f"upload_{name}.sql", HERE / f"verify_{name}.sql"
    up.write_text(sql, encoding="utf-8", newline="\n")
    ve.write_text(verify, encoding="utf-8", newline="\n")
    play = [{"id": r["youtube_id"].strip(), "start": int((r.get("start_time") or "0").strip() or 0),
             "title": r["title"].strip()} for r in rows]
    (HERE / "playtest_songs.json").write_text(json.dumps(play, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {up.name}: {len(svals)} songs, {len(gvals)} genre links")
    print(f"wrote {ve.name} (read-only; run it after applying, save the JSON, then --check it)")
    print("wrote playtest_songs.json (for tools/song-curation/playtest/playtest.mjs)")


def check(rows: list, result: Path) -> None:
    raw = result.read_text(encoding="utf-8")
    data = json.loads(raw[raw.index("{"):])
    db = {r["youtube_id"]: r for r in data["rows"]}
    bad = []
    for w in rows:
        vid = w["youtube_id"].strip()
        r = db.get(vid)
        if not r:
            bad.append(f"MISSING {vid} {w['title']}")
            continue
        want = {
            "title": w["title"].strip(),
            "artist": w["artist"].strip(),
            "start_time": (w.get("start_time") or "0").strip() or "0",
            "release_year": (w.get("release_year") or "").strip() or "None",
            "genres": ";".join(sorted(s for s in w["genres"].split(";") if s)),
        }
        for k, v in want.items():
            if str(r.get(k)) != v:
                bad.append(f"{vid} {k}: db={r.get(k)!r} csv={v!r}")
        if r.get("unavailable_at"):
            bad.append(f"{vid} is flagged unavailable")
    catalog = data["rows"][0].get("catalog") if data["rows"] else "?"
    print(f"present {len(db)} of {len(rows)} | catalog now {catalog} | mismatches {len(bad)}")
    for b in bad:
        print("  -", b)
    if bad:
        raise SystemExit(1)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = HERE / src
    rows = load_rows(src)
    if "--check" in sys.argv:
        check(rows, Path(sys.argv[sys.argv.index("--check") + 1]))
    else:
        generate(src, rows)


if __name__ == "__main__":
    main()
