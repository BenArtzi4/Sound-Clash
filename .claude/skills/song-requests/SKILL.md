---
name: song-requests
description: Turn a list of songs players/the maintainer want added to Sound Clash into a researched, verified review batch, open it in the review page, and after the human review upload the approved songs. Use when the user gives a song list (a .txt / chat paste / CSV of "title — artist"), says "new songs from users", "add these songs", "make a review for these songs", "song requests", or asks to repeat the October 2026 request batch.
---

# Song requests → review batch → upload

Proven on 2026-10-11: 198 requests → 75 already in the game → 133 researched by 3 parallel
agents in ~17 min (zero YouTube 429s) → 124 verified cards → 93 approved and uploaded
(catalog 1456 → 1549). Code: `tools/song-curation/requests/` (read its `README.md` once before
starting). Review page: `tools/song-curation/review.html` + `review_server.py`.

All paths below are relative to the repo root unless they start with `$B` (the batch folder).

## One-time setup on a new computer

- **Python 3.10+.** The scripts are stdlib-only, so any 3.10+ works; the repo's backend venv is fine:
  Windows `backend\.venv\Scripts\python.exe`, macOS/Linux `backend/.venv/bin/python`
  (create it with `cd backend && python -m venv .venv && .venv/.../pip install -e ".[dev]"`).
  Always set `PYTHONUTF8=1`, and never pass `-I`: it drops PYTHONUTF8 and Hebrew turns into `?`.
- **Supabase CLI** linked to the production project, run once from the repo root:
  `supabase login`, then `supabase link --project-ref <prod project ref>`. The ref and the database
  password are with the maintainer's credentials and are never in the repo. Check it works with
  `supabase db query --linked "select count(*) from songs"`.
- **`gh`** logged in (for the CHANGELOG PR), and optionally Claude in Chrome (for the browser check).
- **Batch folders are git-ignored**, so past batches don't come with a clone. That only weakens the
  "offered before and never approved" flags in `finalize.py`. The permanent exclusions live in
  `tools/song-curation/requests/excluded_artists.txt`, which is committed.

Session conventions:
- Network commands need `dangerouslyDisableSandbox: true`.
- Hebrew printed to the Bash console can come out garbled: redirect output into `$B/_dumps/` and Read
  the file.
- Write any script that contains regexes or Windows paths with the Write tool, never a heredoc.
- On a low-RAM machine run at most 4 subagents at once.

## Steps

1. **Batch folder.** `B=tools/song-curation/batches/<YYYY-MM-DD>`, `mkdir -p $B/_dumps`. Copy the request
   list to `$B/_dumps/requests.txt`, one `title — artist` per line (a ` - ` separator also works). Convert
   other formats (chat paste, Spotify CSV) to that first.
2. **Catalog snapshot (read-only):** from the repo root,
   `supabase db query --linked "select s.id, s.title, s.artist, s.youtube_id, s.release_year, s.start_time, coalesce(string_agg(g.slug, ';' order by g.slug),'') as genres from songs s left join song_genres sg on sg.song_id=s.id left join genres g on g.id=sg.genre_id group by s.id order by s.artist, s.title" > $B/_dumps/catalog_raw.json`
3. **Parse + dedup** (from `$B`, as are all the script steps): `python ../../requests/parse_requests.py _dumps/requests.txt`.
   Read `report.txt`: requests already in the catalog, repeats inside the list, same title by another
   artist, and requests credited to an excluded artist (tagged; research checks who really sings them).
4. **Packets:** `python ../../requests/make_packets.py 3` (about 45 songs each; also writes `AGENT_GUIDE.md`).
5. **YouTube gateway, started DETACHED** so a low-RAM reaper can't kill it:
   - Windows (PowerShell tool): `$env:PYTHONUTF8='1'; Start-Process -FilePath <python> -ArgumentList "../../requests/ytproxy.py","wanted.json","--port","8791" -WorkingDirectory <abs $B> -WindowStyle Hidden -RedirectStandardOutput <abs $B>\proxy.log -RedirectStandardError <abs $B>\proxy.err`
   - macOS/Linux: `cd $B && PYTHONUTF8=1 nohup <python> ../../requests/ytproxy.py wanted.json --port 8791 > proxy.log 2>&1 &`
   - Check it with `python ../../requests/yt.py status`. Stop it by port 8791 when the research is done.
