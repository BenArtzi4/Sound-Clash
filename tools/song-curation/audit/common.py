"""Shared helpers for the catalog-audit scripts (scan, merge, make_sql, ...).

Every script runs FROM the audit's batch folder (tools/song-curation/batches/
<date>-audit/, git-ignored) and reads/writes its data there; this folder only
holds code. Nothing here connects to a database.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

HERE = Path.cwd()  # the batch folder
BATCHES = HERE.parent
HEB = re.compile(r"[֐-׿]")
NIQ = re.compile(r"[֑-ׇ]")
STOP = {"ft", "feat", "the", "and", "official", "video", "audio", "prod", "by", "music", "remastered",
        "remaster", "version", "hd", "mv", "of", "a", "עם", "של", "את"}
SOUNDTRACK_GENRES = ("soundtracks", "israeli-soundtracks")
DEFAULT_GENRES = ["rock", "pop", "hip-hop", "electronic", "soundtracks", "israeli-pop", "israeli-cover",
                  "israeli-rock-pop", "israeli-rap-hip-hop", "mizrahit", "israeli-soundtracks"]
GATEWAY = "http://127.0.0.1:8791"  # requests/ytproxy.py, shared with requests/yt.py


def read_json(name: str | Path, default=None):
    p = HERE / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(name: str | Path, obj, indent=1) -> None:
    (HERE / name).write_text(json.dumps(obj, ensure_ascii=False, indent=indent), encoding="utf-8", newline="\n")


def supabase_rows(path: Path) -> list:
    """Rows from a `supabase db query --linked ... > file` dump (skips CLI chatter)."""
    t = Path(path).read_text(encoding="utf-8")
    obj, _ = json.JSONDecoder().raw_decode(t[t.index("{"):])
    return obj["rows"]


def genres() -> list:
    return read_json("genres.json") or DEFAULT_GENRES


def is_soundtrack(r) -> bool:
    g = r["genres"]
    return any(x in (g.split(";") if isinstance(g, str) else g) for x in SOUNDTRACK_GENRES)


def norm(s: str) -> str:
    s = NIQ.sub("", s or "")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = s.casefold().replace("&", " and ")
    s = re.sub(r"[^\w֐-׿]+", " ", s)
    s = s.replace("יי", "י").replace("וו", "ו")
    return re.sub(r"\s+", " ", s).strip()


def toks(s):
    return [t for t in norm(s).split() if len(t) > 1 and t not in STOP]


def coverage(needle, hay) -> float:
    """Share of the needle's words found in the haystack (Hebrew-aware)."""
    ts = toks(needle)
    if not ts:
        return 1.0
    hs = set(norm(hay).split())
    hn = norm(hay)
    return sum(1 for t in ts if t in hs or (len(t) > 3 and t in hn)) / len(ts)


def primary(artist: str) -> str:
    return re.split(r"\s+(?:ft\.?|feat\.?|featuring|&|x|X|ו-)\s+|,", artist)[0].strip()


def badge_of(m) -> str:
    b = m.get("badges") or []
    return "artist" if "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in b else ("verified" if "BADGE_STYLE_TYPE_VERIFIED" in b else "")


def meta(vid):
    p = HERE / "meta" / f"{vid}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


_plays = None


def plays() -> dict:
    global _plays
    if _plays is None:
        _plays = read_json("plays.json", {})
    return _plays


def snapshot(r) -> dict:
    """A song as the review page shows it: DB values + its current video's facts."""
    m = meta(r["youtube_id"]) or {}
    return {
        "id": r["id"], "title": r["title"], "artist": r["artist"], "youtube_id": r["youtube_id"],
        "start_time": r["start_time"], "release_year": r["release_year"],
        "genres": [g for g in r["genres"].split(";") if g], "plays": plays().get(r["youtube_id"], 0),
        "yt": {"title": m.get("title"), "channel": m.get("author"), "badge": badge_of(m),
               "views": m.get("views"), "length": m.get("length"), "upload": m.get("uploadDate"),
               "status": m.get("status"), "reason": m.get("reason"), "embed": m.get("playableInEmbed"),
               "il": m.get("il"), "music": m.get("music")},
    }


