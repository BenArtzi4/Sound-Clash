---
name: add-songs
description: Use when new songs should be added to the Sound Clash catalog from any source - a list players or the maintainer sent ("title — artist" lines, a .txt, a chat paste, a CSV), "song requests", "add these songs", more songs by given artists, a year's or genre's hits, a Spotify or YouTube playlist - or when repeating the October 2026 request batch. Not for fixing songs already in the game (that is audit-songs).
---

# Add songs → researched review batch → upload

Proven on 2026-10-11: 198 player requests → 75 already in the game → 133 researched by 3
parallel agents in ~17 min (zero YouTube 429s) → 124 verified cards → 93 approved and uploaded;
the same day a five-artists wish-list gave 117 cards → 63 uploaded (catalog 1456 → 1612).
Code: `tools/song-curation/requests/` (read its `README.md` once). Review page:
`tools/song-curation/review.html` + `review_server.py`. Playback test: `tools/song-curation/playtest/`.

- `$B` = the batch folder `tools/song-curation/batches/<YYYY-MM-DD>[-<topic>]` (git-ignored). All script
  steps run from `$B`; `supabase` commands run from the repo root (it holds the project link).
- `$P` = the ABSOLUTE path of the backend venv's python, run with `PYTHONUTF8=1` set and never with
  `-I` (it drops PYTHONUTF8 and Hebrew turns into `?`). A bare `python` can be the Windows Store stub.

## One-time setup on a new computer

- **Python 3.10+.** The scripts are stdlib-only; the repo's backend venv is fine:
  Windows `backend\.venv\Scripts\python.exe`, macOS/Linux `backend/.venv/bin/python`
  (create it with `cd backend && python -m venv .venv && .venv/.../pip install -e ".[dev]"`).
- **Supabase CLI** linked to the production project, run once from the repo root:
  `supabase login`, then `supabase link --project-ref <prod project ref>`. The ref and the database
  password are with the maintainer's credentials and are never in the repo. Check it works with
  `supabase db query --linked "select count(*) from songs"`.
- **`gh`** logged in (for the CHANGELOG PR). **Playwright** for the playback test:
  `cd tests/e2e && npm ci && npx playwright install chromium`.
- **Private exclusion list:** copy the maintainer's list to `.claude/curation-exclusions.txt` (one artist
  per line). It's git-ignored and kept with the credentials, never committed. Ask the maintainer for it
  if it's missing; without it nothing is excluded.
- **Batch folders are git-ignored**, so past batches don't come with a clone. That weakens the
  "offered before and never approved" checks (`--drop-offered`, `finalize.py`): copy the old batch
  folders over if you can.

Session conventions:
- Network commands need `dangerouslyDisableSandbox: true`.
- Hebrew printed to the Bash console can come out garbled: redirect output into `$B/_dumps/` and Read
  the file.
- Write any script that contains regexes or Windows paths with the Write tool, never a heredoc.
- At most 4 subagents at once, all `model: "opus"`.

## Step 0: turn the source into a wanted list

Everything below works on `$B/_dumps/requests.txt`, one `title — artist` per line (` - ` also works).
Build it from the source, and keep a note of where each line came from:

| Source | How to build the list |
| --- | --- |
| Player / maintainer list (chat, .txt, CSV) | Convert as is. Don't fix names yet: research does that (about 1 in 8 requests names the wrong performer). |
| "More songs by artist X" | From data, never from memory (a recalled "hit" once turned out not to be the artist's song). Start the gateway with no rows file (step 5's command without `wanted.json`), then `$P ../../requests/yt.py search "<artist>" --views -n 20` (most viewed first; one page per query, so also try "<artist> Topic", album names, the Latin spelling). International: also Wikipedia singles discographies and charts; Israeli: also he.wikipedia. Beatles-style catalogues: query `"<Title> (Remastered 2009) <Album> <Artist> Topic"`. Aim for about twice what the maintainer asked for: they reject about half. |
| "Hits of year Y" / a genre | Charts decide which songs: the Wikipedia chart pages and `hitlist.mako.co.il/annual/<year>` listed in `.claude/rules/lessons/song-curation.md`, and PLAYBOOK §6. Chart year ≠ release year. |
| Spotify playlist export (CSV) | Track name + first artist per line. Album dates are often a remaster or compilation: research the original year. |
| YouTube playlist or links | Read the `watch?v=…&list=…` page's `playlistPanelVideoRenderer` entries (the bare `playlist?list=` page can render 0 rows); research names from each video's title and channel. |

