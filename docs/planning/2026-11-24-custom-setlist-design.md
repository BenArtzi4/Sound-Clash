# Custom setlist: design

**Status:** approved by the maintainer on 2026-11-24. Phase 1 is planned in [2026-11-24-custom-setlist-phase1-plan.md](2026-11-24-custom-setlist-phase1-plan.md). No product code is written yet.
**Date:** 2026-11-24
**Builds on:** the maintainer's earlier idea note, `IDEA-2026-09-21-custom-playlist-mode.md` (the "idea file" below; not in the repository on this date). Its Spotify legal limits, parser rules and Demand Queue still apply. Where the two differ, this file is newer.

A host brings a list of songs for a birthday, an office party or a themed night. The game plays from that list.

---

## 1. What the maintainer decided (2026-11-24)

1. **Order of play.** First the host's own songs. When they are finished, more songs **by the same artists**. Nothing else: no genre fill.
2. **No mode switch.** The host does not choose between "strict" and "mixed". The game always works as in point 1.
3. **Hebrew and English** lists must both work.
4. **The host's own YouTube videos are acceptable** for songs the catalog does not have.
5. **No Spotify connection.** The host converts or exports the list with a tool that already exists.
6. **The host cannot start the game before the songs are ready.**

Added the same day, after the pilot:

7. **Artist aliases** (`Omer Adam` = `עומר אדם`) come from a reviewed table (section 7).
8. **Release:** pasted names first, then the YouTube link. Announce the feature only when both are live.
9. **The host's own videos** are stored as flagged rows in `songs`, on one condition: no regression, and no extra delay on the buzzer or on rounds (section 10).
10. **Covers stay unmatched.** A list that names a cover of a catalog song does not get the catalog's version.
11. **Soundtrack songs play as the catalog defines them**: a soundtrack round, where the answer is the film.
12. **A list may name films and shows**, not only songs. Every line is looked up as a song name and as an artist or film name (section 7).
13. **Sound Clash links to the recommended converter** in the place where the host needs it (section 6).
14. **An artist name alone** adds all that artist's catalog songs to the host's own part, the same as a film name (section 7).
15. **Soundtrack titles match from 2 words** (section 7, rule 5).
16. **A Google API key and the YouTube and Google links on the site are approved** for phase 2 (section 12).

## 2. What the offline pilot showed

14 real, public playlists (868 song lines) were collected: personal lists, curated lists, DJ sets, a news article and a list of video titles, in Hebrew and in English. They were matched offline against a fresh snapshot of the catalog (1,715 playable songs).

| List | Songs | In the catalog, simple matching | In the catalog, rules of section 7 | More by the same artists | Pool |
| --- | ---: | ---: | ---: | ---: | ---: |
| Israeli party (personal list) | 85 | 0 | 27 | 171 | 198 |
| Israeli wedding (curated list) | 50 | 1 | 17 | 107 | 124 |
| Wedding chuppah songs (news article) | 30 | 4 | 4 | 141 | 145 |
| Mizrahi best-of (curated list) | 50 | 1 | 20 | 68 | 88 |
| Israeli birthday, mixed (DJ company list) | 38 | 1 | 11 | 149 | 160 |
| Israeli 80s and 90s (personal list) | 36 | 0 | 6 | 16 | 22 |
| Wedding reception (DJ set) | 60 | 14 | 15 | 56 | 71 |
| 30th birthday (personal list) | 85 | 26 | 28 | 79 | 107 |
| Office holiday party (DJ set) | 44 | 5 | 5 | 64 | 69 |
| 80s party, 50th birthday (DJ set) | 63 | 5 | 7 | 22 | 29 |
| 90s dance party (curated list) | 100 | 13 | 13 | 15 | 28 |
| 2000s throwback (DJ set) | 57 | 3 | 4 | 32 | 36 |
| Disney birthday (personal list) | 62 | 0 | 26 | 14 | 40 |
| Karaoke (video titles only, no artists) | 89 | 0 | 23 | 64 | 87 |