6. **Research agents:** one background `general-purpose` agent per packet, `model: "opus"`, all launched
   in one message, with this prompt: "Read `<abs $B>/AGENT_GUIDE.md` and follow it exactly. Your packet:
   `packets/pN.json`. Write `research/pN.json`, rewriting it every ~8 songs. Other agents share the
   YouTube gateway: only use yt.py, one call at a time. Never touch git, the database, or files outside
   research/pN.json and _dumps/pN_*.txt. Reply briefly: counts, unsure songs, surprises."
7. **Maybe-meant:** agents put "the player may have meant X" guesses in `maybe_meant`. If one only
   mentions such a guess in notes or flags (with a verified id), add the field to that research row
   yourself, so it becomes its own card.
8. **Finalize:** `python ../../requests/finalize.py --title "Player requests — <Month YYYY>"`, then read
   `finalize_report.txt` (skips, drops, excluded artists) and `already_in_catalog.txt`.
9. **Eyeball pass (mandatory):** dump `line | title — artist [year; genres; conf] || YT title || channel
   badge views upload` for every card into `_dumps/table.txt` and read all of it. Look for:
   - a channel or title that doesn't match the performer or the song;
   - a cover, tribute or live upload where a studio version exists;
   - one artist tagged with inconsistent genres.
   Fix the research JSON and re-run finalize.
10. **Open the review:** from `tools/song-curation`, start `review_server.py batches/<date> --port 8760`
    detached (same pattern as step 5) and give the user **`http://localhost:8760/`**:
    - Not `127.0.0.1`: YouTube refuses some label videos there.
    - Not a double-clicked file: YouTube error 153, nothing plays.
    - Decisions save to `$B/decisions.json` and to browser storage.
    - Check it loads and plays WITHOUT approving or rejecting anything (every click is saved to the
      user's review).
11. **Report:** counts, what's already in the game, guesses and maybe-meant cards, and any artist with an
    "earlier cards were never approved" flag (ask the user about it; don't assume).
12. **After the review** (the user says they're done; their export is `$B/approved-songs-<date>.csv`,
    with `release_year`):
    - Validate the CSV with the real importer: `cd backend && python -c "from app.services.csv_import import parse_csv; print(len(parse_csv(open('<abs csv>','rb').read())))"`.
    - Generate: `python ../../requests/gen_upload.py approved-songs-<date>.csv` → `upload_<date>.sql` + `verify_<date>.sql`.
    - Check every genre slug in the CSV exists in prod: `select slug, name from genres`. The page's
      chip labels differ from the stored slugs ("Israeli Rap" = `israeli-rap-hip-hop`).
    - Read-only precheck: none of the ids are already in `songs`, and `active_games` has no live games.
    - **Apply only after the user explicitly says to upload:**
      `supabase db query --linked -f <abs path to upload_<date>.sql>`.
    - Verify: `supabase db query --linked -f <abs verify_<date>.sql> > _dumps/verify_result.json`, then
      `python ../../requests/gen_upload.py approved-songs-<date>.csv --check _dumps/verify_result.json`.
      It must print `mismatches 0` and every id must be present.
    - Branch `docs/changelog-<date>-song-requests`, add a `### Added` line to `CHANGELOG.md`, and open a
      PR (one-line commit messages, no AI attribution). Merge only when the user says so.
    - If they rejected every card of some artist, ask whether to add that artist to `excluded_artists.txt`.

## Rules that matter

- Never write a YouTube id that didn't come from yt.py output. Every id is verified: status OK,
  embeddable, playable in Israel.
- About 1 in 8 requests names the wrong performer: trust the title, fix the artist, and flag it.
- Excluded artists live in `tools/song-curation/requests/excluded_artists.txt`. They are filtered on the
  researched artist, never only on the name the player wrote.
- Unapproved cards = rejected. Don't re-offer them silently; `finalize.py` flags re-offers.
- Cards keep `start_time = 0`. The heat strip and `suggested_start` are only hints: the maintainer's
  start times are not where YouTube's "most replayed" peak is.
