#!/usr/bin/env python3
"""research/*.json + gateway meta cache -> candidates.js for the review page.

Every chosen video and alternative is re-checked from the watch-page metadata
(status OK, embeddable, playable in Israel); anything that fails is dropped or
flagged. Final dedup against the catalog snapshot and inside the batch.

Also flags songs (and artists) that earlier batches offered and the maintainer
did not approve: an unapproved card is a silent reject, so a re-offer must say so.

usage (from the batch folder):
    python <tools>/requests/finalize.py --title "Player requests — October 2026"
writes: candidates.js            window.BATCH + window.CANDIDATES (review page data)
        already_in_catalog.txt   requests the game already has
        finalize_report.txt      counts, drops, problems
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from parse_requests import artist_overlap, norm

HERE = Path.cwd()  # always run from the batch folder
GATEWAY = "http://127.0.0.1:8791"
VALID = {"rock", "pop", "hip-hop", "electronic", "soundtracks", "israeli-pop", "israeli-cover",
         "israeli-rock-pop", "israeli-rap-hip-hop", "mizrahit", "israeli-soundtracks"}
BATCH = {
    "id": HERE.name,
    "title": sys.argv[sys.argv.index("--title") + 1] if "--title" in sys.argv else f"Song batch {HERE.name}",
}


def earlier_offers() -> list:
    """Every card shown in a sibling batch's candidates.js: (batch, title, artist)."""
    out = []
    for f in sorted(HERE.parent.glob("*/candidates.js")):
        if f.parent == HERE:
            continue
        s = f.read_text(encoding="utf-8")
        try:
            rows = json.loads(s[s.index("["):s.rindex("]") + 1])
        except ValueError:
            continue
        out += [(f.parent.name, r.get("title", ""), r.get("artist", "")) for r in rows]
    return out


def history_flags(title: str, artist: str, offers: list, catalog: list) -> list:
    """Warn when this song, or this artist as a whole, was offered before and never approved."""
    flags = []
    same = [b for b, t, a in offers if norm(t) == norm(title) and artist_overlap(artist, a)]
    in_cat = any(norm(c["title"]) == norm(title) and artist_overlap(artist, c["artist"]) for c in catalog)
    if same and not in_cat:
        flags.append({"level": "warn", "text": f"Offered before ({', '.join(sorted(set(same)))}) and not approved"})
    main = artist.split(" ft. ")[0].split(" & ")[0].split(", ")[0]
    by_artist = [1 for _, _, a in offers if artist_overlap(main, a)]
    artist_in_cat = any(artist_overlap(main, c["artist"]) for c in catalog)
    if len(by_artist) >= 5 and not artist_in_cat:
        flags.append({"level": "warn", "text": f"None of the {len(by_artist)} earlier {main} cards were approved — the catalog has no {main} songs"})
    return flags


def meta(vid: str) -> dict | None:
    p = HERE / "meta" / f"{vid}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    try:
        with urllib.request.urlopen(f"{GATEWAY}/info?id={urllib.parse.quote(vid)}", timeout=900) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def playable(m: dict | None) -> str | None:
    """None if playable in the game, else the reason."""
    if not m:
        return "no metadata"
    if m.get("status") != "OK":
        return f"status {m.get('status')} {m.get('reason') or ''}".strip()
    if m.get("playableInEmbed") is False:
        return "embedding disabled"
    if m.get("il") is False:
        return "blocked in Israel"
    return None


def badge(m: dict) -> str:
    b = m.get("badges") or []
    if "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in b:
        return "artist"
    return "verified" if "BADGE_STYLE_TYPE_VERIFIED" in b else ""


def suggested_start(m: dict) -> int | None:
    """First point after the opening 5% where replays reach 60% of the peak.

    Checked against 852 catalog songs with a hand-set start: within 10 s of the
    maintainer's choice 45% of the time (the raw peak only 30%). A hint, not a default."""
    heat, length = m.get("heat"), m.get("length")
    if not heat or not length:
        return None
    for s, v in heat:
        if s >= length * 0.05 and v >= 0.6:
            return max(0, int(s) - 1)
    return None


def human(n):
    if n is None:
        return "?"
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.1f}{suf}"
    return str(n)


