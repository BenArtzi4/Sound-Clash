# Host page: three ways to choose the music

**Status:** design, decided. On 2026-11-24 the maintainer chose every point; **section 9 holds the final choices**. Two plans build it: the switch and "My own list" are Task 10 of the [phase 1 plan](2026-11-24-custom-setlist-phase1-plan.md), and the third tab is the [Pick artists plan](2026-11-24-pick-artists-plan.md). One wording waits for the maintainer's OK (the line after "Game ready", section 9).
**Date:** 2026-11-24
**Goes with:** [2026-11-24-custom-setlist-design.md](2026-11-24-custom-setlist-design.md) (option 2 below) and its [phase 1 plan](2026-11-24-custom-setlist-phase1-plan.md).

## 1. The three options

| | Option | What the host does | State |
| --- | --- | --- | --- |
| 1 | **Genres and decades** | Taps a quick-start mix, or genres and decades | Live today |
| 2 | **My own list** | Pastes song names, later a YouTube playlist link; a helper shows how to bring a Spotify playlist | Phase 1 is being built; the YouTube link is phase 2 |
| 3 | **Pick artists** | Chooses artists from a list; the game plays their songs | New, this file |

## 2. After "Host": a chooser screen, or tabs?

The maintainer's idea: after "Host", the host sees the three options and picks one; each option opens its own page or tab.

### Layout A: a chooser screen first

```
Host a game
How do you want to choose the music?

┌──────────────────────────────────────────┐
│ Genres and decades                       │
│ Pop, rock, Israeli, the 80s… one tap.    │
├──────────────────────────────────────────┤
│ My own list                              │
│ Paste your songs or a playlist.          │
├──────────────────────────────────────────┤
│ Pick artists                             │
│ Choose from more than 300 artists.       │
└──────────────────────────────────────────┘
```

Then each card opens its own page.

- Good: very clear. Each option gets a whole screen.
- Bad: every host taps one more time and loads one more screen. Today every host uses genres, so all of them pay for it. A host who comes back each week pays each time.

### Layout B: three tabs on the Host page, Genres open (chosen)

```
Host a game

[ Genres ]   [ My own list ]   [ Pick artists ]        ← Genres is open at first

Quick start:  (Party mix) (Israeli hits) (80s and 90s) …
Genres:       (Pop) (Rock) (Mizrahi) …
Decades:      (80s) (90s) (2000s) …
──────────────────────────────────────────────────────
312 songs in this mix                    [ Create game ]
```

- Good: today's path does not change. Host → tap a mix → Create, with no extra step.
- Good: the two new options are visible on the first screen, one tap away.
- Good: each tab has its own address (`/manager/create`, `/manager/create/list`, `/manager/create/artists`). The How to Play page, a landing page or a shared link can open a tab directly.
- Good: the code of a tab loads only when the host opens it, so the page is as fast as today.
- On a 360 px phone the labels are `Genres`, `My list`, `Artists`.

This is the same idea as the maintainer's ("each option takes him to the relevant page or tab"), without the extra screen.

### Effect on the phase 1 plan

Phase 1, Task 10 builds two tabs (`Genres`, `My own list`) with a local switch. With layout B that task should build the switch for three places and give each tab its address. The third tab is added by the artist work. With layout A, Task 10 changes more: a new first screen, and the genre page moves one step down. Task 10 is in the last pull request of phase 1, so there is time to decide before it is built.

## 3. Pick artists

### The numbers (catalog of 1,715 playable songs)

A song counts for every artist it credits, so a duet counts for both.

| Listed names | Names | Hebrew | English | Films and shows | Songs they reach | A typical name has |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Every name | 873 | 306 | 415 | 152 | 1,715 | 1 song |
| 2 or more songs | 337 | 154 | 150 | 33 | 1,309 | 3 songs |
| 3 or more songs | 212 | 112 | 89 | 11 | 1,111 | 4 songs |
| 5 or more songs | 91 | 55 | 34 | 2 | 765 | 7 songs |

What this means:

- **A host needs about 8 artists for a normal game** (30 songs) and about 18 for a long one, when the artists are typical ones with 3 or more songs. So choosing many artists must be fast: search, tap, and a sign that shows how close the game is.
- **Names with one song add little.** They are 536 of the 873 names. A host who wants one of them can type it in "My own list".
- **Films and shows are weak here.** 119 of 152 have one song. They fit better in the Soundtracks genre or in a pasted list.

### What the host sees

This is the first sketch. It showed a song count beside each name and in the bottom bar; the maintainer later chose to hide the counts and to gate the game on a rule. **Section 9 is the final look.**