# ------------------------------------------------------------------ earlier audits
def past_audits() -> list[Path]:
    """Sibling batch folders that hold a finished audit review (items + decisions).
    Folders starting with "_" or "zz" are samples and tests, never history."""
    out = []
    for d in sorted(BATCHES.iterdir()):
        if d.is_dir() and d.resolve() != HERE.resolve() and not d.name.startswith(("_", "zz")) \
                and (d / "items.json").exists() and (d / "decisions.json").exists():
            out.append(d)
    return out


def audit_cutoff(d: Path) -> str | None:
    """UTC 'YYYY-MM-DD HH:MM:SS' after which a song is new to audit d: its
    snapshot time, or the end of its folder-name date for audits made before
    snapshot.json existed (the 2026-10-09 audit's snapshot included that day)."""
    snap = d / "snapshot.json"
    if snap.exists():
        return json.loads(snap.read_text(encoding="utf-8"))["taken_at_utc"]
    m = re.match(r"\d{4}-\d{2}-\d{2}", d.name)
    return f"{m.group(0)} 23:59:59" if m else None


def _canon(f, v):
    return json.dumps(sorted(v) if f == "genres" and isinstance(v, list) else v, ensure_ascii=False)


def history() -> dict:
    """What earlier audits settled. Unapproved = rejected: the maintainer's rule.

    rejected      {(song_id, field, value-json)}  a proposed value they turned down
    rejected_vids {(song_id, youtube_id)}         a proposed video they turned down
    kept          {song_id: {field: [values]}}    the same, per song, for the agents' packets
    kept_groups   [set(song_ids)]                 duplicate / possible-duplicate groups they kept
    settled       {song_id: {field: audit-name}}  fields an approved card set
    cutoff        UTC 'YYYY-MM-DD HH:MM:SS': songs created after it are new (audit_cutoff)
    """
    h = {"rejected": set(), "rejected_vids": set(), "kept": {}, "kept_groups": [], "settled": {},
         "cutoff": None, "audits": []}
    for d in past_audits():
        items = {i["id"]: i for i in json.loads((d / "items.json").read_text(encoding="utf-8"))["items"]}
        dec = json.loads((d / "decisions.json").read_text(encoding="utf-8"))
        h["audits"].append(d.name)
        c = audit_cutoff(d)
        if c and (h["cutoff"] is None or c > h["cutoff"]):
            h["cutoff"] = c
        for iid, it in items.items():
            dd = dec.get(iid) or {}
            st = dd.get("status")
            p = it.get("proposal") or {}
            if it["kind"] in ("duplicate", "maybe_dup"):
                if st != "approved":
                    h["kept_groups"].append({s["id"] for s in it["songs"]})
                continue
            sid = it["songs"][0]["id"]
            if st == "approved":
                for f in (dd["fields"] if "fields" in dd else p.get("fields") or {}):
                    h["settled"].setdefault(sid, {})[f] = d.name
                continue
            kept = h["kept"].setdefault(sid, {})
            for f, v in (p.get("fields") or {}).items():
                h["rejected"].add((sid, f, _canon(f, v)))
                kept.setdefault(f, []).append(v)
            for c in it.get("candidates") or []:
                h["rejected_vids"].add((sid, c.get("youtube_id")))
                if c.get("youtube_id") not in kept.get("youtube_id", []):
                    kept.setdefault("youtube_id", []).append(c.get("youtube_id"))
    return h


def is_new(r, hist) -> bool:
    """Created after the newest earlier audit's snapshot (created_at is UTC)."""
    return bool(hist["cutoff"]) and (r.get("created_at") or "")[:19] > hist["cutoff"]
