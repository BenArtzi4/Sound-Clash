#!/usr/bin/env python3
"""User song requests (one "* title — artist" per line) -> wanted.json.

Also dedups against the live catalog snapshot (_dumps/catalog_raw.json, the
JSON a maintainer provides: {"rows": [{title, artist, youtube_id, release_year, genres}]})
and inside the list itself.

usage (from the batch folder): python <tools>/requests/parse_requests.py "<requests.txt>" [--drop-offered]
  --drop-offered  also skip songs an earlier batch offered and the maintainer did not
                  approve (unapproved = rejected). Use it for lists WE built (artist
                  wish-lists, charts, playlists); for lists players sent, leave it off:
                  finalize.py flags those re-requests so the maintainer can decide.
writes: wanted.json      net-new songs to research
        in_catalog.json  requests the catalog already has (with the match)
        report.txt       human-readable summary
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path.cwd()  # always run from the batch folder

PUNCT = set("'\"`´׳״’‘“”|,.!?/\\-–—_:;+*()[]{}&")


def norm(s: str) -> str:
    """Casefold, drop niqqud + punctuation, collapse Hebrew double letters."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = "".join(" " if ch in PUNCT else ch for ch in s.casefold())
    s = s.replace("יי", "י").replace("וו", "ו")
    return " ".join(s.split())


SPLIT_ARTISTS = re.compile(r"\s*(?:,|&| ft\.? | feat\.? | x | ו(?=[א-ת]{2,}\s))\s*")


def artist_parts(a: str) -> list:
    """'סטטיק ובן אל' -> ['סטטיק', 'בן אל']; keeps band names as one part too."""
    a = a.strip()
    parts = {norm(a)}
    # Hebrew "ו" joins two performers ("סטטיק ובן אל"); split on " ו" before a word
    for chunk in re.split(r",|&| ft\.? | feat\.? ", a):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts.add(norm(chunk))
        for sub in re.split(r" ו(?=\S)", " " + chunk):
            sub = sub.strip()
            if len(sub) >= 2:
                parts.add(norm(sub))
    return [p for p in parts if p]


def artist_overlap(req_artist: str, cat_artist: str) -> bool:
    ra = artist_parts(req_artist)
    ca_norm = norm(cat_artist)
    ca = artist_parts(cat_artist)
    for p in ra:
        if p and (p in ca or p in ca_norm or any(p in c or c in p for c in ca if len(c) >= 3)):
            return True
    return False


def exclusions_file() -> Path:
    """The maintainer's private exclusion list: <repo>/.claude/curation-exclusions.txt.

    Local only (.claude/ is git-ignored), kept with the maintainer's credentials.
    One artist per line, # comments allowed. Missing file = no exclusions."""
    return Path(__file__).resolve().parents[3] / ".claude" / "curation-exclusions.txt"


def excluded_artists() -> list:
    """Names from the local exclusion list (see exclusions_file)."""
    p = exclusions_file()
    if not p.exists():
        return []
    lines = (ln.strip() for ln in p.read_text(encoding="utf-8").splitlines())
    return [ln for ln in lines if ln and not ln.startswith("#")]


def is_excluded(artist: str, names: list) -> str | None:
    """The excluded name credited in `artist` (main, duet or feature), else None."""
    parts = artist_parts(artist)
    for name in names:
        n = norm(name)
        if n in parts or any(n in p for p in parts):
            return name
    return None


def load_catalog() -> list:
    """Rows of _dumps/catalog_raw.json: `supabase db query` output (CLI chatter
    before the JSON is skipped) or a bare list of rows."""
    t = (HERE / "_dumps" / "catalog_raw.json").read_text(encoding="utf-8")
    i = min([x for x in (t.find("{"), t.find("[")) if x >= 0])
    obj, _ = json.JSONDecoder().raw_decode(t[i:])
    return obj["rows"] if isinstance(obj, dict) else obj