```
[ Genres ]   [ My own list ]   [ Pick artists ]

[ Search artists…                                   ]
(All)  (עברית)  (English)  (Films & TV)

Chosen:  (Artist C ×)  (Artist B ×)  (Artist A ×)

  [✓] Artist A          [ ] Artist D
  [✓] Artist B          [ ] Artist E
  [✓] Artist C          [ ] Artist F
  …
──────────────────────────────────────────────────────
▮▮▮▯  3 artists · pick at least 5           [ Create game ]
```

- **Search** filters while the host types. A Hebrew artist is found by the Latin spelling too, through the alias table of the setlist design.
- **Chosen artists** are chips at the top; a tap removes one.
- **The bottom bar** shows how close the game is, with no song number (section 9).

### How it works

It reuses the song pool that phase 1 builds. An artist game is a pool where every song is "the host's own part" and there is no second part.

| Piece | What is new |
| --- | --- |
| Reading the list | One read-only database function that returns each name and its kind (Hebrew, English, or film and show), most songs first, with no count. The browser calls it when the host opens the tab. A second function answers "ready or not" for the chosen names (section 9). |
| Creating the game | `POST /games` accepts a list of chosen names. The server puts every playable song that credits one of them into the game's pool. |
| Playing | Nothing new. The pool picker of phase 1 chooses the songs. It already keeps the same artist from playing twice in a row while another artist has songs. |
| The host console | The same line as for a pasted list: how many songs are left. |

**Nothing changes in the round path.** No new work happens when the host presses Next round, and the buzzer is not involved. The no-regression proofs of the setlist design cover this option too.

**Airtime.** Songs are chosen at random with the artist-spacing rule. If the host picks one artist with 35 songs and one with 3, the small artist's songs come early and the rest of the game is the big artist. That is what the host chose.

### Which names are listed

| Choice | Names in the list | Note |
| --- | ---: | --- |
| **Every name (chosen)** | 873 | Every search for a catalog artist succeeds. 536 entries give one song each, so the default order is "most songs first" |
| 2 or more songs | 337 | A typical name gives 3 songs, but a search for a one-song artist finds nothing |
| 3 or more songs | 212 | Fewer taps for a full game, but more searches find nothing |

The maintainer chose the full list on 2026-11-24: names with one song are listed too.

### Catalogue protection

Today a visitor can read only **counts** from the catalog (the song count under the genre mix). The artist list would be the first place where **names** from the catalog are readable by anyone: artist names and how many songs each has. No song title, no YouTube id and no start point.

This is a smaller thing than the song list, and every game already shows artists to its players. It is still a change to the rule. The maintainer accepted it on 2026-11-24 by choosing the full list.

## 4. Approaches for the picker

| Approach | Verdict |
| --- | --- |
| **One read function returns the whole list; search and filters run in the browser** | **Recommended.** One request, instant search, simple. |
| A short list of top artists plus a server search | Shows less of the catalog. Slower and more parts. Only if the full list is refused. |
| No list; the host types names | Exists already inside "My own list". It does not answer "choose from a big list". |

## 5. Build order

1. Phase 1 of the setlist design, as planned. Its Task 10 is adjusted once layout A or B is chosen.
2. **Pick artists** as its own small plan after phase 1's database and backend parts are merged: one database migration (the read function and the "save by artist" step), the `POST /games` change, the third tab, tests and docs. It can ship before or after phase 2.
3. Phase 2 (YouTube playlist link) as planned.

Release note: the setlist design says "announce only when both phases are live". Pick artists does not depend on phase 2, so it can be announced when it is ready.

## 6. Later ideas (not in the first version)

- **Links that open with artists chosen** (`/manager/create/artists?pick=abba,queen`). A landing page such as "ABBA music quiz" could open the Host page ready to play.
- **Filter the artist list by genre** (Rock, Mizrahi, Pop), from the genres of each artist's songs.
- **A mix of options** in one game, for example a pasted list plus chosen artists. A pasted list already accepts artist names, so this is covered in a simple way.

## 7. The chosen look: layout 1, refined

The maintainer chose the segmented switch (layout 1) on 2026-11-24 and asked for four refinements. A working mockup was built and checked at 375 px and 320 px.

### The top of the Host page

```
Host a game                              title, as today
Choose how to pick the songs             fixed line: never changes
[ Genres | My own list | Pick artists ]  the switch
Pick at least one genre to start.        changing line: one per choice
```

| Line | Text | Style |
| --- | --- | --- |
| Fixed line | `Choose how to pick the songs` (recommended; the maintainer picks the wording) | Body size, muted colour, as today's line under the title |
| Changing line, Genres | `Pick at least one genre to start.` | Smaller (0.9rem), bone colour |
| Changing line, My own list | `Paste your songs. They play first.` | same |
| Changing line, Pick artists | `Pick the artists you want to hear.` | same |

