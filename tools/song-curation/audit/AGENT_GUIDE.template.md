# Sound Clash catalog audit: research agent guide

You are auditing part of the song catalog of **Sound Clash**, a live music-trivia
buzzer game (Israeli audience; Hebrew and international songs). A host plays a
song from YouTube; teams buzz and must name the **song title** and the
**artist**. For soundtrack songs (genres `soundtracks` / `israeli-soundtracks`)
teams name the **film or show**, which is stored in `artist`; `title` holds the
song name.

Your job: find real problems in your packet and propose concrete, verified
fixes. The maintainer reviews every proposal on a review page and approves or
rejects it. **You never write to any database and never touch git.** You only
write your proposals file.

- Working directory for everything: `{BATCH_DIR}`
- Python: `{PYTHON}` (written `python` below; a bare `python` can be the Windows
  Store stub). Always set `PYTHONUTF8=1`.
- Network commands need the Bash tool's `dangerouslyDisableSandbox: true`.
- Hebrew printed to the console can come out garbled: write it to a file under
  `_dumps/` and Read the file instead.

## Your input

**Song packets** `packets/<bucket>.json`, one object per song:

- `song_id`, `title`, `artist`, `genres` (`;`-joined slugs), `year`, `start` (seconds),
  `plays` (times played in real games; higher = more important)
- `new`: true when the song was added after the last audit ({SINCE}). New songs
  were never reviewed: check every one of them. Older songs are in your packet
  only because something about them looks broken.
- `settled`: fields an earlier audit already changed with the maintainer's approval
  (`{"artist": "2026-10-09-audit"}`). Don't propose a different value for a settled
  field unless it is objectively broken (dead video, wrong song); say so if you do.
- `rejected_before`: values and videos an earlier audit proposed for this song and the
  maintainer turned down (`{"youtube_id": ["abc..."], "artist": ["..."]}`): they chose to
  keep the current one. Never propose those again, and propose another change to the
  same field only when the current value is objectively broken.
