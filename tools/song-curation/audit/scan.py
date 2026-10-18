#!/usr/bin/env python3
"""Catalog + YouTube data -> mechanical review cards + research packets.

Inputs (batch folder): catalog.json, plays.json, genres.json (snapshot.py),
meta/<id>.json and search/<key>.json (the ytproxy gateway's cache).
Outputs: items_scan.json (cards the scan can propose on its own: broken video,
start past the end, no genre, duplicates, possible duplicates, a much bigger
official upload, style), packets/<bucket>.json + packets/names_*.tsv for the
research agents, artist_variants.json, scan_report.txt and AGENT_GUIDE.md.

Agent scope: songs added after the newest earlier audit plus any song with a
must-fix flag; `--all` sends every song (a full re-audit). The mechanical
cards always cover the whole catalog. Re-run it after the gateway's search
sweep finishes: the "bigger official upload" cards need the searches.

usage (from the batch folder): python <tools>/audit/scan.py [--all]
"""
from __future__ import annotations

import collections
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

import common as C
from common import HEB, badge_of, coverage, meta, norm, primary, snapshot

TOOLS = Path(__file__).resolve().parent
ALL = "--all" in sys.argv
rows = C.read_json("catalog.json")
plays = C.plays()
hist = C.history()
(C.HERE / "packets").mkdir(exist_ok=True)


def search_key(q):
    return hashlib.sha1(q.encode("utf-8")).hexdigest()[:16]


def song_query(r):  # must match requests/ytproxy.py
    t, a = r["title"].strip(), r["artist"].strip()
    return t if t.casefold() == a.casefold() else f"{a} {t}"


def search(r):
    p = C.HERE / "search" / f"{search_key(song_query(r))}.json"
    return json.loads(p.read_text(encoding="utf-8"))["results"] if p.exists() else None


LABELS = ("records", "vevo", "music", "official", "entertainment", "הד ארצי", "hed arzi", "nmc", "helicon",
          "הליקון", "anana", "טדי", "tedy", "mizrahi", "unicell", "התו השמיני", "disney", "warner", "sony",
          "universal", "atlantic", "columbia", "rhino", "emi", "capitol", "interscope", "republic",
          "parlophone", "island", "def jam", "netflix", "pixar", "dreamworks", "label", "productions",
          "הפקות", "מוזיקה", "רשמי", "aroma", "ארומה", "galatz", "גלגלצ", "kan", "כאן")
BAD = [("live", r"\blive\b|\(live|הופעה|לייב|ביצוע חי|unplugged|in concert|concert|\bpulse\b|re-edited"),
       ("lyrics", r"\blyrics?\b|מילים|\bletra\b|traduç|legendad|subtitulad|תרגום|מתורגם"),
       ("cover", r"\bcover\b|קאבר|tribute"),
       ("karaoke", r"karaoke|קריוקי|instrumental|backing track"),
       ("altered", r"\b8d\b|sped up|speed up|slowed|nightcore|reverb|bass boosted|1 hour|10 hours|loop"),
       ("mix", r"mashup|medley|מחרוזת|megamix|full album|compilation|playlist"),
       ("fan", r"reaction|fan made|fanmade|\bamv\b|fan edit")]
MUST_FIX = ("broken", "embed-off", "blocked-IL", "start-past-end", "no-genre")


def channel_class(ch, badge, artist):
    c = (ch or "").casefold()
    if "- topic" in c:
        return "topic"
    if "vevo" in c:
        return "vevo"
    if badge in ("BADGE_STYLE_TYPE_VERIFIED_ARTIST", "artist"):
        return "artist"
    p = norm(primary(artist))
    if p and (p in norm(ch or "") or norm(ch or "") in p) and len(norm(ch or "")) > 2:
        return "artist-name"
    if any(lb in c for lb in LABELS):
        return "label?"
    return "unknown"


def bad_tags(yt_title, db_title):
    return [name for name, rx in BAD
            if re.search(rx, yt_title or "", re.I) and not re.search(rx, db_title or "", re.I)]


items = []


def add(kind, sev, songs, summary, evidence=(), proposal=None, by="scan", conf="high", key=None, candidates=None):
    iid = key or f"{kind}-{songs[0]['id'][:8]}-{len(items)}"
    it = {"id": iid, "kind": kind, "severity": sev, "summary": summary, "evidence": list(evidence),
          "songs": songs, "proposal": proposal or {"action": "update", "fields": {}}, "by": by, "confidence": conf}
    if candidates:
        it["candidates"] = candidates
    items.append(it)


