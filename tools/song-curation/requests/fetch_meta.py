#!/usr/bin/env python3
"""Fetch YouTube watch-page metadata for every catalog video (read-only).

Resumable: one JSON per id under meta/. Extracts videoDetails, playability,
microformat (upload date, countries, category), owner badges, the description
"Music" section (YouTube's own song/artist/album credits) and the
"most replayed" heat markers.

usage: python fetch_meta.py catalog.json [--workers 4]
"""
from __future__ import annotations
import json, sys, time, urllib.request, concurrent.futures as cf
from pathlib import Path

HERE = Path.cwd()  # the batch folder
OUT = HERE / "meta"
OUT.mkdir(exist_ok=True)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")


def slice_json(html: str, marker: str):
    i = html.find(marker)
    if i < 0:
        return None
    j = html.find("{", i)
    depth, k, in_str, esc = 0, j, False, False
    while k < len(html):
        ch = html[k]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(html[j:k + 1])
        k += 1
    return None


def walk(o, key):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                yield v
            yield from walk(v, key)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v, key)


def text_of(x):
    if isinstance(x, dict):
        if "simpleText" in x:
            return x["simpleText"]
        if "runs" in x:
            return "".join(r.get("text", "") for r in x["runs"])
        if "content" in x:
            return x["content"]
    return x if isinstance(x, str) else None


def extract(vid: str, html: str) -> dict:
    pr = slice_json(html, "var ytInitialPlayerResponse = ") or {}
    idata = slice_json(html, "var ytInitialData = ") or {}
    vd = pr.get("videoDetails", {})
    ps = pr.get("playabilityStatus", {})
    mf = pr.get("microformat", {}).get("playerMicroformatRenderer", {})
    badges = [b.get("metadataBadgeRenderer", {}).get("style")
              for vo in walk(idata, "videoOwnerRenderer")
              for b in (vo.get("badges") or [])]
    subs = None
    for vo in walk(idata, "videoOwnerRenderer"):
        subs = text_of(vo.get("subscriberCountText"))
        break
    music = []
    for lock in walk(idata, "carouselLockupRenderer"):
        item = {}
        for row in lock.get("infoRows", []):
            r = row.get("infoRowRenderer", {})
            k = text_of(r.get("title"))
            v = text_of(r.get("defaultMetadata")) or text_of(r.get("expandedMetadata"))
            if k:
                item[k] = v
        vl = lock.get("videoLockup", {}).get("compactVideoRenderer", {})
        if vl:
            item["_video_id"] = vl.get("videoId")
            item["_video_title"] = text_of(vl.get("title"))
        if item:
            music.append(item)
    for hl in walk(idata, "horizontalCardListRenderer"):
        hdr = text_of(((hl.get("header") or {}).get("richListHeaderRenderer") or {}).get("title"))
        if hdr != "Music":
            continue
        for card in hl.get("cards", []):
            va = card.get("videoAttributeViewModel")
            if va:
                music.append({"song": va.get("title"), "artist": va.get("subtitle"),
                              "album": text_of(va.get("secondarySubtitle"))})
    heat = None
    for m in walk(idata, "macroMarkersListEntity"):
        ml = m.get("markersList", {})
        if ml.get("markerType") == "MARKER_TYPE_HEATMAP":
            heat = [(int(x["startMillis"]) // 1000, round(float(x.get("intensityScoreNormalized", 0)), 3))
                    for x in ml.get("markers", [])]
            break
    return {
        "id": vid,
        "fetched": int(time.time()),
        "status": ps.get("status"),
        "reason": ps.get("reason"),
        "playableInEmbed": ps.get("playableInEmbed"),
        "title": vd.get("title"),
        "author": vd.get("author"),
        "channelId": vd.get("channelId"),
        "views": int(vd["viewCount"]) if vd.get("viewCount", "").isdigit() else None,
        "length": int(vd["lengthSeconds"]) if vd.get("lengthSeconds", "").isdigit() else None,
        "isLive": vd.get("isLiveContent"),
        "uploadDate": mf.get("uploadDate"),
        "publishDate": mf.get("publishDate"),
        "category": mf.get("category"),
        "il": (None if mf.get("availableCountries") is None else "IL" in mf.get("availableCountries")),
        "n_countries": len(mf.get("availableCountries") or []),
        "ownerProfileUrl": mf.get("ownerProfileUrl"),
        "badges": badges,
        "subs": subs,
        "music": music,
        "heat": heat,
        "description": (vd.get("shortDescription") or "")[:600],
    }


def fetch(vid: str) -> str:
    out = OUT / f"{vid}.json"
    if out.exists():
        return "cached"
    url = f"https://www.youtube.com/watch?v={vid}&hl=en&gl=IL"
    last = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                "Cookie": "CONSENT=YES+1; SOCS=CAI"})
            html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
            if "ytInitialPlayerResponse" not in html:
                raise RuntimeError("no player response")
            data = extract(vid, html)
            out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            time.sleep(PAUSE)
            return data.get("status") or "?"
        except Exception as e:  # noqa: BLE001
            last = e
            # 429 = YouTube rate limit: back off hard, it clears in ~a minute
            time.sleep((45 if "429" in str(e) else 3) * (attempt + 1))
    return f"ERR {last}"


PAUSE = 0.6


def main():
    rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 4
    ids = [r["youtube_id"] for r in rows]
    extra = HERE / "extra_ids.txt"
    if extra.exists():
        ids += [x.strip() for x in extra.read_text().split() if x.strip()]
    ids = list(dict.fromkeys(ids))
    done = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(workers) as ex:
        for vid, res in zip(ids, ex.map(fetch, ids)):
            done += 1
            if res != "cached" and res != "OK":
                print(vid, res, flush=True)
            if done % 100 == 0:
                print(f"{done}/{len(ids)} {time.time()-t0:.0f}s", flush=True)
    print("DONE", done, f"{time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