"Simple matching" is the first idea: same title and same artist name. "Pool" is the host's matched songs plus the same-artist songs.

**What this means**

1. **The host's own part is short.** A typical list has 14 of its songs in the catalog, about a quarter of the list. No list reaches 30, the length of a median game (section 3).
2. **With same-artist songs most lists give a full game.** 11 of 14 lists reach 30 songs and 8 reach 70. The three that do not are the 80s and 90s lists, where most artists have only one catalog song.
3. **Hebrew lists fail completely with simple matching.** Spotify and Apple Music show Israeli artists in Latin letters (`Omer Adam`, `Static & Ben El`) and about half of the titles too (`Ha'perah Be'gani`). The catalog stores both in Hebrew. Five Israeli Spotify lists matched 0 or 1 songs. With the rules of section 7 they match 6 to 27. Matching across the two scripts is required, not optional.
4. **Soundtracks need their own rule.** The Disney list matched 0 songs and then 26: the catalog credits the film, the playlist credits the singer.
5. **Title alone is not safe.** 34 lines had the right title and another artist. About half were a different song or a cover.
6. **Guessing artist names across scripts is not safe either.** A consonant comparison of artist names alone gave 128 pairs, and about half were wrong (`Skee-Lo` = `אושיק לוי`). The same comparison is safe when the title also agrees: of 141 such matches checked by hand, 1 was wrong. So artist names need a reviewed alias table.
7. **English lists are thinner than Hebrew ones.** The decade lists and the DJ sets matched 7% to 25%.

**Verdict.** The feature is worth building, in the chosen form: the host's songs first, then same artists. But with pasted names alone, the host's own songs are a small part of the game. The YouTube playlist path (section 9) is what lets the whole list play, so it is part of the plan, not an extra.

The lists, the scripts and every match are in `tools/song-curation/batches/2026-11-24-setlist-pilot/` (git-ignored).

## 3. Other numbers behind the design

**How long a game is.** Multiplayer games of the last 90 days (2 or more teams, 5 or more rounds):

| | Rounds |
| --- | ---: |
| Median game | 30 |
| Top quarter of games | 72 or more |
| Top tenth | 122 or more |

So a pool needs about 30 songs for a normal game and 70 or more for a long one. The create page already warns below 20 songs (`SMALL_MIX` in `frontend/src/lib/songPool.ts`).

**The catalog** (1,715 playable songs): 844 are in Hebrew script and 871 in Latin script. There are 742 main artists. **453 of them have only one song**; 74 artists have 5 or more and hold 686 songs together. "More by the same artist" therefore adds a lot for big names and nothing for most others.

**Curated start points.** 38% of catalog songs start at 0 seconds. The median is 5 seconds; 75% start before 29 seconds and 90% before 52 seconds.

## 4. What the host sees

On the create page there are two ways to choose the music: **Genres** (today) and **My own list** (new).

```
My own list
┌──────────────────────────────────────────────────────────┐
│ Paste a YouTube playlist link, or a list of songs        │
│ (one song per line: Artist - Title)                      │
└──────────────────────────────────────────────────────────┘
Have the list on Spotify or Apple Music?  [How to bring it]

[ Check my list ]
```

After "Check my list" (a few seconds, "Checking your list…"):

```
Your list: 47 songs

  ✔ 19 ready             best clip and start point, from our catalog
  ▶ 21 from your playlist   your own YouTube videos
  ✖  7 cannot play       [show them and why]

  + 44 more songs by the same artists, played after your list

  84 songs in this game. Enough for a long game.

[ Create game ]
```

During the game the host's console shows one line: `Your list: 12 of 40 left`. When the list is finished it changes to `Your list is done. Now: more by the same artists (44 left)`. When everything is played, the game shows today's "no more songs" message.

The host does not review or fix single lines. A line that is not clear counts as "cannot play", and the host sees which lines those are.

"Create game" needs at least one playable song. Below 20 songs the page shows the same heads-up as a small genre mix does today.

## 5. When the work is done: before the game, or during it?

Both, split by cost.

