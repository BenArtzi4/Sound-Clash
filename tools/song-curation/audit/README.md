# Catalog audit → review page → guarded apply

Goes over the songs already in the game and proposes fixes: dead or blocked
videos, a better (official, bigger, right-recording) video, duplicates, wrong or
misspelled titles and artists, missing or wrong genres and years, style. The
maintainer approves or rejects every card on a local review page; approved cards
become one all-or-nothing SQL file. First run: the 2026-10-09 audit (1,521 songs,
821 cards, 773 approved: 65 duplicates deleted, 261 new videos, 337 name fixes).

All scripts run **from the audit's batch folder** (`tools/song-curation/batches/
<date>-audit/`, git-ignored) and read and write their data there. This folder only
holds code; nothing here connects to a database. The step-by-step version,
including the prod queries and the apply, is the `audit-songs` skill
(`.claude/skills/audit-songs/SKILL.md`).

| file | what it does |
| --- | --- |
| `snapshot.py` | prod dumps in `_dumps/` → `catalog.json`, `plays.json`, `genres.json`; `--compare <fresh dump>` lists every change since the snapshot. |
| `../requests/ytproxy.py catalog.json --prefetch 0` | the shared paced YouTube gateway: watch page of every current video (`meta/`) and one search per song (`search/`). ~1.5 s per request, so about 80 minutes for 1,600 songs. |
| `scan.py [--all]` | mechanical cards (`items_scan.json`) + agent packets + `AGENT_GUIDE.md`. Agents get the songs added since the newest earlier audit plus must-fix songs; `--all` sends everything. |
| `AGENT_GUIDE.template.md` | the research agents' rules, input and output format (rendered by `scan.py`). |
| `merge.py` | scan cards + `proposals/*.json` → `items.json`; verifies every proposed video, warns on wrong performers, resolves overlaps, drops year changes on `israeli-cover` songs, anything an earlier audit already rejected, and any card id listed in `drop_items.txt`. |
| `videos.py` | every video-changing card, current vs proposed, into `_dumps/videos.txt` for the mandatory eyeball pass. |
| `simulate.py` | approve-everything dry run in `sim/` (one card per "approve only one" pair): proves the SQL builds. |
| `server.py` + `review.html/js/css` | the review page; decisions go to the batch's `decisions.json`. |
| `make_sql.py` | approved decisions → `apply.sql`, `apply_dryrun.sql` (ends in a rollback sentinel), `apply_plan.json`. |
| `preflight.py <fresh dump>` | pre-apply checks: the songs in the plan are unchanged on prod, playable videos, starts inside videos, genres; writes `playtest_plan.json` to play-test the new videos before applying. |
| `validate.py <dump after apply>` | every approved card live exactly as decided, nothing else changed; writes `playtest_songs.json`. |
| `picker_check.sql` | zero-persistence prod check: a throwaway all-genres game draws through the real picker until it runs out, then rolls back. |
| `../playtest/playtest.mjs` | plays every new video in the game's own embed setup. |

Earlier audits are found automatically: any sibling batch folder with
`items.json` + `decisions.json` (except `_*` and `zz*` test folders, so never leave
a test batch with a top-level `decisions.json` under another name). A card left
undecided there counts as rejected (the maintainer's rule), so its value, its
videos and its kept duplicate groups are not offered again, and agents see them as
`rejected_before`; fields an approved card set are `settled`. Songs created after
the newest earlier audit's `snapshot.json` time are "new". Batch folders are
git-ignored: on a new computer, copy the old `*-audit` folders over first.
