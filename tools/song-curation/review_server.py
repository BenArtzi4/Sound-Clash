#!/usr/bin/env python3
"""Song review server (stdlib only) for tools/song-curation/review.html.

Serves the review tool and keeps every decision on disk, in
``<batch dir>/decisions.json``, so a review survives a closed tab, a different
browser window, or a restart of this server. The page also keeps its own copy
in localStorage and queues every change until this server confirms it, so a
dead server never loses a click: restart it and the page catches up.

    python review_server.py batches/2026-10-11 --port 8760
    -> open http://localhost:8760/

The batch dir is looked up relative to the current directory first, then
relative to this file's folder, so both of these work:

    cd tools/song-curation && python review_server.py batches/2026-10-11
    python tools/song-curation/review_server.py batches/2026-10-11

Any other batch under ``batches/`` can be opened on the same server with
``http://localhost:8760/?batch=<name>``; its decisions go to that batch's own
decisions.json.

Routes
  GET  /                               review.html
  GET  /candidates.js                  the default batch's candidates.js
  GET  /<file>                         static files from this folder
  GET  /api/info                       {"app": "song-review", "default_batch": ...}
  GET  /api/decisions?batch=NAME       the batch's decisions document
  POST /api/decisions?batch=NAME       {"changes": {id: rec|null}, "errors": {...}}
                                       or {"reset": true, "at": ms}
  POST /api/save-file?batch=NAME&name=approved-songs-....csv   (raw body)

Listens on loopback only (127.0.0.1 and ::1), never on the LAN.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

TOOL = Path(__file__).resolve().parent
BATCHES = TOOL / "batches"
FORMAT = "song-review/v1"
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SAVE_NAME_RE = re.compile(r"^approved-songs[A-Za-z0-9._-]*\.csv$")
STATIC_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

LOCK = threading.Lock()
DEFAULT: dict[str, Path | str | None] = {"name": None, "dir": None}


def now_ms() -> int:
    return int(time.time() * 1000)


def batch_dir(name: str | None) -> Path | None:
    """Resolve a batch name to its folder; None when the name is not usable."""
    if not name or not NAME_RE.match(name) or name in (".", ".."):
        return None
    if name == DEFAULT["name"] and DEFAULT["dir"] is not None:
        return DEFAULT["dir"]  # type: ignore[return-value]
    d = (BATCHES / name).resolve()
    if d.parent != BATCHES.resolve() or not d.is_dir():
        return None
    return d


def empty_doc(name: str) -> dict:
    return {"format": FORMAT, "batch": name, "updated": None, "reset_at": 0,
            "decisions": {}, "errors": {}}


def read_doc(d: Path, name: str) -> tuple[dict, bool]:
    """Return (doc, foreign). foreign = a decisions.json from another tool."""
    p = d / "decisions.json"
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return empty_doc(name), False
    except (OSError, ValueError):
        return empty_doc(name), True
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        return empty_doc(name), True
    doc.setdefault("decisions", {})
    doc.setdefault("errors", {})
    doc.setdefault("reset_at", 0)
    return doc, False


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    # Windows: os.replace fails while another process (editor, antivirus,
    # indexer) briefly holds the target open; retry before giving up.
    for attempt in range(20):
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            time.sleep(0.05 * (attempt + 1))
    os.replace(tmp, p)


def write_doc(d: Path, doc: dict) -> None:
    doc["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
    write_atomic(d / "decisions.json", json.dumps(doc, ensure_ascii=False, indent=1))


def merge_changes(doc: dict, body: dict) -> dict:
    """Last-writer-wins per record (by the client's ``at`` ms timestamp)."""
    stale: dict = {}
    reset_at = int(doc.get("reset_at") or 0)
    decisions = doc["decisions"]
    for rid, rec in (body.get("changes") or {}).items():
        rid = str(rid)
        if rec is None:
            decisions.pop(rid, None)
            continue
        if not isinstance(rec, dict):
            continue
        at = int(rec.get("at") or 0)
        cur = decisions.get(rid)
        if at <= reset_at:
            stale[rid] = cur  # written before the last reset: drop it
        elif cur is not None and int(cur.get("at") or 0) > at:
            stale[rid] = cur  # the server already has something newer
        else:
            decisions[rid] = rec
    errors = doc["errors"]
    for vid, err in (body.get("errors") or {}).items():
        if err is None:
            errors.pop(str(vid), None)
        elif isinstance(err, dict):
            cur = errors.get(str(vid))
            if cur is None or int(cur.get("at") or 0) <= int(err.get("at") or 0):
                errors[str(vid)] = err
    return stale


class Handler(BaseHTTPRequestHandler):
    server_version = "SongReview/1"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    # ---- helpers -------------------------------------------------------
    def send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text") or ctype.endswith("json") else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def json(self, code: int, obj) -> None:
        self.send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json")

    def body_bytes(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n > 0 else b""

    def query(self) -> dict[str, str]:
        q = parse_qs(urlparse(self.path).query)
        return {k: v[0] for k, v in q.items() if v}

    def static(self, rel: str) -> None:
        # normpath + prefix check (then realpath, for symlinks): only files
        # inside the tool folder, only the extensions in STATIC_TYPES.
        base = os.path.realpath(TOOL)
        target = os.path.normpath(os.path.join(base, rel))
        if not target.startswith(base + os.sep):
            return self.json(403, {"error": "outside the tool folder"})
        real = os.path.realpath(target)
        if not real.startswith(base + os.sep):
            return self.json(403, {"error": "outside the tool folder"})
        ext = os.path.splitext(real)[1].lower()
        ctype = STATIC_TYPES.get(ext)
        if ctype is None or not os.path.isfile(real):
            return self.json(404, {"error": "not found"})
        with open(real, "rb") as fh:
            self.send(200, fh.read(), ctype)

    # ---- routes --------------------------------------------------------
    def do_GET(self):  # noqa: N802
        path = unquote(urlparse(self.path).path)
        if path in ("/", "/index.html"):
            return self.static("review.html")
        if path == "/candidates.js":
            d = DEFAULT["dir"]
            if d is not None and (d / "candidates.js").is_file():  # type: ignore[operator]
                return self.send(200, (d / "candidates.js").read_bytes(), "text/javascript")  # type: ignore[operator]
            return self.static("candidates.js")
        if path == "/api/info":
            d = DEFAULT["dir"]
            return self.json(200, {
                "app": "song-review",
                "version": 1,
                "default_batch": DEFAULT["name"],
                "default_dir": str(d) if d else None,
            })
        if path == "/api/decisions":
            name = self.query().get("batch")
            d = batch_dir(name)
            if d is None:
                return self.json(404, {"error": f"unknown batch: {name!r}"})
            with LOCK:
                doc, foreign = read_doc(d, name)  # type: ignore[arg-type]
            doc = dict(doc)
            doc["foreign"] = foreign
            doc["file"] = str(d / "decisions.json")
            return self.json(200, doc)
        if path.startswith("/api/"):
            return self.json(404, {"error": "not found"})
        return self.static(path.lstrip("/"))

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        q = self.query()
        name = q.get("batch")
        d = batch_dir(name)
        if d is None:
            return self.json(404, {"error": f"unknown batch: {name!r}"})
        if path == "/api/decisions":
            try:
                body = json.loads(self.body_bytes().decode("utf-8") or "{}")
                assert isinstance(body, dict)
            except Exception:  # noqa: BLE001
                return self.json(400, {"error": "body must be a JSON object"})
            with LOCK:
                doc, foreign = read_doc(d, name)  # type: ignore[arg-type]
                if foreign:
                    return self.json(409, {"error": "decisions.json in this folder belongs to another tool; not overwriting it"})
                if body.get("reset"):
                    src = d / "decisions.json"
                    if src.exists():
                        stamp = time.strftime("%Y%m%d-%H%M%S")
                        shutil.copyfile(src, d / f"decisions.before-reset-{stamp}.json")
                    doc = empty_doc(name)  # type: ignore[arg-type]
                    doc["reset_at"] = int(body.get("at") or now_ms())
                    write_doc(d, doc)
                    return self.json(200, {"ok": True, "count": 0, "reset_at": doc["reset_at"]})
                stale = merge_changes(doc, body)
                write_doc(d, doc)
            return self.json(200, {"ok": True, "count": len(doc["decisions"]), "stale": stale,
                                   "updated": doc["updated"]})
        if path == "/api/save-file":
            fname = q.get("name") or ""
            if not SAVE_NAME_RE.match(fname):
                return self.json(400, {"error": "file name must look like approved-songs-*.csv"})
            data = self.body_bytes()
            with LOCK:
                (d / fname).write_bytes(data)
            return self.json(200, {"ok": True, "path": str(d / fname)})
        return self.json(404, {"error": "not found"})


class V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def resolve_batch_arg(arg: str) -> Path:
    for base in (Path.cwd(), TOOL):
        p = (base / arg).resolve()
        if p.is_dir():
            return p
    sys.exit(f"batch folder not found: {arg} (looked in {Path.cwd()} and {TOOL})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve the song review page and save decisions to <batch>/decisions.json.")
    ap.add_argument("batch", nargs="?", help="batch folder holding candidates.js, e.g. batches/2026-10-11")
    ap.add_argument("--port", type=int, default=8760)
    ap.add_argument("--open", action="store_true", help="open the page in the default browser")
    args = ap.parse_args()

    if args.batch:
        d = resolve_batch_arg(args.batch)
        DEFAULT["dir"] = d
        DEFAULT["name"] = d.name
        if not (d / "candidates.js").is_file():
            print(f"warning: {d / 'candidates.js'} does not exist yet", flush=True)
        if (d / "decisions.json").is_file():
            doc, foreign = read_doc(d, d.name)
            if foreign:
                print(f"warning: {d / 'decisions.json'} is not a song-review file; decisions will stay in the browser only", flush=True)
            else:
                shutil.copyfile(d / "decisions.json", d / "decisions.startup-backup.json")
                print(f"{len(doc['decisions'])} saved decision(s) found; backup: decisions.startup-backup.json", flush=True)

    servers = []
    try:
        servers.append(ThreadingHTTPServer(("127.0.0.1", args.port), Handler))
    except OSError as e:
        sys.exit(f"cannot listen on 127.0.0.1:{args.port}: {e} (is another server already using this port?)")
    try:
        servers.append(V6Server(("::1", args.port), Handler))
    except OSError as e:
        print(f"note: IPv6 loopback unavailable ({e}); serving IPv4 only", flush=True)

    url = f"http://localhost:{args.port}/"
    where = f"batch {DEFAULT['name']} -> {DEFAULT['dir'] / 'decisions.json'}" if DEFAULT["dir"] else "no batch (pass a batch folder to save decisions to disk)"
    print(f"Song review: {url}   ({where})", flush=True)
    print("Other batches: " + url + "?batch=<name under batches/>   Ctrl+C to stop.", flush=True)
    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("stopped", flush=True)


if __name__ == "__main__":
    main()