def earlier_offers() -> list:
    """Every card shown in a sibling batch's candidates.js: (batch, title, artist)."""
    out = []
    for f in sorted(HERE.parent.glob("*/candidates.js")):
        if f.parent == HERE or f.parent.name.startswith(("_", "zz")):  # _sample and test folders
            continue
        s = f.read_text(encoding="utf-8")
        try:
            rows = json.loads(s[s.index("["):s.rindex("]") + 1])
        except ValueError:
            continue
        out += [(f.parent.name, r.get("title", ""), r.get("artist", "")) for r in rows]
    return out


def main() -> None:
    src = Path(sys.argv[1])
    catalog = load_catalog()
    by_title = {}
    for c in catalog:
        by_title.setdefault(norm(c["title"]), []).append(c)
    offers = earlier_offers() if "--drop-offered" in sys.argv else []

    wanted, in_cat, seen, skipped, dropped = [], [], {}, [], []
    excluded = excluded_artists()
    lines = src.read_text(encoding="utf-8").splitlines()
    report = []
    for n, line in enumerate(lines, 1):
        line = line.strip().lstrip("*").strip()
        if not line:
            continue
        if "—" in line:
            title, artist = [x.strip() for x in line.split("—", 1)]
        elif " - " in line:
            title, artist = [x.strip() for x in line.split(" - ", 1)]
        else:
            report.append(f"line {n}: cannot split: {line}")
            continue
        key = (norm(title), norm(artist))
        if key in seen:
            report.append(f"line {n}: repeat of line {seen[key]} in the request list: {title} — {artist}")
            continue
        seen[key] = n
        # Players credit the wrong singer ~1 time in 8, so a request credited to an
        # excluded artist is kept and tagged: research finds the real performer,
        # skips it cheaply if it really is theirs, and finalize.py drops it anyway.
        hit = is_excluded(artist, excluded)
        if hit:
            skipped.append(f"  #{n} {title} — {artist}  (credited to excluded artist: {hit})")
        exact = [c for c in by_title.get(norm(title), []) if artist_overlap(artist, c["artist"])]
        same_title = [c for c in by_title.get(norm(title), []) if c not in exact]
        rec = {"req": n, "title": title, "artist": artist}
        if hit:
            rec["credited_to_excluded_artist"] = hit
        if exact:
            rec["catalog"] = [{k: c.get(k) for k in ("title", "artist", "youtube_id", "release_year", "genres",
                                                     "unavailable_at")} for c in exact]
            in_cat.append(rec)
            continue
        before = sorted({b for b, t, a in offers if norm(t) == norm(title) and artist_overlap(artist, a)})
        if before:
            dropped.append(f"  #{n} {title} — {artist}  (offered in {', '.join(before)}, not approved)")
            continue
        if same_title:
            rec["same_title_in_catalog"] = [
                {k: c[k] for k in ("title", "artist", "youtube_id", "release_year", "genres")} for c in same_title]
        wanted.append(rec)

    (HERE / "wanted.json").write_text(json.dumps(wanted, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "in_catalog.json").write_text(json.dumps(in_cat, ensure_ascii=False, indent=1), encoding="utf-8")
    report.insert(0, f"requests parsed: {len(seen)} unique | already in catalog: {len(in_cat)} | "
                     f"to research: {len(wanted)} (of which credited to an excluded artist: {len(skipped)})"
                     + (f" | dropped as rejected before: {len(dropped)}" if offers else ""))
    if dropped:
        report.append("")
        report.append("== offered in an earlier batch and not approved (= rejected): dropped ==")
        report += dropped
    if skipped:
        report.append("")
        report.append("== credited to an excluded artist (local exclusion list) — research checks who really sings it ==")
        report += skipped
    report.append("")
    report.append("== already in catalog ==")
    for r in in_cat:
        c = r["catalog"][0]
        dead = "  [its video is flagged unavailable: fix it with the audit-songs skill]" if c.get("unavailable_at") else ""
        report.append(f"  #{r['req']} {r['title']} — {r['artist']}  ==  {c['title']} — {c['artist']} ({c['youtube_id']}){dead}")
    report.append("")
    report.append("== same title, different artist in catalog (check: cover/other song?) ==")
    for r in wanted:
        for c in r.get("same_title_in_catalog", []):
            report.append(f"  #{r['req']} {r['title']} — {r['artist']}  vs  {c['title']} — {c['artist']}")
    (HERE / "report.txt").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