| Work | Where | Time | When |
| --- | --- | --- | --- |
| Read the pasted text | Host's browser | Instant | While typing |
| Match the list against the catalog | FastAPI | Under 1 second | On "Check my list" |
| Read a YouTube playlist (titles, length, can it be embedded) | FastAPI → YouTube API | 1 to 3 seconds | On "Check my list" |
| Find more songs by the same artists | Postgres | Under 1 second | On "Check my list" |
| Save the game's song pool | Postgres | Under 1 second | On "Create game" |
| **Choose the next song from the pool** | Postgres (as today) | A few ms | Every round |

All heavy work happens **once, before the game exists**, and its result is saved as the game's song pool. During the game, Postgres only chooses the next song from that pool. This is the same picker step as today, so "Next round" stays fast and no Python enters the round path.

**Why not a fixed, pre-arranged order?** The picker already handles "never repeat", "not the same artist twice in a row", dead videos and prebuffering the next video. A fixed order would need a second copy of all of that.

**Why not do the matching during the game?** It needs Python and, for YouTube links, the network. Both are too slow and too fragile for a round click.

**The start lock.** It is enforced in two places:

1. The check runs on the create page, so the game does not exist until the songs are ready. The host knows the result before guests scan the QR code.
2. In the database: the pool rows and a `ready` flag are written in one transaction, and `select_next_song` refuses to start a round for a custom game until the flag is set. A broken or half-saved pool can never start.

The maintainer's first picture was "create the game, show *loading* while teams join". Because the work takes seconds, not minutes, the check before "Create game" is simpler and safer: there is no background job that can hang on the free Render instance. If slow work is added later (section 13, phase 3), the same `ready` flag supports that picture: the game opens at once, the console shows `Preparing your songs… 23 of 47`, and Start stays locked until the flag flips.

## 6. Getting the list in

One box accepts a YouTube playlist link or pasted text. A file drop accepts `.txt` and `.csv`.

### From Spotify, Apple Music and others

Checked on 2026-11-24:

| Route | Result |
| --- | --- |
| Our server reads Spotify (API or scraping) | **No.** Settled in the idea file. |
| Host copies tracks in Spotify and pastes | **Does not work.** The clipboard holds only `open.spotify.com/track/…` links, no names. The idea file's "rich text" hope is contradicted by Spotify's own community forum. |
| We turn those links into songs with Odesli (song.link) | **Closed.** The free API now answers `401 PUBLIC_API_ACCESS_DEPRECATED`. |
| **Host converts the playlist to a YouTube playlist** | **Best.** TuneMyMusic: free up to 500 songs, works in a laptop or phone browser. On a phone, the YouTube Music app has its own "Transfer playlists from other apps". The host pastes the new playlist's link. Every song can play. |
| **Host exports the names as text** | **Second.** Chosic's playlist exporter: no login, paste the Spotify link, download a TXT. The host pastes the text. Only catalog songs and same-artist songs play. |
| Apple Music | Mac: File → Library → Export Playlist gives a text file. Or convert with TuneMyMusic. |
| Screenshots read by an AI model | Possible (about $0.003 to $0.15 for 5 screenshots). A new paid service. Not now. |

No converter site lets us pre-fill the playlist link, so the "How to bring it" helper is a short pictured guide with links:

```
Have the list on Spotify or Apple Music?

  Best: make it a YouTube playlist (every song plays)
    1. Open tunemymusic.com       2. From: Spotify → To: YouTube
    3. Set the new playlist to Unlisted    4. Paste its link here

  Quick: names only (plays the songs we have)
    1. Open chosic.com/spotify-playlist-exporter
    2. Paste your Spotify link → download TXT    3. Paste the text here
```

These sites can change or close. The helper text is the only thing that depends on them.

### Where the link lives in Sound Clash

| Place | What it shows |
| --- | --- |
| **Create page, inside "My own list"** (the main place) | The "How to bring it" helper above, closed by default, opened by one tap. It is next to the box where the host pastes. |
| **Same box, when the host pastes the wrong thing** | A pasted Spotify link or Spotify track links open the helper by themselves, with the line "These are links, not song names". Never an empty result. |
| **How to Play page, under "Rules & FAQ"** | One entry: "Can I play my own playlist?" with the same steps and links. This page is also what search engines read. |

