#!/usr/bin/env python3
"""Dry run of the review: approve every card with its default proposal
(possible duplicates rejected) in a throwaway sim/ folder, run make_sql.py
there, and print what would conflict. Run it before handing the page to the
maintainer: conflicts it prints need a merge.py fix or an "approve only one"
note, not the maintainer's time.

usage (from the batch folder): python <tools>/audit/simulate.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path.cwd()
SIM = HERE / "sim"
SIM.mkdir(exist_ok=True)
shutil.copy(HERE / "items.json", SIM / "items.json")
items = json.loads((SIM / "items.json").read_text(encoding="utf-8"))["items"]
dec, pair_seen, pairs = {}, set(), 0
for it in items:
    p = it.get("proposal") or {}
    if it["kind"] == "maybe_dup":
        dec[it["id"]] = {"status": "rejected", "fields": {}, "keep": None}
        continue
    # "⚠ ... Approve only one.": the reviewer approves one card of the pair
    if any(e.startswith("⚠ Another card") for e in it.get("evidence") or []):
        sid = it["songs"][0]["id"]
        if sid in pair_seen:
            dec[it["id"]] = {"status": "rejected", "fields": {}, "keep": None}
            continue
        pair_seen.add(sid)
        pairs += 1
    dec[it["id"]] = {"status": "approved", "fields": dict(p.get("fields") or {}), "keep": p.get("keep")}
(SIM / "decisions.json").write_text(json.dumps(dec, ensure_ascii=False), encoding="utf-8")
print(f"{len(items)} cards; {pairs} 'approve only one' groups (first card approved); possible duplicates rejected")
r = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "make_sql.py")], cwd=SIM,
                   capture_output=True, text=True, encoding="utf-8")
print(r.stdout[-6000:], r.stderr[-2000:])