# ---------------------------------------------------------------- per-song flags
flags = {}
missing_meta = 0
for r in rows:
    m = meta(r["youtube_id"])
    f = []
    if not m:
        missing_meta += 1
        flags[r["id"]] = ["no-meta"]
        continue
    soundtrack = C.is_soundtrack(r)
    if m.get("status") != "OK":
        f.append(f"broken:{m.get('status')}:{m.get('reason')}")
    if m.get("playableInEmbed") is False:
        f.append("embed-off")
    if m.get("il") is False:
        f.append("blocked-IL")
    if m.get("length") and r["start_time"] > m["length"] - 15:
        f.append(f"start-past-end:{r['start_time']}/{m['length']}")
    if m.get("status") == "OK":
        cls = channel_class(m.get("author"), "artist" if badge_of(m) == "artist" else "", r["artist"])
        if cls in ("unknown", "label?") and not soundtrack:
            f.append(f"channel:{cls}")
        tags = bad_tags(m.get("title"), r["title"])
        if tags:
            f.append("video:" + ",".join(tags))
        if (m.get("views") or 0) < 50_000:
            f.append(f"low-views:{m.get('views')}")
        if (m.get("length") or 0) > 600:
            f.append(f"long:{m.get('length')}")
        hay = " ".join([m.get("title") or "", m.get("author") or "", m.get("description") or ""] +
                       [f"{x.get('song')} {x.get('artist')}" for x in m.get("music") or []])
        tc, ac = coverage(r["title"], hay), coverage(r["artist"], hay)
        if not soundtrack and (tc < 0.5 or ac < 0.5):
            f.append(f"name-mismatch:t{tc:.1f}/a{ac:.1f}")
        mus = m.get("music") or []
        if mus and not soundtrack:
            ms = mus[0]
            if coverage(r["title"], ms.get("song") or "") < 0.5 and coverage(ms.get("song") or "", r["title"]) < 0.5:
                f.append(f"credits-song:{ms.get('song')}")
            if coverage(primary(r["artist"]), ms.get("artist") or "") < 0.5 and \
                    coverage(ms.get("artist") or "", r["artist"]) < 0.5:
                f.append(f"credits-artist:{ms.get('artist')}")
        # a clearly bigger official upload of the same recording? Guards: no
        # soundtracks (it picked another song from the same film), official
        # channel only, no live/lyric/cover tags, title must match, and 0.6-2x
        # the current length (compilations, extended cuts, snippets)
        cur_views = m.get("views") or 0
        for h in ([] if soundtrack else (search(r) or [])[:6]):
            if h["id"] == r["youtube_id"]:
                continue
            if channel_class(h["channel"], h.get("badge"), r["artist"]) in ("unknown", "label?"):
                continue
            if bad_tags(h["title"], r["title"]) or coverage(r["title"], h["title"]) < 0.6:
                continue
            hv = h.get("views") or 0
            cl, hl = m.get("length") or 0, h.get("length") or 0
            if cl and hl and not (0.6 <= hl / cl <= 2.0):
                continue
            if hv >= max(5 * cur_views, cur_views + 2_000_000):
                f.append(f"bigger-official:{h['id']}:{hv}")
                break
    if not r["genres"]:
        f.append("no-genre")
    if r["release_year"] is None:
        f.append("no-year")
    if r["title"].strip().casefold() == r["artist"].strip().casefold():
        f.append("generic-title")
    flags[r["id"]] = f

# ---------------------------------------------------------------- mechanical cards
for r in rows:
    f = flags[r["id"]]
    s = snapshot(r)
    broken = [x for x in f if x.startswith("broken") or x in ("embed-off", "blocked-IL")]
    if broken:
        add("broken", 3, [s], f"Video cannot play in the game ({', '.join(broken)})",
            ["The game's player would fail on this video; it needs a replacement or removal."],
            {"action": "update", "fields": {}}, key=f"broken-{r['id'][:8]}")
    sp = [x for x in f if x.startswith("start-past-end")]
    if sp:
        add("video", 3, [s], "Start time is at or past the end of the video",
            [sp[0]], {"action": "update", "fields": {"start_time": 0}}, key=f"start-{r['id'][:8]}")
    big = [x for x in f if x.startswith("bigger-official:")]
    if big and not broken:
        _, vid, views = big[0].split(":")
        add("video", 1, [s], "An official upload of this song has far more views",
            [f"Current video: {s['yt']['channel']} · {s['yt']['views']} views. Found by search: {vid} · {views} views."],
            {"action": "update", "fields": {"youtube_id": vid}}, key=f"bigger-{r['id'][:8]}", conf="medium",
            candidates=[{"youtube_id": vid, "note": "official upload found by search — check it is the same recording"}])
    if "no-genre" in f:
        add("metadata", 3, [s], "No genre: this song can never be picked in a game",
            ["Songs are drawn by genre; with no genre link it is invisible."], key=f"nogenre-{r['id'][:8]}")


