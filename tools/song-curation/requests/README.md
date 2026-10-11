# Player song requests → review batch

Turns a plain list of requested songs ("* title — artist" per line, as players
send them) into a review batch: deduped against the catalog, researched by
parallel agents, every YouTube id verified, opened in the review page.
First used for the 2026-10-11 batch (198 requests → 65 already in the game).

All scripts run **from the batch folder** (`tools/song-curation/batches/<date>/`,
gitignored) and read/write their data there. This folder only holds code.

| file | what it does |
| --- | --- |
| `parse_requests.py` | request list → `wanted.json` (net-new), `in_catalog.json`, `report.txt`. Dedups inside the list and against `_dumps/catalog_raw.json` (title + overlapping artist; Hebrew-aware normalisation). Same title by another artist is kept but noted. |
| `make_packets.py` | `wanted.json` → `packets/p1..pN.json` (one artist stays in one packet; each song carries every catalog song by that artist) + renders `AGENT_GUIDE.md` from the template. |
| `AGENT_GUIDE.template.md` | the research agents' instructions: identity, catalog check, video rule, year, genre, flags, output schema. |
| `ytproxy.py` / `yt.py` / `fetch_meta.py` | local YouTube gateway: ONE paced (1.5 s), IPv4-only, disk-cached process that every agent shares, with a 90 s back-off on HTTP 429. `ytproxy.py wanted.json` also sweeps a search for every song plus watch-page info for the top 4 hits in the background. `yt.py search` / `yt.py info` are the agents' only way to touch YouTube. Info includes playability, embeddable, Israel availability, views, upload date, YouTube's Music credits and the "most replayed" heatmap. |
| `catalog.py` | substring search over the catalog snapshot (agents use it to catch spelling variants). |
| *(local)* `.claude/curation-exclusions.txt` | optional private list of artists the maintainer doesn't add (git-ignored; keep it with your credentials). `parse_requests.py` tags requests credited to them (players often name the wrong singer, so they're still researched), `make_packets.py` names them only in the batch's local agent guide, and `finalize.py` drops any card whose *researched* artist is listed. |
| `gen_upload.py` | after the review: approved CSV → idempotent `upload_<batch>.sql` + read-only `verify_<batch>.sql`; `--check <result.json>` compares the verify output with the CSV row by row. Never connects to a database itself. |
| `finalize.py` | `research/*.json` + gateway cache → `candidates.js` (review-page format). Re-checks every video is playable/embeddable/allowed in IL, promotes a verified alternative if the main pick fails, drops catalog/batch duplicates, adds the heat strip + suggested start, flags low views / long videos / same-title conflicts / low confidence, turns `maybe_meant` guesses into their own cards, and flags songs or whole artists that earlier batches offered and the maintainer never approved. |

The catalog snapshot (`_dumps/catalog_raw.json`, columns `title, artist,
youtube_id, release_year, start_time, genres`) comes from a maintainer — this
tool never connects to the live database.

## Run

```bash
T=tools/song-curation; B=$T/batches/<date>; P="PYTHONUTF8=1 backend/.venv/Scripts/python.exe"
mkdir -p $B/_dumps            # put the catalog snapshot at $B/_dumps/catalog_raw.json
cd $B
$P ../../requests/parse_requests.py "<path to the request list>"
$P ../../requests/make_packets.py 3          # 3 agents ≈ 45 songs each, ~17 min
# start the gateway DETACHED (Claude Code reaps background shells on low RAM):
#   PowerShell: Start-Process python.exe -ArgumentList ../../requests/ytproxy.py,wanted.json -WorkingDirectory $B -WindowStyle Hidden
# launch one research agent per packet: "Read AGENT_GUIDE.md, do packets/pN.json, write research/pN.json"
$P ../../requests/finalize.py --title "Player requests — <month year>"
cd ../.. && $P review_server.py batches/<date> --port 8760   # start detached; open http://localhost:8760/
# (not 127.0.0.1 — YouTube refuses some label videos there; not file:// — nothing plays)
```

After review: export the approved CSV from the page (it carries `release_year`), then
`$P ../../requests/gen_upload.py approved-songs-<date>.csv` from the batch folder. A maintainer
applies `upload_<batch>.sql` with their own linked Supabase CLI, runs `verify_<batch>.sql`, and
checks it with `gen_upload.py <csv> --check <result.json>`. The step-by-step version (including
the one-time setup on a new computer) is the `song-requests` skill in
`.claude/skills/song-requests/SKILL.md`.

## What we learned on the first run (2026-10-11)

- **About 1 in 8 requests names the wrong performer** (e.g. "טיקיטאס — עומר אדם" is Noa Kirel's;
  "קוקוריקו — סטטיק" is Omer Adam & Eden Ben Zaken's). Trust the title, fix the artist, flag it.
- A third of the list was already in the game; dedup against the catalog before researching anything.
- **Unapproved = rejected.** A card left out of an earlier export was a reject; `finalize.py` says so
  on every re-offered song/artist instead of silently showing it again.
- The "most replayed" peak is a poor predictor of where the maintainer starts a song (within 10 s of the
  hand-set start only 30% of the time over 852 catalog songs; "first point after the opening 5% at ≥60% of
  the peak" gets 45%). So cards keep `start_time = 0` and show the heat strip + a suggested start instead.
- 3 research agents + the gateway finished 133 songs in ~17 min with zero HTTP 429s.
