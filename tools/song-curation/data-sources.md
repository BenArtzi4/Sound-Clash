# Song metadata sources

Reference list of external databases/APIs for song metadata (title, artist,
genre, **year → decade**, popularity). Use these to **discover** what songs to
add and, later, to **enrich/cross-check** year+decade — **not** as data to bulk
import.

> **Why not just import one of these?** They give you metadata (the easy half).
> They do **not** give a reliable, embeddable `youtube_id` (the hard half — the
> whole reason `verify.py` + `review.html` exist). They're also huge (MusicBrainz
> ~40M recordings) and mostly ToS-restricted for storage. Our catalog is ~800
> hand-picked, verified, *playable* songs and stays the single source of truth.
> See `README.md` for the curation pipeline these feed into.

## Metadata authorities — canonical title / artist / **year** / genre

| Source | Access | Includes | Notes |
| --- | --- | --- | --- |
| **MusicBrainz** | Free REST API (1 req/s) + full bulk DB dumps. **CC0** | Canonical artist/recording/release, **first-release date → year/decade**, ISRC, community genre tags | Best for year + canonical names. Tags are noisy. No YouTube id. |
| **Wikidata** | Free SPARQL endpoint. **CC0** | Song entities: publication date (P577 → year), genre (P136), performer (P175), external IDs (MusicBrainz, Spotify, sometimes YouTube video id P1651). **Has Hebrew labels.** | Structured + cross-links. Coverage thin for niche/Mizrahi. |
| **Discogs** | Free API (rate-limited; OAuth for more) + monthly XML dumps | Year, two-level **genre + style** taxonomy, artist/title | Release-centric. No YouTube id. |

These three are CC0/facts → safe to store and redistribute. Backbone for
year/decade and correct names.

## Popularity & discovery — *which* songs to add, by genre/decade

| Source | Access | Includes | Notes |
| --- | --- | --- | --- |
| **Spotify Web API** | Free (client-credentials) | Album **release_date → year/decade**, **popularity 0–100**, ISRC, editorial playlists ("Top 50 by decade/genre/country") | Genre is **per-artist, not per-track**. ToS limits storing/displaying → use for ranking/discovery only. |
| **Last.fm API** | Free key | **Folksonomy genre tags**, listener/play counts (popularity), top-tracks-by-tag/country | Tags messy; year unreliable. No YouTube id. |
| **Deezer API** | Free, no-auth for many endpoints | Album release_date, genre list, chart/editorial endpoints | Coarse genre. No YouTube id. |
| **Billboard / chart datasets** (Hot 100 year-end; public Kaggle dumps) | Free datasets | **Decade-by-decade popularity** ground truth | Dataset/scrape, not a live API. |

## The linchpin — name → *playable* id

| Source | Access | Includes |
| --- | --- | --- |
| **YouTube Data API v3** | Free, 10k quota units/day (search = 100 units) | `search` → candidate videos; `videos` → `status.embeddable`, title, channel, `publishedAt`. Automates "name → verified embeddable id". |

⚠️ `publishedAt` is the **upload date, not the release year** — never use it for year.

## Hebrew / Mizrahi gap-fillers (our weak spot)

English sources under-cover Israeli music. For these genres, use:

| Source | Includes |
| --- | --- |
| **Media Forest (מדיה פורסט)** Israeli airplay year-end charts | Year + popularity for Israeli/Mizrahi songs |
| **Galgalatz annual chart (מצעד גלגלצ השנתי)** / Hebrew Wikipedia hit lists | Year-stamped annual Israeli hits |
| **Spotify "Israel Top 50" + editorial Mizrahi playlists / Deezer Israel charts** | Current popularity + ISRC |

Get canonical Hebrew title/artist from Wikidata (Hebrew labels) + MusicBrainz,
then resolve to YouTube and **keep the per-song human review** (past errors lived here).

## How to use them (summary)

- **Now:** discovery only — pull popularity-ranked candidate lists (esp. Israeli
  charts for the Hebrew gap) into `candidates_in.csv`, then run the normal
  `verify.py` → `review.html` pipeline.
- **Later (decade feature):** add a `release_year` column and backfill from
  **MusicBrainz + Wikidata** by ISRC/MBID; trust a year only when ≥2 sources
  agree, human-review disagreements. `release_year` is the *original commercial
  release year of the recording* — not reissue, remaster, or YouTube upload.
- **Never:** bulk-import these, or query them live at game time (the <200 ms hot
  path forbids it). The catalog is always a pre-built, pre-verified, owned table.
