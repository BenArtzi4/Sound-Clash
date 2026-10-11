# Sound Clash — song-request research agent guide

Sound Clash is a live music-trivia buzzer game for an Israeli audience. A host
plays a song from YouTube; teams buzz and must name the **song title** and the
**artist**. Players sent the maintainer a list of songs they want added. Your
job: research every song in your packet so the maintainer can review them on a
review page and approve with one click. **You never write to any database and
never touch git.** You only write your results file.

Working directory (run every command from here): `{BATCH_DIR}`
Tools folder: `{TOOLS}`
Python: the repo's `backend/.venv/Scripts/python.exe` — always `PYTHONUTF8=1`.
Network commands need the Bash tool's `dangerouslyDisableSandbox: true`.
Hebrew printed to the Bash console can come out garbled: redirect tool output to a
file under `_dumps/` (e.g. `_dumps/<your packet>_tmp.txt`) and read it with the Read tool.

## Input: `packets/<pN>.json`

One object per requested song: `req` (line number in the request list), `title`,
`artist` (as the player typed it — may be misspelled, may credit the wrong
performer, may be an informal name), `same_title_in_catalog` (catalog songs with
the same title by another artist, if any), `catalog_same_artist` (every catalog
song by an overlapping artist: `title | artist | youtube_id | year | genres`).

## Tools

- **YouTube — ONLY through the local gateway** (paced + cached, shared by several
  agents; never fetch youtube.com any other way):
  - `python {TOOLS}/yt.py search "<artist> <song>" -n 8` → `id | views | m:ss | channel [badge] | title | age`
  - `python {TOOLS}/yt.py info <id> [<id> ...]` → status / embed / IL, views, length, upload date, channel [badge], title, YouTube's own Music credits (song / artist / album — very reliable)
  - A background sweep already searched `"<artist> <title>"` for every song and fetched info for the top 4 hits, so those calls return instantly from cache. Extra searches cost ~1.5 s each; batch `info` ids in one call. Budget ≈ 100 new gateway requests for your packet.
- **Catalog lookup:** `python {TOOLS}/catalog.py <text> [<text> ...]` — searches the live-catalog snapshot by title/artist substring. Use it to check for spelling variants and English titles before calling a song new.
- **WebSearch / WebFetch** for release years, canonical spellings, original performers: he.wikipedia.org, shironet.mako.co.il (שירונט), mooma, Spotify/Apple Music pages, ynet/mako/maariv articles, discogs. `*-fanon.fandom.com` is fiction — ignore it.

## Hard rules

1. **Never write a YouTube id you did not get from `yt.py` output in this session.** Never recall ids from memory.
2. **Every id you output (main + alternatives) must be checked with `yt.py info`:** `status=OK`, `embed=True`, `IL` not `False`. Otherwise drop it.
3. **Check the performer and the song.** The commonest past failure is picking a different artist's cover, a tribute/TV-show performance, or a *different* song with the same title by the same artist. The chosen video's channel/title/Music credits must match the right performer AND the right song.
4. **Already in the catalog?** Check `catalog_same_artist`, `same_title_in_catalog`, and `catalog.py` (try the main title word, English/Latin spelling, and the artist). If the catalog already has this song (same performer — even under a different spelling or an extra featured artist), mark it `in_catalog`. A different performer's version of the same song is NOT a duplicate (it can be a legit cover), but say so in a flag.
5. Do not fabricate. If you can't find a reliable year, give your best estimate with `confidence: "low"` and say so in `notes`.

## What to decide for each song

**Identity.** The real song the player meant, its official title, and its real performer(s). Players often credit only the best-known name, credit the wrong singer, or misspell. In the October 2026 batch about 1 request in 8 named a performer who has no song by that title: trust the TITLE first, find who actually sings it, fix the artist and add a warn flag ("Player credited X; the song is by Y"). Record what you changed in `notes`.

**Maybe-meant songs.** If the request resolves to a song the catalog already has (or to nothing) but there is a clearly plausible, popular, NOT-yet-in-catalog song the player may have meant (e.g. requested 'תותים' → catalog has Ethnix's; Hanan Ben Ari's 'החיים שלנו תותים' is missing), add it as `maybe_meant` (`{title, artist, youtube_id, release_year, genres, why}`, id verified like any other). It becomes its own low-confidence card.
- `title`: as the artist/label officially writes it. Hebrew songs in Hebrew script; English-language songs (e.g. Eurovision entries) in English. Straight quotes `'` `"` only (not ׳ ״).
- `artist`: catalog style — `Main Artist` / `Main ft. Guest` (featured guest) / `A & B` (two equal main artists) / `A, B & C`. Hebrew names in Hebrew, spelled the way the catalog already spells that artist (look at `catalog_same_artist`, e.g. `סטטיק ובן אל תבורי`, `הפרויקט של עידן רייכל`).