- `yt`: the CURRENT video: `id`, `t` (YouTube title), `ch` (channel), `badge`
  (`artist` = official artist channel, `verified`), `views`, `len` (s), `up` (upload
  date), `status` (`OK` or an error), `embed`, `il` (playable in Israel), `music`
  (YouTube's own Content-ID credits: song / artist / album; very reliable for names)
- `search`: top YouTube results for "artist title" (relevance order; can be empty
  while the background sweep runs, then search yourself)
- `flags`: automatic hints, not verdicts; many are false alarms. Hebrew songs often
  have a Hebrew DB name and an English or transliterated YouTube title; that is fine.

Flag meanings: `broken:*` / `embed-off` / `blocked-IL` (cannot play in the game),
`start-past-end`, `channel:unknown|label?` (current video not obviously from the
artist, label, Topic or VEVO), `video:live|lyrics|cover|karaoke|altered|mix|fan`
(the YouTube title suggests a non-studio or non-official version), `low-views`,
`long` (>10 min: compilation?), `name-mismatch` (DB names not found in the video's
title, channel or credits), `credits-song:<x>` / `credits-artist:<x>` (YouTube's
credits name a different song or artist), `bigger-official:<id>:<views>` (an
official upload with far more views exists), `no-genre`, `no-year`,
`generic-title` (title == artist).

**Names packet** (the names agent only): `packets/names_catalog.tsv` (every song:
song_id, title, artist, genres, year, plays, new, settled fields),
`packets/names_artists.tsv` (every distinct artist string with its song count) and
`artist_variants.json` (variant groups a script found; some are NOT variants, e.g.
"Moana" vs "Moana 2" are different works).

## Tools

- **YouTube, only through the local gateway** (paced and cached; never call YouTube
  any other way, and never run two of these at once):
  - `python {TOOLS}/requests/yt.py search "<artist> <song>" -n 8` →
    `id | views | m:ss | channel [badge] | title | age`
  - `python {TOOLS}/requests/yt.py info <id> [<id> ...]` → status / embed / IL, views,
    length, upload date, channel [badge], title, music credits
  - The gateway is shared by several agents and does about one request per 1.5 s,
    so a call can take a while. Batch `info` ids in one call. Budget: about 120
    gateway requests per packet; spend them on new, flagged and much-played songs.
- `python {TOOLS}/requests/catalog.py <text>`: substring search over the catalog
  snapshot (spelling variants, songs by the same artist). Run it from the working
  directory; it reads `_dumps/catalog_raw.json`.
- **WebSearch / WebFetch** for names, spellings and release years (Wikipedia, Discogs,
  MusicBrainz, Spotify pages; Israeli sources such as he.wikipedia, mooma, shironet).
  `*-fanon.fandom.com` wikis are fiction: ignore them.

## Hard rules

1. **Never write a YouTube id you did not get from `yt.py` output in this session**
   (or that is already in your packet). Never recall ids from memory.
2. **Every new video you propose must be verified with `yt.py info`**: `status=OK`,
   `embed=True`, `IL` not `False`. Drop it otherwise.
3. **Check the performer and the song.** The commonest past failure: a different
   artist's cover or a tribute outranks the real recording, or the right artist's
   OTHER song. The proposed video's channel, title or credits must match the right
   performer and the right song.
4. **Cover years are intentionally mixed** (for covers the maintainer sometimes chose
   the recording year). Never propose year changes for covers or for songs in
   `israeli-cover`. Only propose a year fix for a non-cover when you have solid
   evidence the stored year is wrong by more than 1 year, and cite it.
5. Be conservative and specific. A proposal must be a clear improvement; no
   proposals for marginal differences. Most songs are fine.

## What to look for, and the policy for each

**A. Better video (`kind: "video"`).** The maintainer's rule: *the most-viewed
official upload of the recognisable studio recording*: official music video OR
official audio (artist channel, VEVO, label, or "- Topic" channel), whichever has
the most views.
- Propose a swap when the current video is: a fan or re-upload channel, a lyric
  video, live, cover, karaoke, sped-up, slowed, remix or compilation, very low
  views, a different recording than the famous one (a re-recording such as "Taylor's
  Version", a sound-alike, a demo), or when an official upload of the same studio
  recording has about 3x the views or more.
- Don't swap a working official video for a marginally bigger one. Don't swap to a
  live version, a remix, a re-recording or an extended or clean edit unless the song
  is best known that way.
- Hebrew songs: official sources are the artist's channel, label channels (התו השמיני,
  הד ארצי / Hed Arzi, NMC, Helicon, Anana, Tedy Productions, Mizrahi Music, Unicell)
  and "- Topic". Classic Israeli songs often exist only as TV-archive clips or label
  uploads; the original recording with decent views is fine.
- Give 1-3 verified `candidates` (best first) and say why in `note` ("official MV,
  412M views"). If the new video has a long non-music intro, suggest a `start_time`
  (seconds where the music or hook starts); otherwise omit it. The stored start was
  set for the old video, so mention in the evidence when the length differs a lot.
- `severity`: 3 = current video broken, blocked or the wrong song; 2 = non-official,
  live, lyric or low quality; 1 = just a bigger official upload.

**B. Wrong names (`kind: "name"`).** Wrong or misspelled title or artist, wrong
performer credited, title and artist swapped, the title of a different song, typos
("With Or With Out You" → "With or Without You"). Use YouTube credits, the official
channel and web sources. Hebrew: use the spelling the artist or label uses. Keep
Hebrew songs in Hebrew and international songs in their original language.
`severity` 3 = wrong song or performer, 2 = misspelling, 1 = cosmetic.

**C. Genre / year (`kind: "metadata"`).** Missing genre (always fix), clearly wrong
genre (an Israeli Hebrew song under international `pop`, a hip-hop track under
`rock`, a disco song under `rock`), missing year, clearly wrong year (rule 4!).
Valid genre slugs: {GENRES}. A song may have several genres. `israeli-cover` = an
Israeli artist's cover of someone else's song.

**D. Broken (`kind: "broken"`).** Current video not playable (status not OK, embed
off, blocked in Israel). Find a verified replacement (`candidates`) or, if none
exists, propose `action: "delete"`.

**E. Duplicates (`kind: "duplicate"`).** Only when you notice the same song (same
performer; the same recording or just another upload) appearing twice and the scan
may have missed it: give both `song_id`s in `dup_song_ids` and say which to keep in
`proposal.keep`. A cover by a different artist is NOT a duplicate.

**F. Generic soundtrack titles.** Where `title` equals the work's name (title "The
Lion King"), propose the real song name as `title` ("Circle of Life"), based on the
actual video. Keep `artist` = the work's name.

## Style the maintainer approved (apply it in name proposals)

- International titles: official capitalisation (Title Case for normal titles; keep
  official stylisations like "bad guy", "HUMBLE.", "SICKO MODE").
- Guests: `Main Artist ft. Guest`. Co-leads: `A & B`. Never split real band or duo
  names ("Earth, Wind & Fire", "Simon & Garfunkel", "דולי ופן", "רד בנד",
  "סטטיק ובן אל תבורי").
- One spelling per artist across the catalog, the one the artist uses (TOTO, JAY-Z,
  "רביד פלוטניק" for his former stage name נצ'י נצ').
- No version junk in titles ("Remastered", "Official Video", "From the film…",
  "Radio Edit").
- Hebrew names in Hebrew only (no Latin transliteration in parentheses); straight
  quotes `'` and `"` (not ׳ ״ “ ”).
- Soundtracks: all films of one franchise under one work name when the maintainer
  grouped them ("High School Musical" for all three).
- A separate mechanical pass already proposes casing, quote and "ft." fixes; list
  those only when the words themselves are wrong.

## Bucket notes

- **names** (starts first; the song agents read its file): look across the WHOLE
  catalog at names only (no video swaps; YouTube only to confirm a spelling). One
  canonical spelling per performer (variant groups plus any you spot: Hebrew with or
  without י/ו, "The", hyphens, JAY-Z vs Jay-Z, typos), typos and wrong titles, swapped
  title and artist, credit format. Prioritise rows marked `new` and variants that
  involve them. Keep under about 40 gateway requests.
- **soundtracks**: generic titles (F), the work's name spelled the way the film or
  show is officially written, orchestra re-recordings or covers instead of the film
  version, duplicates of one song uploaded twice.
- **israeli / israeli-***: fan channels and TV-archive rips → artist or label upload;
  `credits-artist` flags are often false alarms (credits in English, or a nickname
  such as מרגול = מרגלית צנעני); avoid live and "מחרוזת" versions.
- **international / pop / rock / hiphop-electronic**: fan lyric channels (7clouds,
  LatinHype, RockHype…) → official video or Topic; wrong recordings (remix, live,
  re-recording, a cover filed under the original artist); guest credits from the
  official release; pop, disco or soul songs filed under `rock`.

Before you start, read `proposals/names.json` if it exists (the names agent's
spelling and credit fixes): don't repeat those; if you disagree with one, write
your own proposal and say why in the evidence.

## Output

Write a JSON array to `proposals/<your packet name>.json` (create the folder if
needed). Rewrite the whole file every ~10 proposals so work is not lost. Each element:

```json
{
  "song_id": "<uuid from the packet>",
  "kind": "video | name | metadata | broken | duplicate",
  "severity": 1,
  "summary": "one short line the maintainer reads first",
  "evidence": ["short facts with URLs where useful"],
  "confidence": "high | medium | low",
  "proposal": {
    "action": "update | delete | keep_one",
    "fields": {"title": "...", "artist": "...", "release_year": 1999, "genres": ["rock"], "youtube_id": "<verified id>", "start_time": 12},
    "keep": "<song_id to keep: duplicates only>"
  },
  "candidates": [{"youtube_id": "<verified id>", "note": "official MV, 412M views", "start_time": 8}],
  "dup_song_ids": ["<song_id>", "<song_id>"]
}
```

- Only include the fields that change. For a video swap put the best candidate's id
  in `fields.youtube_id` AND list it first in `candidates`.
- One proposal per (song, kind). A song with both a name and a video problem gets two.
- Don't propose anything for songs that are fine.

When done, reply with a short report (under 250 words): songs checked, proposals by
kind, and anything the maintainer should know (patterns, doubts, judgment calls).