**The recommended converter:**

- For "every song plays": **TuneMyMusic**, Spotify → YouTube. Shown first once YouTube links are accepted (phase 2).
- For names only: **Chosic's playlist exporter**. It needs no login. It is the only route shown in phase 1.

Each link opens in a new tab, and one line says that Sound Clash is not connected to these sites or to Spotify.

**Answer to "Spotify → YouTube matching, or YouTube only?"** Start with YouTube only. To find a YouTube video for a song name ourselves, the official search allows 100 searches per day (since June 2026), which is about 2 playlists per day. Unofficial search breaks YouTube's rules and is blocked on server addresses. The converter sites already do this job, and the host sees and can fix the result in YouTube before the party.

## 7. Matching rules

Both sides are cleaned in the same way first: lower case, no punctuation or niqqud, and no recording notes (`Remastered 2011`, `feat. X`, `Radio Edit`, `(Intro Clean)`, `From "Frozen"`, `רמיקס`). Then, in this order:

1. **Same YouTube video** (playlist links only).
2. **Same title and same artist.**
3. **Same title, and the artist is the same person in the other script.** This needs an alias table: `Zohar Argov` = `זוהר ארגוב`, also `Kesha` = `Ke$ha`.
4. **Known artist, title written in the other script.** Compare only against that artist's few songs, by consonants (`Ha'perah Be'gani` ≈ `הפרח בגני`).
5. **Soundtracks.** The catalog credits the film (`Frozen`), playlists credit the singer. Match on the title when the film name is in the line or the title has 2 or more words. In the pilot this rule was wrong for 1 line in about 45 (a pop song with the same name as a film song), and a one-word title (`Beyond`) is refused.
6. **Near-equal spelling** for the same artist (`Black Eyed Peas` / `The Black Eyed Peas`).

**Never match on the title alone.** The pilot found real traps: `Leon Bridges - Beyond` is not the `Beyond` from Moana 2. A cover by another artist also stays unmatched; with a YouTube link the host's own version plays.

### What a line may be

| The host writes | What it means |
| --- | --- |
| `Queen - Bohemian Rhapsody` or `Bohemian Rhapsody - Queen` | One song. Each line is tried in both orders. |
| `Frozen - Let It Go` or `Let It Go (From "Frozen")` | One soundtrack song (rule 5). |
| `Frozen`, `Friends`, `Shrek` | A film or a show: **all** its catalog songs join the host's own part of the game. |
| `Queen`, `עומר אדם` | An artist: all that artist's catalog songs join the host's own part. This comes free with the film rule, because the catalog keeps a film in the artist field. A big artist adds many songs (up to 35 today). |
| `Dancing Queen` | A song name alone. It matches when exactly one catalog song has that name. If several have it, the line is "cannot play: add the artist". |

A name with no dash is looked up as an artist or film first, then as a song name.

### The alias table

`artist_aliases` maps a spelling to one catalog artist: `omer adam` → `עומר אדם`, `kesha` → `ke$ha`.

- **Built offline, in three steps.** A tool proposes Latin spellings for the catalog's Hebrew artists from Wikidata labels (free licence). A research agent fills the gaps from the artists' own channels and pages. A second agent, which sees only the pairs, checks every pair against a source. The maintainer reviews what the second agent could not confirm.
- **Proof before it ships.** The 14 pilot lists are matched again with the real table. Each list must reach at least the pilot's count, with no wrong match in the hand-checked set.
- **Private.** The table names the catalog's artists, so its rows are never committed to git. They are uploaded like songs and are part of the private catalog backup.
- **Kept current.** Adding a Hebrew artist to the catalog includes adding the alias (a step in the add-songs workflow).
- **Not for translations.** `The Lion King` and `מלך האריות` are two different catalog entries (two recordings). An alias never joins them.