def main() -> None:
    packets = {}
    for p in sorted((HERE / "packets").glob("p*.json")):
        for w in json.loads(p.read_text(encoding="utf-8")):
            packets[w["req"]] = w
    research = []
    for p in sorted((HERE / "research").glob("p*.json")):
        research += json.loads(p.read_text(encoding="utf-8"))
    catalog = json.loads((HERE / "_dumps" / "catalog_raw.json").read_text(encoding="utf-8"))["rows"]
    cat_ids = {c["youtube_id"]: c for c in catalog}
    offers = earlier_offers()

    report, in_cat, cands, seen_ids = [], [], [], {}
    missing = sorted(set(packets) - {r["req"] for r in research})
    if missing:
        report.append(f"NOT RESEARCHED (no result row): {missing}")

    expanded = []
    for r in sorted(research, key=lambda x: x["req"]):
        expanded.append(r)
        mm = r.get("maybe_meant") or {}
        if mm.get("youtube_id"):
            w = packets.get(r["req"], {})
            expanded.append({
                "req": r["req"], "status": "new", "youtube_id": mm["youtube_id"],
                "title": mm.get("title"), "artist": mm.get("artist"),
                "release_year": mm.get("release_year"), "genres": mm.get("genres"),
                "alternatives": [], "confidence": "medium", "notes": mm.get("why", ""),
                "flags": [{"level": "warn", "text": f"Maybe-meant: the player asked for '{w.get('title')} — {w.get('artist')}'; this is a guess at what they meant"}],
            })

    for r in expanded:
        w = packets.get(r["req"], {})
        req = {"line": r["req"], "title": w.get("title"), "artist": w.get("artist")}
        status = r.get("status")
        if status == "in_catalog":
            m = cat_ids.get(r.get("catalog_match") or "")
            in_cat.append(f"#{r['req']} {req['title']} — {req['artist']}  ==  "
                          + (f"{m['title']} — {m['artist']} ({m['youtube_id']})" if m else f"? {r.get('catalog_match')}")
                          + (f"   [{r.get('notes')}]" if r.get("notes") else ""))
            continue
        if status != "new":
            report.append(f"SKIP #{r['req']} {req['title']} — {req['artist']}: {r.get('notes')}")
            continue
        vid = r.get("youtube_id")
        if not vid:
            report.append(f"NO VIDEO #{r['req']} {req['title']} — {req['artist']}: {r.get('notes')}")
            continue
        if vid in cat_ids:
            c = cat_ids[vid]
            in_cat.append(f"#{r['req']} {req['title']} — {req['artist']}  ==  {c['title']} — {c['artist']} ({vid}) [same video id]")
            continue
        if vid in seen_ids:
            report.append(f"DUP-IN-BATCH #{r['req']} same video as #{seen_ids[vid]} ({vid}) — dropped")
            continue
        m = meta(vid)
        why = playable(m)
        flags = list(r.get("flags") or [])
        alts = []
        for a in r.get("alternatives") or []:
            am = meta(a.get("youtube_id", ""))
            if playable(am) or a["youtube_id"] in cat_ids or a["youtube_id"] == vid:
                report.append(f"ALT DROPPED #{r['req']} {a.get('youtube_id')}: {playable(am) or 'catalog/same id'}")
                continue
            alts.append({"youtube_id": a["youtube_id"], "yt_title": am.get("title"), "channel": am.get("author"),
                         "views": am.get("views"), "length": am.get("length"), "why": a.get("why", "")})
        if why:
            if not alts:
                report.append(f"UNPLAYABLE #{r['req']} {vid}: {why} — dropped, no alternative")
                continue
            report.append(f"PROMOTED ALT #{r['req']} {vid} was {why}")
            flags.append({"level": "warn", "text": f"Researched video {vid} is unplayable ({why}); showing the alternative"})
            first = alts.pop(0)
            vid, m = first["youtube_id"], meta(first["youtube_id"])
        seen_ids[vid] = r["req"]
        genres = [g for g in (r.get("genres") or []) if g in VALID]
        if not genres:
            flags.append({"level": "warn", "text": "No valid genre — pick one"})
        if (m.get("views") or 0) < 50_000:
            flags.append({"level": "warn", "text": f"Low views ({human(m.get('views'))})"})
        if (m.get("length") or 0) > 480:
            flags.append({"level": "warn", "text": f"Long video ({(m.get('length') or 0) // 60} min) — intro or medley?"})
        for c in w.get("same_title_in_catalog") or []:
            text = f"Catalog already has '{c['title']} — {c['artist']}' (same title, other artist)"
            if not any(c["title"] in f.get("text", "") for f in flags):
                flags.append({"level": "info", "text": text})
        flags += history_flags(r.get("title") or req["title"], r.get("artist") or req["artist"], offers, catalog)
        if r.get("confidence") == "low":
            flags.append({"level": "warn", "text": "Low research confidence — check identity/year"})
        cands.append({
            "youtube_id": vid,
            "title": r.get("title") or req["title"],
            "artist": r.get("artist") or req["artist"],
            "genres": genres,
            "start_time": 0,
            "release_year": r.get("release_year"),
            "suggested_start": suggested_start(m),
            "heat": [[int(s), round(v, 2)] for s, v in (m.get("heat") or [])] or None,
            "length": m.get("length"),
            "views": m.get("views"),
            "channel": m.get("author"),
            "channel_badge": badge(m),
            "upload_date": (m.get("uploadDate") or "")[:10] or None,
            "oembed_title": m.get("title"),
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "alternatives": alts,
            "flags": flags,
            "notes": r.get("notes") or "",
            "year_source": r.get("year_source"),
            "confidence": r.get("confidence") or "medium",
            "request": req,
            "group": "requests",
            "source": BATCH["title"],
            "valid": True,
            "match_status": "ok",
        })

    js = ("window.BATCH = " + json.dumps(BATCH, ensure_ascii=False) + ";\n"
          + "window.CANDIDATES = " + json.dumps(cands, ensure_ascii=False, indent=1) + ";\n")
    (HERE / "candidates.js").write_text(js, encoding="utf-8")
    (HERE / "already_in_catalog.txt").write_text("\n".join(in_cat), encoding="utf-8")
    flagged = sum(1 for c in cands if any(f["level"] == "warn" for f in c["flags"]))
    report.insert(0, f"candidates: {len(cands)} (warn-flagged {flagged}) | in catalog per research: {len(in_cat)} | researched rows: {len(research)} of {len(packets)}")
    genres = {}
    for c in cands:
        for g in c["genres"]:
            genres[g] = genres.get(g, 0) + 1
    report.insert(1, "genres: " + ", ".join(f"{k} {v}" for k, v in sorted(genres.items(), key=lambda x: -x[1])))
    report.insert(2, f"with heat: {sum(1 for c in cands if c['heat'])} | with alternatives: {sum(1 for c in cands if c['alternatives'])} | no year: {sum(1 for c in cands if not c['release_year'])}")
    (HERE / "finalize_report.txt").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report[:3]))


if __name__ == "__main__":
    main()
