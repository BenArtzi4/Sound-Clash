"""Check a host's pasted song list; see ``docs/api-contracts.md §2.2a``.

``POST /setlists/check`` is what the create page calls on "Check my list". It
matches the list against the catalog snapshot (``get_catalog_index``, cached
for 10 minutes) and answers which lines can play and how many songs the game
would have. It writes nothing: no game, no pool and no demand row (demand is
recorded only when the game is created).

Catalogue protection: the answer is built field by field from titles and
artists. It never holds a song id, a YouTube id or a start time.
"""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Request

from app.middleware.rate_limit import limiter
from app.models.setlists import (
    SetlistCheckResponse,
    SetlistInput,
    SetlistMissLine,
    SetlistReadyLine,
)
from app.services.setlist_catalog import get_catalog_index
from app.services.setlist_matcher import CatalogIndex, CatalogSong, LineResult, match_setlist
from app.services.setlist_text import norm, parse_setlist_text

router = APIRouter(tags=["setlists"])


def _credited(song: CatalogSong) -> frozenset[str]:
    """Every artist a song credits, in the matcher's norm() form."""
    return frozenset(key for key in (norm(k) for k in song.artist_keys) if key)


def _catalog_artist(index: CatalogIndex, result: LineResult) -> str:
    """The catalog spelling of the artist or film an ``artist_or_film`` line names.

    The credit of a song credited to that name alone (``Frozen``, not
    ``Frozen & ...``); when no song is, the first song's whole credit.
    """
    key = index.artist_key(result.line.left)
    alone = next(
        (song for song in result.songs if key is not None and _credited(song) == {key}),
        result.songs[0],
    )
    return alone.artist


def _ready_line(index: CatalogIndex, result: LineResult) -> SetlistReadyLine:
    first = result.songs[0]
    if result.rule == "artist_or_film":
        title, artist = None, _catalog_artist(index, result)
    else:
        title, artist = first.title, first.artist
    return SetlistReadyLine(
        line=result.line.raw, title=title, artist=artist, songs=len(result.songs)
    )


def _check_blocking(index: CatalogIndex, text: str) -> SetlistCheckResponse:
    """Parse and match the list; CPU work, so it runs in a worker thread."""
    lines = parse_setlist_text(text)
    match = match_setlist(index, lines)
    ready: list[SetlistReadyLine] = []
    not_found: list[SetlistMissLine] = []
    for result in match.results:
        if result.songs:
            ready.append(_ready_line(index, result))
        else:
            # The matcher gives a reason to every line it did not find.
            assert result.reason is not None
            not_found.append(SetlistMissLine(line=result.line.raw, reason=result.reason))
    list_songs = len(match.list_song_ids)
    same_artist_songs = len(match.fill_song_ids)
    return SetlistCheckResponse(
        lines_total=len(lines),
        ready=ready,
        not_found=not_found,
        list_songs=list_songs,
        same_artist_songs=same_artist_songs,
        pool_size=list_songs + same_artist_songs,
    )


@router.post("/setlists/check", response_model=SetlistCheckResponse)
@limiter.limit("10/minute")
async def check_setlist(request: Request, body: SetlistInput) -> SetlistCheckResponse:
    index = await get_catalog_index()
    return await anyio.to_thread.run_sync(_check_blocking, index, body.text)
