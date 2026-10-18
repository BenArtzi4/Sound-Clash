---
name: audit-songs
description: Use when the maintainer wants the songs ALREADY in the Sound Clash catalog checked or cleaned up - "go over all the songs", better or official YouTube versions, dead, private or blocked videos, duplicate songs, wrong or misspelled titles or artists, wrong genres or years, generic soundtrack titles, or repeating the October 2026 catalog audit. Not for adding new songs (that is add-songs).
---

# Audit the song catalog → review page → guarded apply

Proven on 2026-10-09/11: 1,521 songs → 821 cards → 773 approved → 65 duplicates deleted, 261 new
videos, 337 name fixes, 58 genre and 23 year fixes, all verified on prod. Code:
`tools/song-curation/audit/` (read its `README.md` once). Shared YouTube gateway:
`tools/song-curation/requests/`. Playback test: `tools/song-curation/playtest/`.

**Nothing touches prod until the maintainer has reviewed the cards and explicitly says to apply.**
Every step before that is read-only on prod.

- `$B` = the batch folder `tools/song-curation/batches/<YYYY-MM-DD>-audit` (git-ignored). All script
  steps run from `$B`; `supabase` commands run from the repo root (it holds the project link).
- `$P` = the ABSOLUTE path of the backend venv's python (Windows:
  `C:/Users/<you>/GBA/Sound-Clash/backend/.venv/Scripts/python.exe`), run with `PYTHONUTF8=1` set and
  never with `-I`. A bare `python` can be the Windows Store stub.
- One-time setup on a new computer (venv, Supabase CLI link, `gh`, Playwright): the `add-songs`
  skill. Batch folders don't come with a clone: copy the old `*-audit` folders over first, or
  everything the maintainer rejected in earlier audits is offered again (`snapshot.py` warns).

## Session conventions

- Network commands (`supabase`, the gateway, the playtest) need `dangerouslyDisableSandbox: true`.
- Hebrew printed to the console comes out garbled: redirect output into `$B/_dumps/` and Read the file.
- Any script with a regex or a Windows path goes through the Write tool, never a heredoc.
- Long-lived processes (gateway, review server) start **detached**, or Claude Code's low-RAM reaper
  kills them. PowerShell: `$env:PYTHONUTF8='1'; Start-Process -FilePath <abs python> -ArgumentList
  <script>,<args...> -WorkingDirectory <abs $B> -WindowStyle Hidden -RedirectStandardOutput <abs $B>\x.log
  -RedirectStandardError <abs $B>\x.err -PassThru`. Stop by port: `Get-NetTCPConnection -LocalPort <p>
  -State Listen | Select -ExpandProperty OwningProcess -Unique | ForEach { Stop-Process -Id $_ -Force -Confirm:$false }`.
- At most 4 subagents at once, all `model: "opus"`, launched in the background.

## Steps

1. **Scope.** The mechanical checks (dead or blocked videos, duplicates, much bigger official
   uploads, style) always cover the whole catalog. Research agents get the songs added since the
   newest earlier audit plus every song with a must-fix flag, because the maintainer already reviewed
   the rest; `scan.py --all` sends every song to the agents (a full re-audit, about 9 agents and
   several hours). "Go over all the songs" = the default; tell the maintainer that, and that `--all`
   exists if they want the old songs researched again.
2. **Batch folder + read-only dumps**, from the repo root (`mkdir -p $B/_dumps` first):
   ```
   supabase db query --linked "select s.id, s.youtube_id, s.title, s.artist, s.start_time, s.release_year, s.unavailable_at, s.created_at, coalesce(string_agg(g.slug, ';' order by g.slug), '') as genres from songs s left join song_genres sg on sg.song_id=s.id left join genres g on g.id=sg.genre_id group by s.id order by s.created_at" > $B/_dumps/catalog_raw.json 2>/dev/null
   supabase db query --linked "select youtube_id, count(*) as plays from game_history_songs group by youtube_id" > $B/_dumps/plays_raw.json 2>/dev/null
   supabase db query --linked "select slug from genres order by slug" > $B/_dumps/genres_raw.json 2>/dev/null
   ```
   Then, from `$B`: `$P ../../audit/snapshot.py > _dumps/snapshot.txt` and read it (catalog size, gaps,
   earlier audits found, songs new since then). A crash here usually means a dump is empty: rerun
   that query without `2>/dev/null` to see the error.
