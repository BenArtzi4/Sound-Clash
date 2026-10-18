#!/usr/bin/env python3
"""Catalog-audit review server (stdlib only).

Serves the review page from this folder and the audit's data from the batch
folder it is started in: every decision is saved to decisions.json there, so
the review survives browser switches and can span several sittings. Read-only
with respect to the live database: applying approved fixes is a separate step.

  GET  /                 review.html  (+ review.js, review.css from this folder)
  GET  /base.css         ../review.css: the add-songs review page's design system,
                         so both review pages look and behave the same
  GET  /api/items        items.json   (the proposals to review)
  GET  /api/decisions    decisions.json
  POST /api/decisions    {"item": "<id>", "decision": {...} | null}
  GET  /api/export       approved decisions joined with their items

Start it DETACHED (Claude Code reaps background shells when RAM runs low) and
open http://localhost:<port>/ (not 127.0.0.1: YouTube refuses some label videos
there; never file://).

usage (from the batch folder): python <tools>/audit/server.py [--port 8770]
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

TOOLS = Path(__file__).resolve().parent
DATA = Path.cwd()  # the batch folder
ITEMS = DATA / "items.json"
DECISIONS = DATA / "decisions.json"
lock = threading.Lock()
STATIC = {"/": ("review.html", "text/html"), "/review.html": ("review.html", "text/html"),
          "/review.js": ("review.js", "text/javascript"), "/review.css": ("review.css", "text/css"),
          "/base.css": ("../review.css", "text/css")}


def load(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_atomic(p: Path, obj) -> None:
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def json(self, code: int, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json")

    def do_GET(self):
        path = urlparse(self.path).path
        if path in STATIC:
            name, ctype = STATIC[path]
            return self.send(200, (TOOLS / name).read_bytes(), ctype)
        if path == "/api/items":
            return self.json(200, load(ITEMS, {"items": []}))
        if path == "/api/decisions":
            with lock:
                return self.json(200, load(DECISIONS, {}))
        if path == "/api/export":
            items = {i["id"]: i for i in load(ITEMS, {"items": []})["items"]}
            with lock:
                dec = load(DECISIONS, {})
            out = [{"item": items[k], "decision": v} for k, v in dec.items()
                   if v and v.get("status") == "approved" and k in items]
            return self.json(200, out)
        self.json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/decisions":
            return self.json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            item = str(body["item"])
        except Exception:  # noqa: BLE001
            return self.json(400, {"error": "bad body"})
        with lock:
            dec = load(DECISIONS, {})
            if body.get("decision") is None:
                dec.pop(item, None)
            else:
                d = dict(body["decision"])
                d["at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                dec[item] = d
            save_atomic(DECISIONS, dec)
        self.json(200, {"ok": True, "count": len(dec)})


class V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8770
    if not ITEMS.exists():
        sys.exit(f"no items.json in {DATA}: start the server from the audit's batch folder")
    print(f"Catalog audit review ({DATA.name}): http://localhost:{port}/", flush=True)
    # "localhost" may resolve to ::1 or 127.0.0.1 depending on the browser, so
    # listen on both loopback addresses (never on the LAN)
    try:
        v6 = V6Server(("::1", port), H)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError as e:
        print(f"IPv6 loopback unavailable: {e}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()


if __name__ == "__main__":
    main()