**Status.** `new` (net-new, recommend adding) · `in_catalog` (already there — give `catalog_match` = the catalog youtube_id) · `skip` (can't find a playable official upload, it's a medley, or not a real song — explain in `notes`).

**Video (`youtube_id`).** The maintainer's rule: *the most-viewed official upload of the recognisable studio recording* — the official music video OR official audio (artist channel, VEVO, label channel, or "- Topic" auto-channel), whichever has the most views. Israeli labels/official sources include התו השמיני, הד ארצי/Hed Arzi, NMC, Helicon, Anana, Tedy Productions, Mizrahi Music/מזרחית, Unicell, Lirit, "Galgalatz"/Kan archive for old songs. Avoid live, lyric videos, karaoke, covers, sped-up/remix, fan uploads, compilations — unless no official studio upload exists (then say so in notes). Classic pre-2000 songs often exist only as TV-archive clips or label uploads — the original recording with decent views is fine.

**Alternatives (0–2).** Other verified uploads the maintainer may prefer: e.g. the official audio vs the clip, a famous live/TV version, a bigger re-upload. Each with a short `why`.

**Release year.** The year the song was first released (single or album). For a song whose official video is from 2008+, the YouTube upload date is usually close — cross-check with one web source when it matters. For pre-2010 songs the upload date is meaningless; use he.wikipedia / shironet / the album year. If the requested performer recorded a **cover** of an older song, use the cover's recording year and say whose song it originally was in `notes` + add `israeli-cover` to genres. Record where the year came from in `year_source` (a URL or "official video upload date").

**Genres** (1–2 slugs from: `rock, pop, hip-hop, electronic, soundtracks, israeli-pop, israeli-cover, israeli-rock-pop, israeli-rap-hip-hop, mizrahit, israeli-soundtracks`). Be consistent with how the catalog already tags the same artist (`catalog_same_artist`), unless this song clearly differs. Rough guide: Moshe Peretz / Peer Tasi / Sarit Hadad / Itay Levi / Dudu Aharon / Eden Ben Zaken / Osher Cohen → `mizrahit` (some crossover hits also `israeli-pop`); Noa Kirel / Anna Zak / Static & Ben El / Agam Buhbut / Eden Hason / Ishay Ribo / Idan Amedi / Hanan Ben Ari → `israeli-pop`; Aviv Geffen / Ivri Lider / Rami Kleinstein / Yehuda Poliker / Arik Einstein → `israeli-rock-pop` (Poliker's Greek-influenced songs can also be `mizrahit`). `israeli-rap-hip-hop` only for actual rap.

**Flags** — anything the reviewer should look at: "Catalog has 'X — Y' (different song)", "Player credited X; the song is by Y", "Cover of …", "Only a live upload exists", "Low views (12K)", "Two different songs share this title — picked the one by …".

## Output

Write a JSON array to `research/<pN>.json` (create the folder if needed). Rewrite the
whole file every ~8 songs so work isn't lost. One object per packet song, same order:

```json
{
  "req": 1,
  "status": "new",
  "title": "Unicorn",
  "artist": "נועה קירל",
  "youtube_id": "<11 chars from yt.py, verified>",
  "alternatives": [{"youtube_id": "<verified>", "why": "Eurovision 2023 grand-final live, 20M views"}],
  "release_year": 2023,
  "year_source": "https://he.wikipedia.org/wiki/...",
  "genres": ["israeli-pop"],
  "confidence": "high",
  "notes": "Requested as 'יוניקורן'; official title is the English 'Unicorn' (Eurovision 2023).",
  "flags": [{"level": "info", "text": "Song is in English"}],
  "catalog_match": null,
  "maybe_meant": null
}
```

`confidence`: `high` = identity, video and year all solid; `medium` = one of them is a judgement call; `low` = shaky. For `in_catalog`, fill `catalog_match` and `notes`; the other fields can be null. For `skip`, explain in `notes`.

When done, reply with: counts by status, the songs you were unsure about (one line each), and anything surprising. Keep the reply short — the details live in your file.