3. **Gateway, detached:** `../../requests/ytproxy.py catalog.json --port 8791 --prefetch 0` (cwd `$B`).
   Every current video's watch page, then one search per song, one request per 1.5 s, 90 s back-off
   on HTTP 429: about 40 min + 40 min for 1,600 songs. It's done when `$P ../../requests/yt.py status`
   says `'finished': True` (`queued: 0` alone is not done); then check its `errors` count. A restart
   resumes from the cache.
4. **First scan** once `ls meta | wc -l` reaches the catalog size: `$P ../../audit/scan.py [--all]`,
   read `scan_report.txt`. It writes the scan's own cards, the agent packets (`packets/*.json`,
   `packets/names_*.tsv`) and `AGENT_GUIDE.md`.
5. **Research agents.** Start the names agent first; the song agents can start right after (they read
   `proposals/names.json` if it exists by then). One agent per packet, at most 4 running. Prompt:
   "Read `<abs $B>/AGENT_GUIDE.md` and follow it exactly. You are the `<name>` agent. Your input:
   `packets/<name>.json` (names agent: `packets/names_catalog.tsv`, `packets/names_artists.tsv`,
   `artist_variants.json`). Write `proposals/<name>.json`, rewriting it every ~10 proposals. Other
   agents share the YouTube gateway: use only yt.py, one call at a time. Never touch git, the database,
   or files outside your proposals file and `_dumps/<name>_*`. Reply briefly: counts by kind, judgment
   calls, surprises." Relay each report's judgment calls to the maintainer as they arrive.
6. **Second scan + merge** when the gateway is finished and every agent is done (re-running `scan.py`
   rewrites the packets, so never while agents work): `scan.py`, then `$P ../../audit/merge.py`; read
   `merge_log.txt` (dropped videos, invalid genres, what an earlier audit already settled).
7. **Eyeball pass (mandatory):** `$P ../../audit/videos.py`, then read all of `_dumps/videos.txt`. The
   commonest failure is the wrong performer: a cover or tribute, or the right artist's other song.
   Fix the agent's proposal file, or put the card id in `drop_items.txt` (survives re-scans), and
   re-run `merge.py`.
8. **Dry run:** `$P ../../audit/simulate.py` approves every card in `sim/` (one per "approve only one"
   pair) and must build the SQL with no PROBLEMS; a problem there needs a fix in the cards first.
9. **Open the review**, detached, from `$B`: `../../audit/server.py --port 8770`. Check
   `curl -s http://localhost:8770/api/items` returns the cards, then give the maintainer
   **`http://localhost:8770/`** (not `127.0.0.1`: YouTube refuses some label videos there; never
   `file://`). Never approve or reject anything yourself: every click lands in their review.
   Suggested order for them: "Must-fix only" → Broken video → Duplicate → Title / artist (pairs
   marked "⚠ approve only one") → Better video (play the new one; set the start with ⏱ when the card
   says the length differs) → Genre / year → Possible duplicate (reject = keep both) → Style (bulk
   approve) → "Summary of approved". Clicks save to `$B/decisions.json`. If the top bar says
   "Server not reachable — … kept in this browser, retrying", the server died: restart it detached;
   the page replays the queued clicks. A reboot stops it too, so also give them the restart they can
   run in their own PowerShell window: `cd <abs $B>; & <abs python> ..\..\audit\server.py --port 8770`.
10. **Report and wait.** Stop the gateway (port 8791). Leave the review server running. Report the card
    counts per tab and the judgment calls, and say nothing changes until they say "apply".