**"Same artist"** means: catalog songs that credit the **main artist** of any line in the list, even when that line's own song is not in the catalog. For a soundtrack match this gives "more songs from the same film".

The matcher must index the catalog by title and by artist. The pilot script compares everything with everything and needs minutes; the product needs milliseconds.

## 8. Storage and the picker

**New table `game_setlists`** `(game_code, ready, list_total)`: one row for each custom game. A game with no row here is a normal genre game.

**New table `game_song_pool`** `(game_code, song_id, tier)`, where tier 1 is the host's list and tier 2 is "same artists". Both tables are deleted with the game. Players cannot read them.

**`active_games` is not changed at all.** That row goes to every phone on every buzz. A list in it would show the answers to players, and even a small new column would touch the buzzer's message path. All new data is in the two new tables.

**New function `pick_next_pool_song(game_code)`**: from the songs of the pool that were not played and are still available, take the lowest tier, then apply today's artist-spacing rule, then choose at random. The genre picker `pick_next_song` is **not changed**, so normal games carry no risk.

**`select_next_song` and `peek_next_song`** keep their signatures. For a custom game they call the pool picker, check a prebuffered song against the pool instead of the genres, and refuse while `ready` is false. For a normal game the only new work is one lookup by key in `game_setlists`.

**New function `game_pool_summary(game_code, manager_token)`** returns how many songs are left per tier, for the console line.

**Details for the builder**

- "Create game" sends the same text or link again. The server repeats the check and saves the pool; it trusts nothing the browser computed.
- A custom game has no genres or decades, so `POST /games` and `select_next_song` must accept an empty genre list for a game that has a `game_setlists` row.
- Tier 1 holds every song of the host's list that can play, catalog songs and the host's own videos together, chosen at random. A song named twice is in the pool once. A catalog song flagged as unavailable counts as "cannot play".
- The artist-spacing rule is a preference. A list by one artist must still play.
- The backup host link and "Keep playing +1h" need no change: the pool is on the server and lives as long as the game.

**Catalogue protection.** The check endpoint tells a caller whether a song is in the catalog. Limits: 300 lines or 200 videos per list, the existing rate limiter, and the answer holds titles and artists only, never a YouTube id or a start point.

## 9. The host's own YouTube videos

The server reads the playlist with the YouTube Data API: about 2 to 4 quota units per playlist, from a free daily budget of 10,000. It needs an API key (a new operator setting on Render) and no new package; the backend already calls YouTube with the standard library.

For each video:

1. Its id is in the catalog → use the catalog song.
2. Its title and artist match a catalog song (section 7) → use the catalog song, with the curated clip and start point.
3. Otherwise → an **unlisted song**: the host's video, with a cleaned title, the artist from the title or the channel, and a start point from section 11.

**Refused at the check, with the reason shown:** private or deleted, embedding switched off, live streams, age-restricted, and videos longer than 10 minutes (mixes and full albums are not one song).

**During the game:** YouTube says a video marked "can be embedded" can still be blocked on other sites. When the host's player reports error 101 or 150 for an unlisted song, the console says so and offers **Next song**.

**Names on the reveal.** They come from the video title, so some will be less clean than catalog names. The host is the judge of every answer, so this does not break scoring.

### Where unlisted songs are stored

Decided (2026-11-24): as rows in `songs` with `listed = false` and **no genre links**, under the conditions of section 10.

- Everything that plays, reveals, exports and archives a song already works on `songs`. Nothing there changes.
- They cannot enter a normal game: the genre picker only finds songs through their genre links.
- Two games with the same video share one row (`youtube_id` is unique). If the maintainer later adds that song properly, the row is promoted with one update.
- Cost: every catalog-wide reader must skip unlisted rows: the admin list, the backup, the weekly dead-video scan and the curation snapshot. The admin page can show them in their own "Unlisted" tab, which is also a review queue of videos that real hosts chose.

The option that was not chosen is a separate table. It keeps the catalog table clean but changes 7 database functions that today read `songs` (select, peek, start round, round song, setlist, archive, picker).

