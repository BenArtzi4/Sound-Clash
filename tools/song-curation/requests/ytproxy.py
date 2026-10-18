#!/usr/bin/env python3
"""Local YouTube gateway for song research (copied from the 2026-10-09 audit).

One worker thread talks to YouTube, one request at a time with pacing and a
hard back-off on HTTP 429, so any number of agents can share it without
getting the machine's IP throttled. Everything is cached on disk.

Priorities: 0 = interactive (agents via yt.py), 1 = background meta sweep of
the catalog, 2 = background search sweep of the catalog.

  GET /info?id=<11 chars>       watch-page metadata (see fetch_meta.extract)
  GET /search?q=<query>&n=<k>   search results (relevance, videos only)
      &sort=views               ... most viewed first (one page, ~20 results)
  GET /status                   queue sizes, cooldown, counters

usage: python ytproxy.py <rows.json> [--port 8791] [--prefetch N]
(rows = wanted.json for song requests, catalog.json for the catalog audit)
"""
from __future__ import annotations
import hashlib, itertools, json, queue, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import fetch_meta as fm  # noqa: E402
import socket  # noqa: E402

# This machine's IPv6 address got a Google "sorry" captcha block after a
# 4-worker burst; IPv4 is clean. Force every lookup to IPv4.
_orig_gai = socket.getaddrinfo
socket.getaddrinfo = lambda *a, **k: [r for r in _orig_gai(*a, **k) if r[0] == socket.AF_INET]

BATCH = Path.cwd()  # run from the batch folder; caches live there
META = BATCH / "meta"
SEARCH = BATCH / "search"
META.mkdir(exist_ok=True)
SEARCH.mkdir(exist_ok=True)
UA = fm.UA

PACE = 1.5          # seconds between YouTube requests
state = {"cooldown_until": 0.0, "n429": 0, "done": 0, "errors": 0, "last": 0.0, "busy": False, "sweep": "none"}
jobs: "queue.PriorityQueue" = queue.PriorityQueue()
seq = itertools.count()
inflight: dict = {}
lock = threading.Lock()


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
        "Cookie": "CONSENT=YES+1; SOCS=CAI"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def search_key(q: str) -> str:
    return hashlib.sha1(q.encode("utf-8")).hexdigest()[:16]


def parse_search(html: str):
    data = fm.slice_json(html, "var ytInitialData = ") or {}
    out, seen = [], set()
    for r in fm.walk(data, "videoRenderer"):
        vid = r.get("videoId")
        if not vid or vid in seen:
            continue
        seen.add(vid)
        badges = [b.get("metadataBadgeRenderer", {}).get("style") for b in (r.get("ownerBadges") or [])]
        out.append({
            "id": vid,
            "title": fm.text_of(r.get("title")),
            "channel": fm.text_of(r.get("ownerText")) or fm.text_of(r.get("longBylineText")),
            "badge": "artist" if "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in badges
                     else ("verified" if "BADGE_STYLE_TYPE_VERIFIED" in badges else ""),
            "views": parse_views(fm.text_of(r.get("viewCountText"))),
            "length": parse_len(fm.text_of(r.get("lengthText"))),
            "age": fm.text_of(r.get("publishedTimeText")),
        })
    return out


def parse_views(s):
    if not s:
        return None
    digits = "".join(c for c in s if c.isdigit())
    return int(digits) if digits else (0 if "No views" in s else None)


def parse_len(s):
    if not s:
        return None
    parts = [int(p) for p in s.split(":") if p.isdigit()]
    t = 0
    for p in parts:
        t = t * 60 + p
    return t


def do_job(kind: str, arg: str):
    if kind == "info":
        p = META / f"{arg}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        html = http_get(f"https://www.youtube.com/watch?v={arg}&hl=en&gl=IL")
        if "ytInitialPlayerResponse" not in html:
            raise RuntimeError("no player response")
        d = fm.extract(arg, html)
        p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        return d
    if kind in ("search", "vsearch"):
        p = SEARCH / f"{'v_' if kind == 'vsearch' else ''}{search_key(arg)}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))["results"]
        # sp: EgIQAQ== = videos only, by relevance; CAMSAhAB = videos only, most viewed
        sp = "CAMSAhAB" if kind == "vsearch" else "EgIQAQ%253D%253D"
        url = ("https://www.youtube.com/results?hl=en&gl=IL&search_query="
               + urllib.parse.quote_plus(arg) + "&sp=" + sp)
        res = parse_search(http_get(url))
        p.write_text(json.dumps({"q": arg, "results": res}, ensure_ascii=False), encoding="utf-8")
        return res
    raise ValueError(kind)