Unapproved = rejected. For a list YOU built (artists, charts, playlists) add `--drop-offered` in
step 3, so songs an earlier batch offered and the maintainer didn't approve are dropped before any
research. For a list players sent, leave it off: `finalize.py` flags re-requested songs ("offered
before and not approved") and you ask the maintainer.

## Steps

1. **Batch folder.** `mkdir -p $B/_dumps`, write `$B/_dumps/requests.txt` (step 0).
2. **Catalog snapshot (read-only):** from the repo root,
   `supabase db query --linked "select s.id, s.title, s.artist, s.youtube_id, s.release_year, s.start_time, s.unavailable_at, coalesce(string_agg(g.slug, ';' order by g.slug),'') as genres from songs s left join song_genres sg on sg.song_id=s.id left join genres g on g.id=sg.genre_id group by s.id order by s.artist, s.title" > $B/_dumps/catalog_raw.json 2>/dev/null`
   (if a later step can't parse it, rerun without `2>/dev/null` to see the CLI's error).
3. **Parse + dedup:** `$P ../../requests/parse_requests.py _dumps/requests.txt [--drop-offered]`. Read
   `report.txt`: requests already in the game (a match whose video is flagged dead says so: that's an
   audit-songs fix, not a new song), repeats inside the list, same title by another artist, songs
   dropped as rejected before, and requests credited to an excluded artist (tagged; research checks
   who really sings them).
4. **Packets:** `$P ../../requests/make_packets.py <n>`, n = songs ÷ 45 rounded up, at most 4 (it keeps
   each artist in one packet and writes `AGENT_GUIDE.md`).
5. **YouTube gateway, started DETACHED** so a low-RAM reaper can't kill it (keep it running until the
   eyeball pass in step 9 is done: `finalize.py` asks it about any video it hasn't cached):
   - Windows (PowerShell tool): `$env:PYTHONUTF8='1'; Start-Process -FilePath <abs python> -ArgumentList "../../requests/ytproxy.py","wanted.json","--port","8791" -WorkingDirectory <abs $B> -WindowStyle Hidden -RedirectStandardOutput <abs $B>\proxy.log -RedirectStandardError <abs $B>\proxy.err`
   - macOS/Linux: `cd $B && PYTHONUTF8=1 nohup <python> ../../requests/ytproxy.py wanted.json --port 8791 > proxy.log 2>&1 &`
   - If it already runs from step 0, stop it by port and restart it with `wanted.json`: the cache survives.
   - `$P ../../requests/yt.py status` says `'finished': True` once its background sweep is done.
6. **Research agents:** one background `general-purpose` agent per packet, `model: "opus"`, launched
   together, with this prompt: "Read `<abs $B>/AGENT_GUIDE.md` and follow it exactly. Your packet:
   `packets/pN.json`. Write `research/pN.json`, rewriting it every ~8 songs. Other agents share the
   YouTube gateway: only use yt.py, one call at a time. Never touch git, the database, or files outside
   research/pN.json and _dumps/pN_*.txt. Reply briefly: counts, unsure songs, surprises." For an artist
   wish-list add: "This packet is an artist wish-list: a song that turns out not to be that artist's is
   a skip, not a re-credit."
7. **Maybe-meant:** agents put "the player may have meant X" guesses in `maybe_meant`. If one only
   mentions such a guess in notes or flags (with a verified id), add the field to that research row
   yourself, so it becomes its own card.
8. **Finalize:** `$P ../../requests/finalize.py --title "<what this batch is> — <Month YYYY>"`, then read
   `finalize_report.txt` (skips, drops, excluded artists) and `already_in_catalog.txt`.
9. **Eyeball pass (mandatory):** `$P ../../requests/table.py`, then read all of `_dumps/table.txt`. Look for:
   - a channel or title that doesn't match the performer or the song;
   - a cover, tribute or live upload where a studio version exists;
   - one artist tagged with inconsistent genres.
   Fix the research JSON and re-run finalize. Then stop the gateway (port 8791).
10. **Open the review:** from `tools/song-curation`, start `review_server.py batches/<folder> --port 8760`
    detached (same pattern as step 5) and give the user **`http://localhost:8760/`**:
    - Not `127.0.0.1`: YouTube refuses some label videos there.
    - Not a double-clicked file: YouTube error 153, nothing plays.
    - Decisions save to `$B/decisions.json` and to browser storage.
    - Check it loads and plays WITHOUT approving or rejecting anything (every click is saved to the
      user's review).
11. **Report:** counts, what's already in the game, guesses and maybe-meant cards, and any artist with an
    "earlier cards were never approved" flag (ask the user about it; don't assume).
12. **After the review** (the user says they're done). Their export is `$B/approved-songs-<batch folder>.csv`
    (with `release_year`); if they only clicked, `$P ../../requests/decisions_to_csv.py` writes the
    identical file from `decisions.json`.
    - Validate it with the real importer, from `backend/`: `<abs python> -c "from app.services.csv_import import parse_csv; print(len(parse_csv(open('<abs csv>','rb').read())))"`.
    - Generate: `$P ../../requests/gen_upload.py approved-songs-<batch folder>.csv` → `upload_<batch>.sql`,
      `verify_<batch>.sql`, `playtest_songs.json`.
    - Read-only prechecks: `select slug, name from genres` has every slug in the CSV (the page's chip
      labels differ from the slugs: "Israeli Rap" = `israeli-rap-hip-hop`), and
      `select youtube_id from songs where youtube_id in (<the CSV's ids>)` returns no rows. Live games
      don't block an insert: new songs only join future picks.
    - **Apply only after the user explicitly says to upload:**
      `supabase db query --linked -f "<abs $B>/upload_<batch>.sql"` (absolute `C:/...` path).
    - Verify: `supabase db query --linked -f "<abs $B>/verify_<batch>.sql" > <abs $B>/_dumps/verify_result.json`,
      then from `$B`: `$P ../../requests/gen_upload.py approved-songs-<batch folder>.csv --check _dumps/verify_result.json`.
      It must print `mismatches 0` and every id must be present.
    - Picker: `supabase db query --linked -f "<abs repo>/tools/song-curation/audit/picker_check.sql"` must
      return `SELFCHECK_DONE_ROLLBACK ... not_served=0` (every playable song can come up in a game), then
      `select count(*) from active_games where game_code='ZZAUD1'` must be 0.
    - Playback: `node tools/song-curation/playtest/playtest.mjs <abs $B>/playtest_songs.json` from the repo
      root. It plays every new song in a copy of the game's embed setup (`YouTubePlayer.tsx`) on
      localhost; all must play (rerun failures once).
    - Optional, for soundtrack rounds or unusual songs: a short live game on www forcing a few new songs
      with `select_next_song(..., p_song_id)` (`.claude/rules/lessons/song-curation.md`, Uploading).
    - Branch `feature/songs-<date>` off `origin/main`, add a `### Added` line to `CHANGELOG.md`, and open
      a PR (one-line commit messages, no AI attribution). Merge only when the user says so.
    - If they rejected every card of some artist, ask whether to add that artist to the private
      `.claude/curation-exclusions.txt` (never to a committed file — the repo is public).
    - Update the song-curation memory with the new catalog size.

## Rules that matter

- Never write a YouTube id that didn't come from yt.py output. Every id is verified: status OK,
  embeddable, playable in Israel.
- About 1 in 8 player requests names the wrong performer: trust the title, fix the artist, and flag it.
  (Artist wish-lists are the exception: the artist is the point, so a wrong-artist song is skipped.)
- Excluded artists live only in the private `.claude/curation-exclusions.txt`. Never name them in a
  committed file, commit message or PR description (the repo is public). They are filtered on the
  researched artist, never only on the name the player wrote.
- Unapproved cards = rejected. Don't re-offer them silently: `--drop-offered` for our own lists,
  `finalize.py`'s flag for player lists.
- Cards keep `start_time = 0`. The heat strip and `suggested_start` are only hints: the maintainer's
  start times are not where YouTube's "most replayed" peak is.
- Style the catalog uses: guests "A ft. B", co-leads "A & B", one spelling per artist (match the
  catalog's existing spelling), soundtracks with `artist` = the work's name and `title` = the song.