Unlisted rows that no game used for 30 days are deleted by a nightly job (section 12).

## 10. No regression: what must be proven

The maintainer's condition for the whole feature: normal games must not change, and the buzzer and the rounds must not get slower. Each point below is a check with a pass mark, not a promise.

**What is not touched at all**

| Part | Proof |
| --- | --- |
| `buzz_in`, `award_attempt`, `release_buzz_lock`, and the trigger that sends buzzer locks | Their definitions in the database are compared before and after each migration. They must be identical, character for character. |
| The `active_games` table | The same columns, triggers and Realtime settings before and after. |
| The genre picker `pick_next_song` | Not edited. Its existing tests pass with no change to the test files. |

**What is touched, and its limit**

| Part | Change | Pass mark |
| --- | --- | --- |
| `select_next_song`, `peek_next_song` | One lookup by key in `game_setlists`, then the same path as today for a normal game | Measured on production data inside a transaction that is rolled back: 200 calls before and 200 after. The new average is at most 1 ms above the old one. |
| The pool picker (custom games only) | New | Under 10 ms on a 300-song pool. |
| `songs` (phase 2) | A new `listed` column, default `true` | Adding it does not rewrite the table. The genre picker cannot reach unlisted rows because they have no genre links; a test adds an unlisted row and plays a genre game to the last song. The admin list, the backup, the weekly scan and the curation snapshot are each checked. |
| Create page | A second way to choose music | The new panel loads only when the host opens it. The first load of the page does not grow. |

**The usual gates still apply:** the buzz race test (10 presses at once, 1 winner, 100 times), the full end-to-end suite, the production pass (29 of 29) after each frontend merge, and the Full-Game Exit Gate.

**After each release:** compare one week of real timings before and after for `buzz_in`, `select_next_song` and `peek_next_song` in normal games (median and 95th percentile). A rise stops the next phase.

**Order of release:** each database change only adds things, is applied before the code that needs it, and can stay unused. The frontend works when the new functions are missing.

## 11. Start point for a video nobody curated

The first idea was a random second between 30 and 60. The research says a rule based on the video's length is better:

```
length under 90 s      → start at 0
otherwise              → start = 18% of the length, at least 15 s, at most 50 s
always                 → leave at least 60 s of song after the start
```

- **Why 18%.** In two research datasets (1,651 songs, 1958 to the 2010s) the first chorus starts at about 20% of the song, in every decade. With the 18% rule a song is still in its intro 2 to 4% of the time, in a verse about 70%, and in the chorus about 25%. A fixed 30 seconds is still in the intro 9% of the time.
- **Why not random.** Each song plays once per game and every team hears the same clip. Random adds no fairness. Random 30 to 60 gives the same result as a fixed 45, and lands in the chorus more often, where the title is sung.
- **Why later than the catalog's own starts.** A curator starts at 0 because they heard that the intro is good. Nobody heard this video, and official videos can open with a story scene. Starting late costs little; starting on silence costs a round.
- The host's back and forward buttons fix the rare bad start.

Not used: YouTube's "most replayed" graph (reading it breaks YouTube's rules). Possible later: SponsorBlock's free data on non-music intros (it covers 37% of popular videos but only 14% of Israeli ones, and its licence is non-commercial).

**Measure after launch:** how often the host presses back or forward in the first 10 seconds, for unlisted songs against catalog songs.

## 12. What YouTube's rules require (playlist links only)

Reading playlists with an API key puts the site formally under YouTube's API terms:

- Show a link to YouTube's Terms of Service, and say in the privacy page that the site uses YouTube API Services, with a link to Google's privacy policy.
- **Data from the API may be kept 30 days**, then it must be refreshed or deleted. Game pools live 4 hours. Unlisted songs are deleted after 30 days without use.
- Look up each embedded video's "made for kids" status (it comes in the same API call).
- One API project only. No scraping. Nothing may cover the player.

The maintainer approved the API key and the two links on 2026-11-24.

## 13. Build order