def cached(kind: str, arg: str) -> bool:
    if kind == "info":
        return (META / f"{arg}.json").exists()
    return (SEARCH / f"{'v_' if kind == 'vsearch' else ''}{search_key(arg)}.json").exists()


def worker():
    while True:
        prio, n, kind, arg, holder = jobs.get()
        state["busy"] = True
        if cached(kind, arg):
            try:
                holder["result"] = do_job(kind, arg)
            except Exception as e:  # noqa: BLE001
                holder["error"] = str(e)
            holder["event"].set()
            state["busy"] = False
            continue
        attempts = 0
        while True:
            wait = max(state["cooldown_until"], state["last"] + PACE) - time.time()
            if wait > 0:
                time.sleep(wait)
            state["last"] = time.time()
            try:
                holder["result"] = do_job(kind, arg)
                state["done"] += 1
                break
            except Exception as e:  # noqa: BLE001
                attempts += 1
                if "429" in str(e):
                    state["n429"] += 1
                    state["cooldown_until"] = time.time() + min(600, 90 * attempts)
                    print(f"429 -> cooling down {min(600, 90 * attempts)}s", flush=True)
                    continue
                if attempts >= 3:
                    holder["error"] = str(e)
                    state["errors"] += 1
                    break
                time.sleep(3 * attempts)
        holder["event"].set()
        state["busy"] = False


def submit(prio: int, kind: str, arg: str):
    holder = {"event": threading.Event()}
    jobs.put((prio, next(seq), kind, arg, holder))
    return holder


def song_query(r: dict) -> str:
    t, a = r["title"].strip(), r["artist"].strip()
    return t if t.casefold() == a.casefold() else f"{a} {t}"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code: int, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        if u.path == "/status":
            # "finished": the background sweep has fed every row and nothing is queued or running
            return self._send(200, {"queued": jobs.qsize(), **state,
                                    "finished": state["sweep"] != "running" and jobs.qsize() == 0 and not state["busy"],
                                    "cooldown_left": max(0, round(state["cooldown_until"] - time.time()))})
        if u.path in ("/info", "/search"):
            kind = u.path[1:]
            if kind == "search" and (qs.get("sort") or [""])[0] == "views":
                kind = "vsearch"
            arg = (qs.get("id") or qs.get("q") or [""])[0].strip()
            if not arg:
                return self._send(400, {"error": "missing id/q"})
            h = submit(0, kind, arg)
            if not h["event"].wait(900):
                return self._send(504, {"error": "timeout"})
            if "error" in h:
                return self._send(502, {"error": h["error"]})
            res = h["result"]
            if kind in ("search", "vsearch"):
                res = res[: int((qs.get("n") or ["10"])[0])]
            return self._send(200, res)
        self._send(404, {"error": "not found"})


PREFETCH_TOP = 4  # watch-page info for the top-N hits of every background search (--prefetch N)


def prefetch_after_search(q: str):
    """Background sweep: once a song's search is cached, queue info for its top hits."""
    try:
        res = do_job("search", q)
    except Exception:  # noqa: BLE001
        return
    for h in res[:PREFETCH_TOP]:
        if not cached("info", h["id"]):
            submit(1, "info", h["id"])


def sweeper(queries):
    """Feed searches one by one (prio 2) and follow each with its top-hit infos (prio 1)."""
    state["sweep"] = "running"
    for q in dict.fromkeys(queries):
        h = submit(2, "search", q)
        h["event"].wait(900)
        prefetch_after_search(q)
    state["sweep"] = "done"
    print(f"sweep done: {len(set(queries))} searches, errors so far {state['errors']}", flush=True)


def main():
    """usage: python ytproxy.py [rows.json] [--port 8791] [--prefetch N]

    Rows with a youtube_id get their watch page prefetched; rows with
    title/artist get a background search + info for the top N hits (default 4;
    the catalog audit passes 0, it only needs the search results). Without a
    rows file it only answers yt.py (e.g. building an artist wish-list)."""
    global PREFETCH_TOP
    src = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    rows = json.loads(Path(src).read_text(encoding="utf-8")) if src else []
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8791
    if "--prefetch" in sys.argv:
        PREFETCH_TOP = int(sys.argv[sys.argv.index("--prefetch") + 1])
    for r in rows:
        if r.get("youtube_id") and not cached("info", r["youtube_id"]):
            submit(1, "info", r["youtube_id"])
    queries = [song_query(r) for r in rows if r.get("title")]
    if queries:
        state["sweep"] = "running"  # before the threads start, so "finished" can't flash true
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=sweeper, args=(queries,), daemon=True).start()
    print(f"ytproxy on :{port}, {len(queries)} searches to sweep", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()


if __name__ == "__main__":
    main()
