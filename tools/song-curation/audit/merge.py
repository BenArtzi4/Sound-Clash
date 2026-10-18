#!/usr/bin/env python3
"""Scan cards + agent proposals -> items.json, the review page's input.

- every agent-proposed video is re-verified (status OK, embeddable, not blocked
  in Israel) from the cache or through the gateway; failures are dropped with a note
- a candidate whose title, channel or credits don't name the song's performer
  gets a visible warning (the "wrong performer" failure mode); a scan "bigger
  official upload" pick that fails the check is dropped
- duplicate groups proposed by both the scan and an agent merge into one card;
  an agent's researched genres win over the scan's genre union
- style changes yield to an agent's change on the same field; agents restating
  the current value become notes; two cards changing one field are marked
  "approve only one"
- anything an earlier audit already settled is not offered again: a value or
  video the maintainer rejected, and duplicate groups they chose to keep

usage (from the batch folder): python <tools>/audit/merge.py
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections import Counter

import common as C
from common import coverage, primary

rows = {r["id"]: r for r in C.read_json("catalog.json")}
scan_items = C.read_json("items_scan.json")["items"]
GENRES = set(C.genres())
hist = C.history()
log = []


def info(vid):
    m = C.meta(vid)
    if m:
        return m
    try:
        with urllib.request.urlopen(f"{C.GATEWAY}/info?id=" + urllib.parse.quote(vid), timeout=900) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.append(f"info failed {vid}: {e}")
        return None


def cand_from(vid, note, start, artist, title, soundtrack):
    m = info(vid)
    if not m:
        return None, f"{vid}: could not be checked"
    if m.get("status") != "OK" or m.get("playableInEmbed") is False or m.get("il") is False:
        return None, f"{vid}: dropped — status={m.get('status')} embed={m.get('playableInEmbed')} IL={m.get('il')}"
    c = {"youtube_id": vid, "title": m.get("title"), "channel": m.get("author"), "badge": C.badge_of(m),
         "views": m.get("views"), "length": m.get("length"), "upload": m.get("uploadDate"), "note": note or ""}
    if start is not None:
        c["start_time"] = int(start)
    hay = " ".join([m.get("title") or "", m.get("author") or "", m.get("description") or ""] +
                   [f"{x.get('song')} {x.get('artist')}" for x in m.get("music") or []])
    names_hay = " ".join([m.get("author") or ""] + [x.get("artist") or "" for x in m.get("music") or []])
    warn, soft = [], []
    if not soundtrack and coverage(primary(artist), hay) < 0.5:
        if C.HEB.search(artist) and not C.HEB.search(names_hay):
            soft.append("performer is written in English on this upload")
        else:
            warn.append("performer not named on this video — check it is the right artist")
    if not soundtrack and coverage(title, hay) < 0.5:
        if C.HEB.search(title) and not C.HEB.search(m.get("title") or ""):
            soft.append("title is in English/transliteration on this upload")
        else:
            warn.append("song title not found on this video — check it is the right song")
    if soft:
        c["note"] = ("(" + "; ".join(soft) + " — confirm by ear) " + c["note"]).strip()
    if warn:
        c["note"] = ("⚠ " + "; ".join(warn) + ". " + c["note"]).strip()
    return c, None


items = list(scan_items)
dup_index = {frozenset(s["id"] for s in it["songs"]): it for it in items if it["kind"] in ("duplicate", "maybe_dup")}

for pf in sorted((C.HERE / "proposals").glob("*.json")):
    bucket = pf.stem
    try:
        props = json.loads(pf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.append(f"{pf.name}: bad JSON {e}")
        continue
    agent_extra = list(props)  # the loop also picks up cards split off duplicates
    for n, p in enumerate(agent_extra):
        sid, kind = p.get("song_id"), p.get("kind")
        if sid not in rows:
            log.append(f"{bucket}#{n}: unknown song_id {sid}")
            continue
        if kind not in ("video", "name", "metadata", "broken", "duplicate"):
            log.append(f"{bucket}#{n}: bad kind {kind}")
            continue
        r = rows[sid]
        prop = p.get("proposal") or {}
        fields = dict(prop.get("fields") or {})
        if "genres" in fields:
            bad = [g for g in fields["genres"] if g not in GENRES]
            if bad:
                log.append(f"{bucket}#{n}: invalid genres {bad} dropped")
                fields["genres"] = [g for g in fields["genres"] if g in GENRES]
        if "release_year" in fields and "israeli-cover" in r["genres"].split(";"):
            fields.pop("release_year")  # cover years are mixed on purpose
            log.append(f"{bucket}#{n}: release_year change on an israeli-cover song dropped")
            if kind == "metadata" and not fields:
                continue
        ev = list(p.get("evidence") or [])
        soundtrack = C.is_soundtrack(r)
        if kind == "duplicate":
            ids = [x for x in (p.get("dup_song_ids") or []) if x in rows]
            if sid not in ids:
                ids.insert(0, sid)
            if len(ids) < 2:
                log.append(f"{bucket}#{n}: duplicate with <2 known songs")
                continue
            keep = prop.get("keep") if prop.get("keep") in ids else None
            # "keep row A but give it row B's video" == keep row B
            new_vid = fields.pop("youtube_id", None)
            fields.pop("start_time", None)
            if new_vid:
                owner = next((x for x in ids if rows[x]["youtube_id"] == new_vid), None)
                if owner:
                    keep = owner
                elif keep:  # a brand-new video for the kept song: its own Better-video card
                    agent_extra.append({"song_id": keep, "kind": "video", "severity": 2,
                                        "summary": "Better video for the copy you keep (from the duplicate check)",
                                        "evidence": ev, "confidence": p.get("confidence"),
                                        "proposal": {"action": "update", "fields": {"youtube_id": new_vid}},
                                        "candidates": p.get("candidates") or [{"youtube_id": new_vid}]})
            key = frozenset(ids)
            if key in dup_index:
                card = dup_index[key]
                card["evidence"] += [f"[{bucket}] {e}" for e in ev]
                if keep and keep != card["proposal"].get("keep"):
                    old = card["proposal"].get("keep")
                    if old:
                        card["evidence"].append(f"The scan's first guess was to keep {rows[old]['youtube_id']}; "
                                                f"the {bucket} agent's research says keep {rows[keep]['youtube_id']}.")
                    card["proposal"]["keep"] = keep  # the genre union stays valid whichever copy is kept
                card["by"] += f" + agent:{bucket}"
                continue
            it = {"id": f"{bucket}-dup-" + "-".join(sorted(x[:8] for x in ids)), "kind": "duplicate",
                  "severity": int(p.get("severity") or 3), "summary": p.get("summary") or "Duplicate",
                  "evidence": ev, "songs": [C.snapshot(rows[x]) for x in ids],
                  "proposal": {"action": "keep_one", "keep": keep, "fields": fields},
                  "by": f"agent:{bucket}", "confidence": p.get("confidence") or ""}
            items.append(it)
            dup_index[key] = it
            continue
        cands, dropped = [], []
        cids = [c.get("youtube_id") for c in (p.get("candidates") or []) if c.get("youtube_id")]
        if fields.get("youtube_id") and fields["youtube_id"] not in cids:
            cids.insert(0, fields["youtube_id"])
        notes = {c.get("youtube_id"): c for c in (p.get("candidates") or [])}
        for vid in dict.fromkeys(cids):
            if vid == r["youtube_id"]:
                continue
            c, err = cand_from(vid, (notes.get(vid) or {}).get("note"), (notes.get(vid) or {}).get("start_time"),
                               fields.get("artist", r["artist"]), fields.get("title", r["title"]), soundtrack)
            if c:
                cands.append(c)
            else:
                dropped.append(err)
        if dropped:
            ev.append("Dropped unplayable candidates: " + "; ".join(dropped))
        if "youtube_id" in fields:
            if cands:
                fields["youtube_id"] = cands[0]["youtube_id"]
                if cands[0].get("start_time") is not None and "start_time" not in fields:
                    fields["start_time"] = cands[0]["start_time"]
            else:
                fields.pop("youtube_id")
                fields.pop("start_time", None)
                if kind == "video":
                    log.append(f"{bucket}#{n}: video proposal lost all candidates ({sid})")
                    continue
        action = prop.get("action") if prop.get("action") in ("update", "delete") else "update"
        it = {"id": f"{bucket}-{kind}-{sid[:8]}", "kind": kind, "severity": int(p.get("severity") or 2),
              "summary": p.get("summary") or kind, "evidence": ev, "songs": [C.snapshot(r)],
              "proposal": {"action": action, "fields": fields}, "by": f"agent:{bucket}",
              "confidence": p.get("confidence") or ""}
        if cands:
            it["candidates"] = cands
        # the scan's broken card for this song takes the agent's fix
        scan_broken = next((x for x in items if x["kind"] == "broken" and x["songs"][0]["id"] == sid
                            and x["by"] == "scan"), None)
        if scan_broken and kind in ("broken", "video"):
            scan_broken["evidence"] += ev
            scan_broken["proposal"] = it["proposal"]
            if cands:
                scan_broken["candidates"] = cands
            scan_broken["by"] = f"scan + agent:{bucket}"
            continue
        items.append(it)

# scan "bigger official upload" cards: drop when an agent already handled the
# song's video, otherwise verify + describe the candidate like an agent's
agent_video = {it["songs"][0]["id"] for it in items
               if it["by"].startswith("agent") and it["kind"] in ("video", "broken")}
video_owner = {r["youtube_id"]: sid for sid, r in rows.items()}
kept = []
for it in items:
    if it["id"].startswith("bigger-"):
        s = it["songs"][0]
        if s["id"] in agent_video:
            continue
        if video_owner.get(it["candidates"][0]["youtube_id"], s["id"]) != s["id"]:
            continue  # the bigger upload is another catalog row: a duplicate card covers it
        r = rows[s["id"]]
        c, err = cand_from(it["candidates"][0]["youtube_id"], it["candidates"][0].get("note"), None,
                           r["artist"], r["title"], C.is_soundtrack(r))
        if not c:
            log.append(f"{it['id']}: {err}")
            continue
        if "⚠" in (c.get("note") or ""):
            log.append(f"{it['id']}: dropped, candidate failed the performer/title check")
            continue
        it["candidates"] = [c]
    kept.append(it)
items = kept

# an agent video that another catalog row already uses only works together
# with that row's deletion (unique youtube_id): say so on the card
for it in items:
    for c in it.get("candidates") or []:
        other = video_owner.get(c["youtube_id"])
        if other and other != it["songs"][0]["id"]:
            o = rows[other]
            c["note"] = (f"(already used by “{o['title']} — {o['artist']}”: only works if that copy is deleted "
                         f"via its Duplicate card) " + (c.get("note") or "")).strip()

# a duplicate card's genre union yields to an agent's researched genres
agent_genres = {}
for it in items:
    if it["by"].startswith("agent") and it["kind"] in ("metadata", "name") and \
            "genres" in (it["proposal"].get("fields") or {}):
        agent_genres[it["songs"][0]["id"]] = (it["proposal"]["fields"]["genres"], it["by"])
for it in items:
    if it["kind"] != "duplicate" or "genres" not in (it["proposal"].get("fields") or {}):
        continue
    hit = next((agent_genres[s["id"]] for s in it["songs"] if s["id"] in agent_genres), None)
    if hit:
        it["proposal"]["fields"]["genres"] = sorted(hit[0])
        it["evidence"].append(f"Genres for the kept copy follow {hit[1]}'s research: {', '.join(sorted(hit[0]))}.")

# a "possible duplicate" group that overlaps a real duplicate card: say so
for it in items:
    if it["kind"] != "maybe_dup":
        continue
    ids = {s["id"] for s in it["songs"]}
    for d in items:
        if d["kind"] == "duplicate" and ids & {s["id"] for s in d["songs"]}:
            names = ", ".join(f"{s['title']} — {s['artist']}" for s in d["songs"])
            it["evidence"].append(f"Overlaps a Duplicate card ({names}); decide that one first.")

# style yields to agent changes on the same song+field
agent_fields = {}
for it in items:
    if it["by"].startswith("agent") and it["kind"] in ("name", "metadata"):
        for f in (it["proposal"].get("fields") or {}):
            agent_fields.setdefault(it["songs"][0]["id"], set()).add(f)
final, seen_ids = [], set()
for it in items:
    if it["kind"] == "style":
        sid = it["songs"][0]["id"]
        for f in list(it["proposal"]["fields"]):
            if f in agent_fields.get(sid, set()):
                it["proposal"]["fields"].pop(f)
        if not it["proposal"]["fields"]:
            continue
    if it["id"] in seen_ids:
        it["id"] += "-b"
    seen_ids.add(it["id"])
    final.append(it)


# ---------------------------------------------------------------- earlier audits
def settled_out(it) -> str | None:
    """Why an earlier audit already answered this card (None = offer it)."""
    ids = {s["id"] for s in it["songs"]}
    if it["kind"] in ("duplicate", "maybe_dup"):
        if any(ids <= g for g in hist["kept_groups"]):
            return "duplicate group kept in an earlier audit"
        return None
    sid = it["songs"][0]["id"]
    fields = it["proposal"].get("fields") or {}
    for f in list(fields):
        # a mechanical style rule never overrides a value the maintainer approved
        # ("Sex on Fire" was approved; the casing rule would say "Sex On Fire")
        if it["kind"] == "style" and f in hist["settled"].get(sid, {}):
            fields.pop(f)
        elif (sid, f, C._canon(f, fields[f])) in hist["rejected"] or \
                (f == "youtube_id" and (sid, fields[f]) in hist["rejected_vids"]):
            fields.pop(f)
            if f == "youtube_id":
                fields.pop("start_time", None)
    if it.get("candidates"):
        it["candidates"] = [c for c in it["candidates"] if (sid, c["youtube_id"]) not in hist["rejected_vids"]]
        if not it["candidates"] and it["kind"] == "video":
            return "every candidate video was rejected in an earlier audit"
    if not fields and it["proposal"].get("action") != "delete" and it["kind"] in ("style", "name", "video") \
            and not it.get("candidates"):
        return "settled or rejected in an earlier audit"
    return None


suppressed = Counter()
offered = []
# cards you removed after the eyeball pass (one item id per line, "#" comments):
# survives re-running scan.py, which would otherwise bring a scan card back
drop_file = C.HERE / "drop_items.txt"
dropped = {ln.split("#")[0].strip() for ln in drop_file.read_text(encoding="utf-8").splitlines()} - {""} \
    if drop_file.exists() else set()
for it in final:
    why = "listed in drop_items.txt" if it["id"] in dropped else settled_out(it)
    if why:
        suppressed[why] += 1
        log.append(f"suppressed {it['id']}: {why}")
        continue
    offered.append(it)
final = offered


# no-op proposals (an agent re-stating the current value to disagree with
# another card) become a note on the cards that change that field
def cur_val(s, f):
    return sorted(s["genres"]) if f == "genres" else s.get(f)


def changes(it):
    if it["kind"] in ("duplicate", "maybe_dup") or it["proposal"].get("action") == "delete":
        return {}
    s = it["songs"][0]
    return {f: v for f, v in (it["proposal"].get("fields") or {}).items()
            if (sorted(v) if f == "genres" and isinstance(v, list) else v) != cur_val(s, f)}


noop_notes, cleaned = {}, []
for it in final:
    if (it["by"].startswith("agent") and it["kind"] in ("name", "metadata") and not changes(it)
            and it["proposal"].get("fields") and not it.get("candidates")):
        for f in it["proposal"]["fields"]:
            noop_notes.setdefault((it["songs"][0]["id"], f), []).append(f"{it['by']} disagrees: {it['summary']}")
        continue
    cleaned.append(it)
final = cleaned
by_field = {}
for it in final:
    for f, v in changes(it).items():
        by_field.setdefault((it["songs"][0]["id"], f), []).append((it, v))
for (sid, f), lst in by_field.items():
    for it, _ in lst:
        it["evidence"] += noop_notes.get((sid, f), [])
    if len({json.dumps(v, ensure_ascii=False) for _, v in lst}) > 1:
        for it, v in lst:
            others = [f"{o['by']} → {json.dumps(ov, ensure_ascii=False)}" for o, ov in lst if o is not it]
            it["evidence"].insert(0, f"⚠ Another card proposes a different {f} for this song "
                                     f"({'; '.join(others)}). Approve only one.")

C.write_json("items.json", {"batch": C.HERE.name, "genres": sorted(GENRES), "items": final})
print("items:", dict(Counter(i["kind"] for i in final)), "total", len(final))
print("by:", dict(Counter(i["by"].split(":")[0] for i in final)))
if suppressed:
    print("not offered (earlier audit / drop_items.txt):", dict(suppressed))
(C.HERE / "merge_log.txt").write_text("\n".join(log), encoding="utf-8")
print(f"{len(log)} log lines -> merge_log.txt")