**Every one of these lines stays on one line.** Each text is 36 characters or shorter, and each line has `white-space: nowrap` with an ellipsis as a guard. The switch labels are `Genres`, `My own list`, `Pick artists`; below 340 px of page width their font is 0.86rem. A test must check all of them at 320 px.

### The switch

- It has its own frame: a track with 4 px of padding and a block that slides inside it. This keeps it apart from the decade control, whose parts touch the edges.
- The block is the accent orange with black text, as in the layout the maintainer chose.
- How it is made: the row of labels is drawn twice. The second copy has the "open" colours and is clipped to the open third with `clip-path: inset(...)`. Moving the clip slides the block and changes each label's colour exactly at the block's edge. The position comes from an attribute on that copy (`data-i="0|1|2"`), with three fixed `clip-path` values. No measuring, no script timing.
- It is a tab list: `role="tablist"`, arrow keys move between the three, and the open one is the only one in the tab order.

### Motion

| Part | Time | What happens | Tokens |
| --- | --- | --- | --- |
| Switch | 250 ms | The block slides | `--dur-state`, `--ease-move` |
| Changing line | 100 ms out, then 180 ms in after a 70 ms wait | The old line fades out, the new one fades in from 4 px below; the two never overlap | `--ease-exit`, `--ease-arrive` |
| Content | 250 ms | The new content fades in and moves 12 px from the side its tab is on (`@starting-style`); the old content leaves at once | `--dur-state`, `--ease-arrive` |
| Quick start arrows and edge fades | 150 ms | Fade in and out | `--dur-micro` |
| Reduced motion | 0 | Everything is instant, through the site's global rule | |

Rules that the build must keep:

- CSS only, no new package. Only `transform`, `opacity` and `clip-path` change.
- Transitions, not keyframes, for the switch and the line, so a second tap in the middle of a move changes direction smoothly.
- No arrival animation when the page opens: the first content appears at once.
- This is a change inside one page. The Host page stays mounted and only its content changes, so the 2026-09-25 decision "screen changes are instant" ([ui-redesign/10-touch-and-route-motion.md](ui-redesign/10-touch-and-route-motion.md)) still holds, and the View Transitions API stays out.

### Quick start shows that it slides

On a phone the row of mixes is wider than the screen. Three signs now say so:

1. The edge of the row fades out on each side that has more mixes.
2. A round arrow button sits on that side. A tap moves the row by about 70% of its width. The hit area is 44 px.
3. The label row says `6 mixes` on the right.

The arrows and fades follow the scroll position, so the left ones appear only after the host has moved the row. Tapping a mix must not reset the row's position.

## 8. Questions for the maintainer

Settled on 2026-11-24: layout B (tabs on the Host page, Genres open), and the full artist list (873 names, readable by anyone).

Also settled: the look of the three tabs. Four working mockups were shown, and the maintainer chose the first:

| | Look | Verdict |
| --- | --- | --- |
| **1** | **Segmented switch** | **Chosen.** Refined in section 7. |
| 2 | Cards with a line of help | Not chosen. The clearest for a new host, but the tallest. |
| 3 | Underline tabs | Not chosen. The lightest, and the easiest to miss. |
| 4 | Genres first, two links | Not chosen. The new choices look like extras. |

The wording of the fixed line is settled too: `Choose how to pick the songs`.

## 9. Final choices (2026-11-24)

After the first mockup the maintainer reviewed the design twice more, each time in a working mockup with one switch per point. **Where this section and sections 3 or 7 differ, this section is right.**

### The top of the Host page

| Point | Choice |
| --- | --- |
| Words on the switch | `Genres`, `My own list`, `Pick artists`. Below 340 px of page width the font is 0.86rem, so they stay on one line. |
| Colour of the sliding block | Light (the bone colour, with dark text). Orange then means only "what you picked" and "Create game". |
| Help lines | Only the fixed line, `Choose how to pick the songs`. **No changing line under the switch.** The bottom bar carries the instruction, for example `Pick at least one genre to start.` |
| Quick start | A sliding row with edge fades, arrow buttons and `6 mixes`. |
| Genre tiles on a phone | Two columns. |
| My own list | Keeps the `Check my list` button. It does not check by itself. |

The motion of section 7 stays, without the changing line: the block slides in 250 ms and the new content fades in from the side of its tab.

### The artist list