**Phase 1, pasted names: catalog songs, then same artists.** The task-by-task plan is [2026-11-24-custom-setlist-phase1-plan.md](2026-11-24-custom-setlist-phase1-plan.md).

1. Database: `game_setlists`, `game_song_pool`, the pool picker, the two branches, `game_pool_summary`. Tests: tier order, no repeats, empty pool, the start lock, players cannot read the pool.
2. `artist_aliases`, its offline build tool, and the research and checking agents (section 7).
3. Backend: the parser and matcher (from the pilot script), a check endpoint, and `POST /games` with a list.
4. Frontend: "My own list" on the create page, the result card, the converter helper, the console line, the How to Play entry.
5. The Demand Queue table for songs that hosts asked for and the catalog lacks (idea file, section 4).
6. The proofs of section 10.

**The maintainer's two checks. Neither blocks phase 1.**

- Convert one Hebrew Spotify playlist with TuneMyMusic and look at which videos it chose. **Needed before phase 2 starts**, because phase 2 recommends that site by name.
- Copy 5 tracks in Spotify and paste them into a clipboard viewer, to confirm that no names arrive. **Any time.** It only matters if the result is a surprise.

**Phase 2, YouTube playlist link: every song plays**

The API key, the playlist reader, unlisted songs, the start rule, the "cannot play here" message, the YouTube links on the site, the nightly clean-up, the admin "Unlisted" tab.

**Phase 3, only if hosts ask**

Finding videos for song names ourselves (needs more search quota from YouTube, and the slow "Preparing your songs" state), SponsorBlock start hints, screenshots, saved share links, guests adding songs.

Each phase updates `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/api-contracts.md` and `CHANGELOG.md` in the same pull requests.

**Measure after launch:** how many games use a list; the share of each list that could play; pool sizes; how many custom games run out of songs; for the host's own videos, the rate of "cannot play here" errors and of back or forward presses in the first 10 seconds; the most requested missing songs.

## 14. Approaches that were considered

| Approach | Verdict |
| --- | --- |
| A. Only songs that are in the list and in the catalog | Too few songs for a game (section 2). Kept as the first part of B. |
| **B. The host's songs first, then same artists** | **Chosen**, with the maintainer's two rules: no mode switch, no genre fill. |
| C. The host types artists, not songs | **Included** as one form of a line: a line may be an artist, a film or a show (section 7). |
| **D. The host's own YouTube videos for songs we lack** | **Accepted** as phase 2. |
| E. Guests add songs when they join | A different feature. Parked. |

## 15. Not included

Accounts. A Spotify login or any call to Spotify. Audio from anywhere but YouTube. Editing single lines of a list. Saving a list on the server (the host keeps the text or the playlist link and pastes it again; the result is the same each time).

## 16. Open points for the maintainer

None. Every decision is in section 1.

One check is still owed by the maintainer before phase 2 starts: convert one Hebrew playlist with TuneMyMusic and look at the videos it chose (section 13).

## 17. Sources

Pilot data, scripts and results (local, git-ignored): `tools/song-curation/batches/2026-11-24-setlist-pilot/`.

- YouTube quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube developer policies (30-day rule, no scraping, made for kids): https://developers.google.com/youtube/terms/developer-policies
- YouTube required minimum functionality (player size, no overlays): https://developers.google.com/youtube/terms/required-minimum-functionality
- IFrame player errors 101 / 150: https://developers.google.com/youtube/iframe_api_reference
- TuneMyMusic limits: https://www.tunemymusic.com/help
- Chosic playlist exporter: https://www.chosic.com/spotify-playlist-exporter/
- YouTube Music playlist transfer: https://support.google.com/youtubemusic/answer/14729358
- Spotify copy gives links only: https://community.spotify.com (Live Idea 5568522)
- Song structure data: https://ddmal.music.mcgill.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/ and https://github.com/urinieto/harmonixset
- Chorus timing, Billboard 2011 to 2019: https://escholarship.org/uc/item/6wh2n829
- SponsorBlock API and licence: https://wiki.sponsor.ajay.app/w/API_Docs