# ---------------------------------------------------------------- duplicates
def dkey(r):
    return norm(re.sub(r"\(.*?\)|\[.*?\]", "", r["title"])).replace(" ", "")


def artist_key(a):
    return re.sub(r"^the ", "", norm(primary(a))).replace(" ", "")


def score_keep(r):
    m = meta(r["youtube_id"]) or {}
    ok = m.get("status") == "OK" and m.get("playableInEmbed") is not False and m.get("il") is not False
    return (ok, plays.get(r["youtube_id"], 0) > 0, m.get("views") or 0)


groups = collections.defaultdict(list)
for r in rows:
    if r["title"].strip().casefold() != r["artist"].strip().casefold():  # generic soundtrack titles: agents
        groups[dkey(r)].append(r)

dup_groups = []
for k, g in groups.items():
    if len(g) < 2 or not k:
        continue
    by_artist = collections.defaultdict(list)
    for r in g:
        by_artist[artist_key(r["artist"])].append(r)
    merged = {}  # fuzzy-merge artist buckets (typos, "The ", punctuation)
    for a in by_artist:
        tgt = next((b for b in merged if difflib.SequenceMatcher(None, a, b).ratio() >= 0.8 or a in b or b in a), None)
        merged.setdefault(tgt or a, []).extend(by_artist[a])
    dup_groups += [members for members in merged.values() if len(members) > 1]
    if len(merged) > 1:
        flat = [m for ms in merged.values() for m in ms]
        non_cover = [m for m in flat if "israeli-cover" not in m["genres"].split(";")]
        if len({artist_key(m["artist"]) for m in non_cover}) > 1:
            add("maybe_dup", 1, [snapshot(m) for m in non_cover],
                "Same song title by different performers — keep both, or keep one?",
                ["Usually an original and a cover. Approve only if you want to drop one; reject to keep all."],
                {"action": "keep_one", "keep": None, "fields": {}}, conf="low",
                key="maybedup-" + hashlib.sha1(k.encode()).hexdigest()[:8])

for members in dup_groups:
    members.sort(key=score_keep, reverse=True)
    keep = members[0]
    union = sorted({g for m in members for g in m["genres"].split(";") if g})
    ev = [f"{m['title']} — {m['artist']} [{m['genres']}] {m['youtube_id']}" for m in members]
    ev.append("Suggested keep = playable + already played in games + most views. Genres merged onto the kept song.")
    fields = {"genres": union} if union != sorted(g for g in keep["genres"].split(";") if g) else {}
    add("duplicate", 3, [snapshot(m) for m in members], f"“{keep['title']}” is in the catalog {len(members)} times", ev,
        {"action": "keep_one", "keep": keep["id"], "fields": fields}, key="dup-" + keep["id"][:8])

# ---------------------------------------------------------------- style (mechanical, safe rules only)
SMALL = {"a", "an", "the", "and", "but", "or", "nor", "for", "of", "in", "at", "to", "by", "as", "vs", "vs."}
FOREIGN = {"la", "le", "les", "de", "del", "des", "du", "da", "di", "el", "y", "von", "van", "der", "mi", "tu", "con"}


def title_case(s):
    if HEB.search(s) or not re.search(r"[A-Za-z]", s):
        return s
    letters = re.sub(r"[^A-Za-z]", "", s)
    if letters.islower() or letters.isupper():
        return s  # official stylisation (bad guy, HUMBLE., SICKO MODE)
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        core = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9.']+$", "", w)
        prev = words[i - 1] if i else ""
        first = i == 0 or prev.endswith((":", "(", "-", "—")) or w.startswith("(")
        last = i == len(words) - 1 or w.endswith(")")
        if not core:
            out.append(w)
            continue
        if re.search(r"[A-Z].*[A-Z]|[a-z][A-Z]|\d", core) or "." in core.strip("."):
            out.append(w)  # acronyms, McCartney, D.A.N.C.E., 2U
            continue
        if core.lower() in FOREIGN and not first:
            out.append(w)
            continue
        if core.lower() in SMALL and not first and not last:
            out.append(w.replace(core, core.lower(), 1))
        else:
            out.append(w.replace(core, core[0].upper() + core[1:], 1))
    return " ".join(out)