| Point | Choice |
| --- | --- |
| Shape of a name | Tiles, two per line, in the look of the genre tiles: a tick box and the name. |
| Getting more names | A `Show 20 more` button. The list starts with 20 names. A line above it says `Showing 20 of 873 names`. |
| Names shown at first | All 873. |
| Filters | Language only, as one row of chips: `All`, `עברית`, `English`, `Films & TV`. No genre menu. |
| Order | Always most songs first. No A to Z. |
| Search | The box stays on screen while the list scrolls. It always looks in all names, and finds a Hebrew artist by the Latin spelling through the alias table. |
| Chosen artists | One sliding row of chips, newest first. A tap removes one. |

**Song counts are hidden.** The maintainer does not want a host to see how many songs each artist has.

- A tile shows only the name.
- The list of names that the browser gets holds no counts. The server sorts it by most songs and sends the names in that order.
- The bottom bar shows no song number, because with one artist chosen the total would be that artist's count. It shows the number of artists, a sign, and words (next part).
- The order still shows which artists have more songs than others. It shows no numbers.
- This is only about the artist list. The result of a pasted list (`61 songs in this game`) and the host console's line (`12 of 35 left`) keep their numbers: they are totals for a whole game.

Rules for the build: the selection survives a change of filter or search; the bottom bar never covers the `Show 20 more` button.

### When an artist game is ready

The maintainer on 2026-11-24: a game from chosen artists must be a real Sound Clash game, not one artist on repeat. So this option has a rule, and the host cannot create the game before the rule is met. A working mockup showed five signs and four song numbers; these are the choices.

| Point | Choice |
| --- | --- |
| Songs needed | At least **60** playable songs by the chosen artists. A song that credits two chosen artists counts once. |
| Artists needed | At least **5**. |
| The sign | The **sound bars**: the four bars of the Sound Clash mark, in the bottom bar, left of the text. They light up one by one as the game gets closer, and all four turn green when it is ready. |
| `Create game` | Off until the game is ready. The server checks the same rule when the game is created, so nobody can skip it. |
| After ready | A second, smaller line under the status tells the host that more artists are welcome: `You can add more. We recommend 10 or more.` It goes away at 10 artists. The maintainer asked for this line; the wording waits for their OK. |

The text in the bottom bar:

| State | Status line | Second line |
| --- | --- | --- |
| No artist chosen | `Pick at least 5 artists to start.` | |
| Fewer than 5 artists | `3 artists · pick at least 5` | |
| 5 or more artists, not enough songs | `6 artists · add more` | |
| Ready, fewer than 10 artists | `5 artists · Game ready` (`Game ready` in green) | `You can add more. We recommend 10 or more.` |
| Ready, 10 or more artists | `12 artists · Game ready` | |

**Why 60 songs.** A normal game is 30 rounds, and the top quarter of games is 72 rounds or more (setlist design, section 3). With 60 songs a normal game has twice the songs it needs. The cost is in taps, measured on the catalog (2,000 random tries for each cell):

| Songs needed | Host ticks well-known names (the first 20 to 40 in the list) | Host with mixed taste (any artist with 3 or more songs) |
| ---: | --- | --- |
| 40 | 3 to 4 artists | 8 to 10 artists |
| **60** | **4 to 6 artists** | **11 to 14 artists** |
| 80 | 5 to 8 artists | 14 to 18 artists |
| 100 | 6 to 10 artists | 18 to 22 artists |

**Why at least 5 artists.** The two biggest artists have 71 songs together. With only a song rule, a game from two artists could start, and then the artist answer is a coin toss. The rule also gives the host a clear first step.

**Why "10 or more" in the second line.** The picker does not play an artist again for 8 rounds, and that needs 9 or more artists. The line is advice, not a rule.

**How the bars move, with no number in the browser.** The browser sends the chosen names to the database and gets back two things: ready or not, and a level from 0 to 4. The level is the smaller of "songs so far, out of 60" and "artists so far, out of 5", in quarters, rounded up: the first artist always lights one bar, and the fourth bar lights only when the game is ready. Four steps are too coarse to read a song count from. They do show that some artists are bigger than others, as the order of the list already does.

**The moment the game becomes ready.** The four bars jump once, one after the other (420 ms each, 50 ms apart), and turn green. `Game ready` turns green, the button turns on, and the second line fades in. If the host takes an artist out and the game is too small again, the bars go back with no animation. With reduced motion only the colours change.

### Names that hold "&" or a comma

The database splits a credit such as `A & B` or `A, B` into its artists (migration 049). That is right for duets and wrong for a few names that are one artist, for example a band whose name holds "&", or a film whose title holds a comma. The song picker does not care, but a visible list would show the broken pieces as artists. About ten catalog names are of this kind. The Pick artists plan adds a small private table of "whole names" that the artist list reads, and one review of the list before release. The songs table and the song picker are not changed.