11. **Apply, only after the maintainer explicitly says to apply** (from `$B` unless noted):
    - `$P ../../audit/make_sql.py` (it refuses to build while two approved cards conflict).
    - Fresh dump (step 2's catalog query into `$B/_dumps/catalog_now_raw.json`), then
      `$P ../../audit/preflight.py _dumps/catalog_now_raw.json`: PROBLEMS must be 0. A song the plan
      touches that changed on prod since the snapshot is a problem (reject or rebuild that card); songs
      uploaded meanwhile are only a warning. Pass on the "keeps the old start" warnings.
    - Play-test the new videos before writing anything (the cached video data can be days old):
      `node tools/song-curation/playtest/playtest.mjs <abs $B>/playtest_plan.json` from the repo root.
      A video that fails twice: tell the maintainer and reject its card before applying.
    - Live games: `select game_code, round_number, ended_at from active_games where ended_at is null and
      expires_at > now()`. A live game can be another session's harness: watch `round_number` for a
      minute. If real players are mid-game, wait for it to end or ask the maintainer.
    - Dry run on prod (rolls back): `supabase db query --linked -f "<abs $B>/apply_dryrun.sql"` must
      end in `DRYRUN_OK_ROLLBACK`. Then the real one: `supabase db query --linked -f "<abs $B>/apply.sql"`.
      Absolute `C:/...` paths: a relative `-f` resolves against the project root.
    - Dump again into `$B/_dumps/catalog_after_raw.json`; `$P ../../audit/validate.py
      _dumps/catalog_after_raw.json`: mismatches 0, and "changes not explained by a decision" 0 apart
      from the outside changes preflight already warned about.
    - Picker check: `supabase db query --linked -f "<abs repo>/tools/song-curation/audit/picker_check.sql"`
      must return `SELFCHECK_DONE_ROLLBACK ... not_served=0`; then
      `select count(*) from active_games where game_code='ZZAUD1'` must be 0.
    - Playback after the apply: `node tools/song-curation/playtest/playtest.mjs <abs $B>/playtest_songs.json`
      (a copy of the game's embed setup, `YouTubePlayer.tsx`, on localhost). Rerun failures once.
    - Optional, for many or unusual swaps: a short live game on www forcing a few changed songs with
      `select_next_song(..., p_song_id)` (`.claude/rules/lessons/song-curation.md`, Uploading).
12. **Close the loop.** Branch `fix/catalog-audit-<date>` off `origin/main`, a `### Changed` line in
    `CHANGELOG.md` (counts: duplicates removed, videos replaced, names fixed), PR with a one-line
    commit message and no AI attribution; merging is the maintainer's call. Stop the review server.
    Update the song-curation memory with the new catalog size. Tell the maintainer which swapped songs
    kept their old start time (admin songs page to fine-tune).

## Rules that matter

- No prod write before the maintainer says "apply". The dry run counts as part of applying.
- Never write a YouTube id that didn't come from the gateway; every proposed video is checked
  playable, embeddable and allowed in Israel (`merge.py` re-checks, the playtest proves it).
- Unapproved = rejected. `merge.py` drops values, videos and duplicate groups an earlier audit turned
  down, and agents see them as `rejected_before`; don't bring them back by hand.
- Cover years are intentionally mixed (recording year for some reviewed covers): never "fix" them
  (`merge.py` drops year changes on `israeli-cover` songs; the eyeball pass catches the rest).
- Soundtracks: `artist` = the work's name (what teams must answer), `title` = the real song name.
- Style the maintainer approved: guests "A ft. B", co-leads "A & B", one spelling per artist,
  official title casing. The agent guide carries the full list; add new settled calls there.
- Keep the batch folder afterwards: its `items.json`, `decisions.json` and `snapshot.json` are how the
  next audit knows what was settled. Name test folders `zz-*` and delete them.

## Common mistakes

| Mistake | What happens | Instead |
| --- | --- | --- |
| Gateway or server started as a normal background shell | the low-RAM reaper kills it mid-run | `Start-Process ... -WindowStyle Hidden` |
| Several processes calling YouTube, or IPv6 | HTTP 429 / a Google "sorry" block | everything through the one gateway (IPv4, paced) |
| Waiting on `queued: 0` | the scan runs before the searches exist | wait for `'finished': True` |
| Trusting the top search hit or an agent's pick | a cover, tribute or other song goes live | the step 7 eyeball pass over every video card |
| Re-running `scan.py` while agents work | their packets are rewritten under them | scan again only after every agent is done |
| `127.0.0.1` or `file://` for the review page | label videos refuse to play (error 150 / 153) | `http://localhost:<port>/` |
| Applying without preflight + playtest + dry run | a "row changed since review" abort, or a dead video goes live | step 11 in order |
| Clicking cards to "test" the page | the click is saved into the maintainer's review | check `/api/items` with curl only |