def style_fix(r):
    t, a = r["title"], r["artist"]
    nt, na, why = t, a, []
    nt2 = re.sub(r"\s*[-–]\s*(\d{4}\s+)?(Remaster(ed)?|Remastered Version|Mono|Stereo|Single Version|Radio Edit"
                 r"|Original Mix)(\s+\d{4})?\s*$", "", nt, flags=re.I)
    nt2 = re.sub(r"\s*[-–]\s*From\s+[“\"].*?[”\"].*$", "", nt2, flags=re.I)
    nt2 = re.sub(r"\s*\((Official|Remaster|Remastered|Lyric|Audio|Video)[^)]*\)\s*$", "", nt2, flags=re.I)
    if nt2 != nt:
        nt = nt2
        why.append("drop version/remaster suffix")
    for fld in ("t", "a"):  # Latin transliteration in parentheses after Hebrew
        v = nt if fld == "t" else na
        v2 = re.sub(r"^([֐-׿][^()]*?)\s*\([A-Za-z][A-Za-z .'&-]*\)\s*$", r"\1", v)
        if v2 != v:
            why.append("drop Latin transliteration")
            if fld == "t":
                nt = v2
            else:
                na = v2
    q = str.maketrans({"׳": "'", "״": '"', "“": '"', "”": '"', "’": "'", "‘": "'", "`": "'", "´": "'"})
    if nt.translate(q) != nt or na.translate(q) != na:
        nt, na = nt.translate(q), na.translate(q)
        why.append("straight quotes")
    na2 = re.sub(r"\s+(?:feat\.?|featuring|Ft\.?|FT\.?|ft(?!\.))\s+", " ft. ", na)
    if na2 != na:
        na = na2
        why.append("guest credit as 'ft.'")
    na2 = re.sub(r"\s*,(?=\S)", " & ", na) if re.search(r",\S", na) else na
    na2 = re.sub(r"\s+[xX×]\s+", " & ", na2) if HEB.search(na2) else na2
    if na2 != na:
        na = na2
        why.append("join performers with ' & '")
    # YouTube's credit casing is unreliable (ALL CAPS, Every Word Capitalised),
    # so only the standard title-case rule is used
    tc = title_case(nt)
    if tc != nt:
        nt = tc
        why.append("title case")
    nt, na = re.sub(r"\s+", " ", nt).strip(), re.sub(r"\s+", " ", na).strip()
    fields = {}
    if nt != t:
        fields["title"] = nt
    if na != a:
        fields["artist"] = na
    return fields, why


for r in rows:
    fields, why = style_fix(r)
    if fields:
        add("style", 1, [snapshot(r)], "; ".join(dict.fromkeys(why)), [],
            {"action": "update", "fields": fields}, key=f"style-{r['id'][:8]}")

# artist spelling variants across the catalog (same performer written two ways)
astr = collections.Counter(r["artist"] for r in rows)
akeys = collections.defaultdict(set)
for a in astr:
    akeys[re.sub(r"^the", "", norm(a).replace(" ", ""))].add(a)
variant_groups = [sorted(v, key=lambda x: -astr[x]) for v in akeys.values() if len(v) > 1]
names = list(akeys)
for i, a in enumerate(names):
    for b in names[i + 1:]:
        if len(a) > 4 and len(b) > 4 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.88:
            variant_groups.append(sorted(akeys[a] | akeys[b], key=lambda x: -astr[x]))
C.write_json("artist_variants.json", variant_groups)

# ---------------------------------------------------------------- research packets
since = hist["cutoff"]


def is_new(r):
    return C.is_new(r, hist)


def in_scope(r):
    return ALL or not since or is_new(r) or any(x.split(":")[0] in MUST_FIX for x in flags.get(r["id"], []))


def fine_bucket(r):
    g = set(r["genres"].split(";"))
    if g & set(C.SOUNDTRACK_GENRES):
        return "soundtracks"
    if g & {"mizrahit"}:
        return "israeli-mizrahit"
    if g & {"israeli-pop", "israeli-rap-hip-hop"}:
        return "israeli-pop-rap"
    if g & {"israeli-rock-pop", "israeli-cover"}:
        return "israeli-rock-cover"
    if g & {"rock"}:
        return "rock"
    if g & {"hip-hop", "electronic"}:
        return "hiphop-electronic"
    return "pop"


scope = [r for r in rows if in_scope(r)]
coarse = len(scope) <= 400  # a small audit: 3 song agents (+ names) instead of up to 9


def bucket(r):
    b = fine_bucket(r)
    if not coarse or b == "soundtracks":
        return b
    return "israeli" if b.startswith("israeli") else "international"


for old in (C.HERE / "packets").glob("*.json"):
    old.unlink()
packets = collections.defaultdict(list)
for r in scope:
    m = meta(r["youtube_id"]) or {}
    hits = search(r) or []
    packets[bucket(r)].append({
        "song_id": r["id"], "title": r["title"], "artist": r["artist"], "genres": r["genres"],
        "year": r["release_year"], "start": r["start_time"], "plays": plays.get(r["youtube_id"], 0),
        "new": is_new(r), "settled": hist["settled"].get(r["id"], {}),
        "rejected_before": hist["kept"].get(r["id"], {}),
        "yt": {"id": r["youtube_id"], "t": m.get("title"), "ch": m.get("author"), "badge": badge_of(m),
               "views": m.get("views"), "len": m.get("length"), "up": (m.get("uploadDate") or "")[:10],
               "status": m.get("status"), "embed": m.get("playableInEmbed"), "il": m.get("il"),
               "music": m.get("music") or None},
        "search": [{"id": h["id"], "t": h["title"], "ch": h["channel"], "badge": h.get("badge") or "",
                    "views": h.get("views"), "len": h.get("length")} for h in hits[:5]],
        "flags": flags.get(r["id"], []),
    })
for b, lst in list(packets.items()):
    if len(lst) > 300:  # keep each agent's share manageable
        lst.sort(key=lambda x: x["artist"])
        half = len(lst) // 2
        packets[b + "-a"], packets[b + "-b"] = lst[:half], lst[half:]
        del packets[b]
for b, lst in packets.items():
    lst.sort(key=lambda x: (not x["new"], -len([f for f in x["flags"] if f != "no-meta"]), -x["plays"]))
    C.write_json(Path("packets") / f"{b}.json", lst, indent=0)

# the names agent reads the whole catalog as text (no YouTube needed)
with open(C.HERE / "packets" / "names_catalog.tsv", "w", encoding="utf-8", newline="\n") as fh:
    fh.write("song_id\ttitle\tartist\tgenres\tyear\tplays\tnew\tsettled\n")
    for r in sorted(rows, key=lambda r: (r["artist"], r["title"])):
        st = ",".join(sorted(hist["settled"].get(r["id"], {})))
        fh.write(f"{r['id']}\t{r['title']}\t{r['artist']}\t{r['genres']}\t{r['release_year']}\t"
                 f"{plays.get(r['youtube_id'], 0)}\t{'new' if is_new(r) else ''}\t{st}\n")
with open(C.HERE / "packets" / "names_artists.tsv", "w", encoding="utf-8", newline="\n") as fh:
    fh.write("artist\tsongs\n")
    for a, n in sorted(astr.items()):
        fh.write(f"{a}\t{n}\n")

guide = (TOOLS / "AGENT_GUIDE.template.md").read_text(encoding="utf-8")
guide = (guide.replace("{BATCH_DIR}", C.HERE.resolve().as_posix())
         .replace("{TOOLS}", TOOLS.parent.as_posix())
         .replace("{GENRES}", ", ".join(C.genres()))
         .replace("{PYTHON}", Path(sys.executable).as_posix())
         .replace("{SINCE}", f"{since} UTC" if since else "(no earlier audit)"))
(C.HERE / "AGENT_GUIDE.md").write_text(guide, encoding="utf-8", newline="\n")

C.write_json("items_scan.json", {"items": items})
fc = collections.Counter(x.split(":")[0] for f in flags.values() for x in f)
kc = collections.Counter(i["kind"] for i in items)
rep = [f"songs {len(rows)}  missing meta {missing_meta}  (search results for "
       f"{sum(1 for r in rows if search(r) is not None)})",
       f"flags {dict(fc)}", f"scan cards {dict(kc)}",
       f"agent scope: {len(scope)} songs ({'all' if ALL or not since else f'added after {since} UTC + must-fix'}), "
       f"packets { {b: len(v) for b, v in packets.items()} } + names_catalog.tsv",
       f"artist variant groups {len(variant_groups)}"]
(C.HERE / "scan_report.txt").write_text("\n".join(rep), encoding="utf-8")
print("\n".join(rep))
